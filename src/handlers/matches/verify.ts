import type {
  CommandHandler,
  CommandEventWithArgs,
  HandlerContext,
} from "../types";
import { getThreadMessageOpts } from "../../utils/threadRouter";
import { getSmartAccountFromUserId } from "@towns-protocol/bot";
import { formatEth, formatOutcome } from "../../utils/format";
import { db } from "../../db";
import type { DBMatch, ContractBet } from "../../types";

export const createVerifyHandler = (
  context: HandlerContext
): CommandHandler<CommandEventWithArgs> => {
  return async (handler, { channelId, userId, eventId, threadId }) => {
    const opts = getThreadMessageOpts(threadId, eventId);

    try {
      console.log(`[/verify] Starting verification for user ${userId}`);

      // Check if contract is available
      if (!context.contractService.isContractAvailable()) {
        await handler.sendMessage(
          channelId,
          "❌ Smart contract is not yet deployed. Verification unavailable.",
          opts
        );
        return;
      }

      // Send initial message
      await handler.sendMessage(
        channelId,
        "🔍 **Verifying Your Bets...**\n\nChecking on-chain state, please wait...",
        opts
      );

      // Get user's smart account address
      const walletAddress = await getSmartAccountFromUserId(context.bot, {
        userId: userId as `0x${string}`,
      });

      if (!walletAddress) {
        await handler.sendMessage(
          channelId,
          "❌ Couldn't retrieve your wallet address. Please try again.",
          opts
        );
        return;
      }

      console.log(`[/verify] User wallet: ${walletAddress}`);

      // Get recent matches (last 7 days) plus today's matches
      const recentMatches = db.getRecentMatches(7);
      const todaysMatches = db.getTodaysMatches();

      // Combine and deduplicate
      const allMatches = new Map<number, DBMatch>();
      [...recentMatches, ...todaysMatches].forEach((match) => {
        if (match.on_chain_match_id !== null) {
          allMatches.set(match.on_chain_match_id, match);
        }
      });

      if (allMatches.size === 0) {
        await handler.sendMessage(
          channelId,
          "📭 **No Matches Found**\n\nNo on-chain matches available to verify.",
          opts
        );
        return;
      }

      console.log(`[/verify] Checking ${allMatches.size} on-chain matches`);

      // Batch check all matches for user's bets (single RPC call!)
      const onChainMatchIds = Array.from(allMatches.keys());
      const batchResults = await context.contractService.getBatchUserBets(
        onChainMatchIds,
        walletAddress
      );

      // Analyze results
      const foundBets: Array<{
        match: DBMatch;
        bet: ContractBet;
        inDB: boolean;
        recovered: boolean;
      }> = [];

      for (const { matchId: onChainMatchId, bet } of batchResults) {
        if (!bet || bet.amount === 0n) continue; // No bet on this match

        const match = allMatches.get(onChainMatchId);
        if (!match) continue;

        // Check if bet exists in DB
        const inDB = db.hasBet(userId, match.id);

        if (!inDB) {
          // BET FOUND ON-CHAIN BUT NOT IN DB - RECOVER IT!
          console.log(
            `[/verify] 🔄 Recovering bet: Match ${match.id}, Amount: ${bet.amount}`
          );

          try {
            // Create the bet record in DB
            // Store amount as wei string (not decimal) so formatEth works correctly
            const amountWeiString = bet.amount.toString(); // e.g., "10000000000000000"
            const amountEthString = formatEth(bet.amount); // e.g., "0.01" for display/stats

            db.createBet(
              userId,
              walletAddress,
              match.id,
              match.on_chain_match_id!,
              bet.prediction,
              amountWeiString, // Store wei string in DB
              "" // No tx hash available for recovered bets
            );

            // Update user stats (uses decimal for stats tracking)
            db.recordBet(userId, amountEthString);

            foundBets.push({ match, bet, inDB: false, recovered: true });
            console.log(`[/verify] ✅ Bet recovered for match ${match.id}`);
          } catch (error) {
            console.error(
              `[/verify] Failed to recover bet for match ${match.id}:`,
              error
            );
          }
        } else {
          foundBets.push({ match, bet, inDB: true, recovered: false });
        }
      }

      // Build response message
      let message = "✅ **Verification Complete!**\n\n";

      if (foundBets.length === 0) {
        message += "📭 No on-chain bets found for recent matches.\n\n";
        message +=
          "If you just placed a bet, please wait a moment and try again.";
      } else {
        const recoveredCount = foundBets.filter((b) => b.recovered).length;
        const syncedCount = foundBets.filter((b) => !b.recovered).length;

        message += `**Summary:**\n`;
        message += `├ Total on-chain bets: ${foundBets.length}\n`;
        message += `├ Already synced: ${syncedCount}\n`;
        message += `└ Recovered: ${recoveredCount}\n\n`;

        if (recoveredCount > 0) {
          message += `🔄 **Recovered Bets:**\n\n`;

          for (const { match, bet, recovered } of foundBets) {
            if (recovered) {
              const matchCode =
                match.match_code || `#${match.daily_id || match.id}`;
              message += `• **${match.home_team} vs ${match.away_team}** (${matchCode})\n`;
              message += `  ├ Your Pick: ${formatOutcome(bet.prediction)}\n`;
              message += `  └ Stake: ${formatEth(bet.amount)} ETH\n\n`;
            }
          }

          message += `✅ Database has been updated!\n\n`;
        }

        message += `💡 **Next Steps:**\n`;
        message += `• Use \`/mybets\` to view all your bets\n`;
        message += `• Use \`/claimable\` to see winnings\n`;
      }

      // Check for pending bets
      const pendingBet = db.getPendingBet(userId);
      if (pendingBet) {
        message += `\n⏳ **Pending Bet Detected:**\n`;
        message += `You have an unconfirmed bet waiting.\n`;
        message += `• Match ID: ${pendingBet.match_id}\n`;
        message += `• Amount: ${pendingBet.amount} ETH\n\n`;
        message += `If your transaction succeeded, the bet should now be synced.\n`;
        message += `Run \`/mybets\` to check.`;
      }

      await handler.sendMessage(channelId, message, opts);
      console.log(`[/verify] Verification complete for ${userId}`);
    } catch (error) {
      console.error("[/verify] Error during verification:", error);
      await handler.sendMessage(
        channelId,
        "❌ **Verification Failed**\n\nAn error occurred while verifying your bets. Please try again or contact support.",
        opts
      );
    }
  };
};
