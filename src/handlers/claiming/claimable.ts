/**
 * /claimable command handler
 * Lists all unclaimed winnings and refunds for a user
 */

import { getSmartAccountFromUserId } from "@towns-protocol/bot";
import type {
  CommandHandler,
  BaseCommandEvent,
  HandlerContext,
} from "../types";
import { getThreadMessageOpts } from "../../utils/threadRouter";
import { formatOutcome } from "../../utils/format";

export const createClaimableHandler = (
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

      // Get claimable matches from subgraph (with database fallback)
      const result = await context.subgraphService.getUserClaimable(
        walletAddress
      );
      const { winnings, refunds } = result.data;

      // If nothing to claim
      if (winnings.length === 0 && refunds.length === 0) {
        await handler.sendMessage(
          channelId,
          `📭 **No Unclaimed Winnings**

You don't have any unclaimed winnings or refunds at the moment.

Use \`/matches\` to see today's matches and place new bets!`,
          opts
        );
        return;
      }

      let message = `💰 **Your Claimable Matches**\n\n`;

      // Add data source indicator (for debugging)
      if (result.source === "fallback") {
        message += `⚠️ _Using fallback data source_\n\n`;
      }

      // Show winnings section
      if (winnings.length > 0) {
        message += `🏆 **Winnings (${winnings.length})**\n\n`;

        for (const match of winnings) {
          message += `**${match.homeTeam} vs ${match.awayTeam}** (${match.matchCode})\n`;
          message += `├ Competition: ${match.competition}\n`;
          message += `├ Your Pick: ${formatOutcome(match.prediction)} ✅\n`;
          message += `├ Stake: ${match.amount} ETH\n`;

          if (match.payout && match.profit) {
            message += `├ Payout: ${match.payout} ETH\n`;
            message += `└ Profit: ${match.profit} ETH\n\n`;
          } else {
            message += `└ Status: Ready to claim\n\n`;
          }
        }
      }

      // Show refunds section
      if (refunds.length > 0) {
        message += `💰 **Refunds (${refunds.length})**\n\n`;

        for (const match of refunds) {
          message += `**${match.homeTeam} vs ${match.awayTeam}** (${match.matchCode})\n`;
          message += `├ Competition: ${match.competition}\n`;
          message += `├ Your Pick: ${formatOutcome(match.prediction)}\n`;
          message += `├ Refund Amount: ${match.amount} ETH\n`;
          message += `└ Reason: ${match.reason || "Match cancelled"}\n\n`;
        }
      }

      message += `━━━━━━━━━━━━━━━━━\n`;

      // Show example claim commands
      if (winnings.length > 0) {
        message += `Use \`/claim ${winnings[0].matchCode}\` to claim winnings.\n`;
      }
      if (refunds.length > 0) {
        // For "no winners" refunds, use /claim; for cancelled, use /claim_refund
        const refundMatch = refunds[0];
        if (refundMatch.reason?.includes("No winners")) {
          message += `Use \`/claim ${refundMatch.matchCode}\` to claim refund.`;
        } else {
          message += `Use \`/claim_refund ${refundMatch.matchCode}\` to claim refund.`;
        }
      }

      await handler.sendMessage(channelId, message, opts);
    } catch (error) {
      console.error("Error in /claimable command:", error);
      await handler.sendMessage(
        channelId,
        "❌ An error occurred while fetching your claimable matches. Please try again or contact support.",
        opts
      );
    }
  };
};
