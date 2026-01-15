/**
 * /claim_all command handler
 * Lists all unclaimed winnings and prompts user to claim them individually
 * Note: Batch claiming in a single transaction is a future enhancement
 */

import { getSmartAccountFromUserId } from "@towns-protocol/bot";
import type {
  CommandHandler,
  BaseCommandEvent,
  HandlerContext,
} from "../types";
import { getThreadMessageOpts } from "../../utils/threadRouter";
import { db } from "../../db";

export const createClaimAllHandler = (
  context: HandlerContext
): CommandHandler<BaseCommandEvent> => {
  return async (handler, { channelId, userId, eventId, threadId }) => {
    const opts = getThreadMessageOpts(threadId, eventId);

    try {
      // Check if contract is available
      if (!context.contractService.isContractAvailable()) {
        await handler.sendMessage(
          channelId,
          "❌ Smart contract is not yet deployed. Please contact the admin.",
          opts
        );
        return;
      }

      // Get all claimable bets for the user
      const claimableBets = db.getClaimableBets(userId);

      if (claimableBets.length === 0) {
        await handler.sendMessage(
          channelId,
          `📭 **No Unclaimed Winnings**

You don't have any unclaimed winnings at the moment.

Use \`/matches\` to see today's matches and place new bets!`,
          opts
        );
        return;
      }

      // Get wallet address
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

      // Filter for actual claimable bets and collect match IDs
      const claimableMatches: Array<{
        matchId: number;
        onChainMatchId: number;
        homeTeam: string;
        awayTeam: string;
      }> = [];

      for (const bet of claimableBets) {
        try {
          const onChainBet = await context.contractService.getUserBet(
            bet.on_chain_match_id,
            walletAddress
          );

          if (onChainBet && onChainBet.amount > 0n && !onChainBet.claimed) {
            claimableMatches.push({
              matchId: bet.match_id,
              onChainMatchId: bet.on_chain_match_id,
              homeTeam: bet.home_team,
              awayTeam: bet.away_team,
            });
          }
        } catch (error) {
          console.error(
            `Error checking claim status for match ${bet.match_id}:`,
            error
          );
        }
      }

      if (claimableMatches.length === 0) {
        await handler.sendMessage(
          channelId,
          `📭 **No Claimable Matches**

All your winnings may have already been claimed.

Use \`/stats\` to see your betting history.`,
          opts
        );
        return;
      }

      // For now, inform user about individual claims
      // Future enhancement: batch claims in one transaction
      let message = `💰 **Claim All Winnings**\n\n`;
      message += `You have **${claimableMatches.length}** match${
        claimableMatches.length !== 1 ? "es" : ""
      } with unclaimed winnings:\n\n`;

      for (let i = 0; i < claimableMatches.length; i++) {
        const match = claimableMatches[i];
        message += `${i + 1}. ${match.homeTeam} vs ${match.awayTeam}\n`;
      }

      message += `\n⚠️ **Note:** You'll need to sign ${
        claimableMatches.length
      } separate transaction${claimableMatches.length !== 1 ? "s" : ""}.\n\n`;
      message += `**Options:**\n`;
      message += `• Use \`/claim <match #>\` to claim from specific matches\n`;
      message += `• React with 👍 below to proceed with claiming all\n\n`;
      message += `_Batch claiming in a single transaction is coming soon!_`;

      await handler.sendMessage(channelId, message, opts);

      // Note: Full implementation would listen for reaction and send all transactions
      // For now, user should use /claim individually or we can add confirmation flow
    } catch (error) {
      console.error("Error in /claim_all command:", error);
      await handler.sendMessage(
        channelId,
        "❌ An error occurred while processing your claim request. Please try again or contact support.",
        opts
      );
    }
  };
};
