import type {
  CommandHandler,
  CommandEventWithArgs,
  HandlerContext,
} from "../types";
import { getThreadMessageOpts } from "../../utils/threadRouter";
import { isUserAdmin } from "../../utils/wallet";
import { db } from "../../db";
import { formatEth, truncateAddress } from "../../utils/format";
import { getLinkedWallets } from "../../utils/wallet";

export const createMigrateHandler = (
  context: HandlerContext,
): CommandHandler<CommandEventWithArgs> => {
  return async (handler, { channelId, args, eventId, threadId, userId }) => {
    const opts = getThreadMessageOpts(threadId, eventId);

    try {
      // Check if user is admin
      if (!(await isUserAdmin(context.bot, userId as `0x${string}`))) {
        await handler.sendMessage(
          channelId,
          "❌ **Access Denied**\n\nThis command is only available to the bot administrator.",
          opts,
        );
        return;
      }
      // Check if contract is available
      if (!context.contractService.isContractAvailable()) {
        await handler.sendMessage(
          channelId,
          "❌ Contract not available. Cannot migrate bets.",
          opts,
        );
        return;
      }

      await handler.sendMessage(
        channelId,
        "🔄 Starting bet migration from blockchain to database...\n\nThis may take a moment...",
        opts,
      );

      console.log(`[/migrate] Starting migration for user ${userId}`);

      // Get all user's linked wallets
      const linkedWallets = await getLinkedWallets(
        context.bot,
        userId as `0x${string}`,
      );
      console.log(
        `[/migrate] Found ${linkedWallets.length} linked wallet(s) for ${userId}`,
      );

      if (linkedWallets.length === 0) {
        await handler.sendMessage(
          channelId,
          "❌ No linked wallets found for your account.",
        );
        return;
      }

      // Get all matches with on-chain IDs (not just today's)
      const onChainMatches = db.getAllOnChainMatches();

      console.log(
        `[/migrate] Found ${onChainMatches.length} matches with on-chain IDs`,
      );

      let migratedCount = 0;
      let skippedCount = 0;
      let duplicateCount = 0;
      const duplicateMatches: string[] = [];

      // Check each match for bets from any linked wallet
      for (const match of onChainMatches) {
        if (!match.on_chain_match_id) continue;

        // Check if user already has this match in DB
        const existingBet = db.getUserBetOnMatch(userId, match.id);
        if (existingBet) {
          console.log(
            `[/migrate] Skipping match ${match.id} - already in DB for ${userId}`,
          );
          skippedCount++;
          continue;
        }

        // Check each wallet for a bet on this match
        let foundBets: Array<{ wallet: string; bet: any }> = [];

        for (const wallet of linkedWallets) {
          try {
            const bet = await context.contractService.getUserBet(
              match.on_chain_match_id,
              wallet,
            );

            if (bet && bet.amount > 0n) {
              foundBets.push({ wallet, bet });
              console.log(
                `[/migrate] Found bet on match ${
                  match.id
                } from wallet ${truncateAddress(wallet)}: ${formatEth(
                  bet.amount,
                )} ETH`,
              );
            }
          } catch (error) {
            console.error(
              `[/migrate] Error checking wallet ${wallet} for match ${match.on_chain_match_id}:`,
              error,
            );
          }
        }

        // Handle the bets found
        if (foundBets.length === 0) {
          // No bets found for this match
          continue;
        } else if (foundBets.length === 1) {
          // Single bet - migrate it
          const { wallet, bet } = foundBets[0];
          try {
            db.createBet(
              userId,
              wallet,
              match.id,
              match.on_chain_match_id,
              bet.prediction,
              bet.amount.toString(),
              "0x0", // No tx hash available for historical bets
            );
            migratedCount++;
            console.log(
              `[/migrate] ✅ Migrated bet for match ${
                match.id
              } from wallet ${truncateAddress(wallet)}`,
            );
          } catch (error) {
            console.error(
              `[/migrate] Failed to insert bet for match ${match.id}:`,
              error,
            );
            skippedCount++;
          }
        } else {
          // Multiple bets found (duplicate situation!)
          duplicateCount++;
          duplicateMatches.push(
            `${match.home_team} vs ${match.away_team} (${foundBets.length} bets)`,
          );
          console.warn(
            `[/migrate] ⚠️ Found ${foundBets.length} bets for match ${match.id} - keeping largest`,
          );

          // Keep the bet with the largest amount
          const largestBet = foundBets.reduce((prev, current) =>
            current.bet.amount > prev.bet.amount ? current : prev,
          );

          try {
            db.createBet(
              userId,
              largestBet.wallet,
              match.id,
              match.on_chain_match_id,
              largestBet.bet.prediction,
              largestBet.bet.amount.toString(),
              "0x0",
            );
            migratedCount++;
            console.log(
              `[/migrate] ✅ Migrated largest bet (${formatEth(
                largestBet.bet.amount,
              )} ETH) from ${truncateAddress(largestBet.wallet)}`,
            );
          } catch (error) {
            console.error(
              `[/migrate] Failed to insert largest bet for match ${match.id}:`,
              error,
            );
            skippedCount++;
          }
        }
      }

      // Build result message
      let resultMessage = `✅ **Migration Complete!**\n\n`;
      resultMessage += `📊 **Summary:**\n`;
      resultMessage += `• Migrated: ${migratedCount} bet${
        migratedCount !== 1 ? "s" : ""
      }\n`;
      resultMessage += `• Skipped (already in DB): ${skippedCount}\n`;

      if (duplicateCount > 0) {
        resultMessage += `• ⚠️ Duplicates found: ${duplicateCount}\n\n`;
        resultMessage += `**Note:** You had multiple bets on the same match from different wallets. I kept the largest bet for each match:\n`;
        for (const match of duplicateMatches) {
          resultMessage += `• ${match}\n`;
        }
        resultMessage += `\nGoing forward, you can only place one bet per match (with any wallet).`;
      }

      resultMessage += `\n\nUse \`/mybets\` to view your migrated bets!`;

      await handler.sendMessage(channelId, resultMessage);
      console.log(
        `[/migrate] Migration completed for ${userId}: ${migratedCount} migrated, ${skippedCount} skipped, ${duplicateCount} duplicates handled`,
      );
    } catch (error) {
      console.error(`[/migrate] Migration failed for ${userId}:`, error);
      await handler.sendMessage(
        channelId,
        `❌ **Migration Failed**\n\nAn error occurred during migration. Please try again or contact support.\n\nError: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  };
};
