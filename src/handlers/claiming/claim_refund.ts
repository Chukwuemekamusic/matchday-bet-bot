import { getSmartAccountFromUserId } from "@towns-protocol/bot";
import type {
  CommandHandler,
  CommandEventWithArgs,
  HandlerContext,
} from "../types";
import { getThreadMessageOpts } from "../../utils/threadRouter";
import {
  formatEth,
  formatOutcome,
  truncateAddress,
  sanitizeArgs,
} from "../../utils/format";
import type { DBMatch } from "../../types";
import { db } from "../../db";
import { matchLookup } from "../../services/matchLookup";
import {
  interactionService,
  InteractionType,
} from "../../services/interactions";

export const createClaimRefundHandler = (
  context: HandlerContext
): CommandHandler<CommandEventWithArgs> => {
  return async (handler, { channelId, args, userId, eventId, threadId }) => {
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

      // Validate args
      const cleanArgs = sanitizeArgs(args);
      if (cleanArgs.length < 1) {
        await handler.sendMessage(
          channelId,
          `❌ **Invalid Usage**

**Usage:** \`/claim_refund <match #>\` or \`/claim_refund <match code>\`

**Examples:**
  • \`/claim_refund 1\` — Match #1 from today
  • \`/claim_refund 20260108-2\` — Match using match code

Use \`/matches\` to see today's match numbers or \`/mybets\` to see match codes.`,
          opts
        );
        return;
      }

      const input = cleanArgs[0];

      // Use match lookup service
      const lookupResult = matchLookup.findMatch(input, {
        commandName: "/claim_refund",
        suggestionCommand: "/mybets",
      });

      if (!lookupResult.success) {
        await handler.sendMessage(channelId, lookupResult.errorMessage!, opts);
        return;
      }

      let match = lookupResult.match!;

      // Check if match is on-chain
      if (!match.on_chain_match_id) {
        await handler.sendMessage(
          channelId,
          `❌ This match hasn't been created on-chain yet. No bets have been placed.`,
          opts
        );
        return;
      }

      // Try to auto-cancel if match is postponed from a past date
      match = await context.matchOps.tryAutoCancelMatch(match);

      // Get wallet address first (needed for eligibility check)
      const walletAddress = await getSmartAccountFromUserId(context.bot, {
        userId: userId as `0x${string}`,
      });

      if (!walletAddress) {
        await handler.sendMessage(
          channelId,
          `❌ Couldn't retrieve your wallet address. Please try again or contact support.`,
          opts
        );
        return;
      }

      // Check refund eligibility on-chain
      const eligibility = await context.contractService.isRefundEligible(
        match.on_chain_match_id!,
        walletAddress
      );

      if (!eligibility.eligible) {
        const matchCode = match.match_code || `#${match.daily_id || match.id}`;
        let message = `❌ **Not Eligible for Refund**

**Match (${matchCode}):** ${match.home_team} vs ${match.away_team}
**Status:** ${match.status}

`;

        // Add specific reason
        if (eligibility.reason) {
          if (eligibility.reason.includes("Use /claim")) {
            message += `${eligibility.reason}`;
          } else if (eligibility.reason === "Already claimed") {
            message += `You've already claimed your refund for this match.`;
          } else if (eligibility.reason === "No bet found") {
            message += `You didn't place a bet on this match.`;
          } else if (eligibility.reason === "Match resolved - you lost") {
            message += `This match has been resolved and you didn't win. Only cancelled matches are eligible for refunds via this command.`;
          } else {
            message += `Reason: ${eligibility.reason}`;
          }
        }

        await handler.sendMessage(channelId, message, opts);
        return;
      }

      // Get on-chain bet for amount
      const onChainBet = await context.contractService.getUserBet(
        match.on_chain_match_id!,
        walletAddress
      );

      if (!onChainBet || onChainBet.amount === 0n) {
        await handler.sendMessage(
          channelId,
          `❌ Couldn't find your bet on-chain. Please contact support.

Wallet: ${truncateAddress(walletAddress)}`,
          opts
        );
        return;
      }

      // Generate interaction ID using service
      // Use opts?.threadId to ensure we use the same threadId as messages
      const interactionId = interactionService.generateInteractionId(
        InteractionType.CLAIM_REFUND,
        match.id,
        userId,
        opts?.threadId
      );

      const refundAmount = BigInt(onChainBet.amount);

      // Determine status display and reason
      let statusDisplay = match.status;
      let reasonText = "You can claim a full refund of your stake.";

      if (eligibility.reason === "Match cancelled") {
        statusDisplay = "CANCELLED ❌";
        reasonText =
          "This match was cancelled. You can claim a full refund of your stake.";
      }
      // Note: "No winners" case is now handled by /claim (claimWinnings), not /claim_refund
      // isRefundEligible() returns eligible=false for that case

      const message = `💸 **Claim Your Refund**

**Match:** ${match.home_team} vs ${match.away_team}
**Status:** ${statusDisplay}
**Your Stake:** ${formatEth(refundAmount)} ETH
**Refund Amount:** ${formatEth(refundAmount)} ETH

${reasonText}

Ready to claim your refund?`;

      // Send interactive message with buttons using service
      await interactionService.sendFormInteraction(
        handler,
        channelId,
        userId,
        {
          id: interactionId,
          title: "Claim Refund",
          content: message,
          buttons: [
            { id: "refund-confirm", label: "Claim Refund", style: 1 },
            { id: "refund-cancel", label: "Cancel", style: 2 },
          ],
        },
        opts?.threadId
      );
    } catch (error) {
      console.error("Error in /claim_refund command:", error);

      // Check if it's a network error that failed after retries
      const isNetworkError =
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error.code === 9 || error.code === 14 || error.code === 4);

      const errorMessage = isNetworkError
        ? "❌ Network error - Towns Protocol nodes are experiencing issues. Please try again in a few moments."
        : "❌ An error occurred while processing your refund claim. Please try again or contact support.";

      await handler.sendMessage(channelId, errorMessage, opts);
    }
  };
};
