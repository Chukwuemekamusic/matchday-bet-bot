/**
 * /claim command handler
 * Claim winnings from a specific match
 */

import { getSmartAccountFromUserId } from "@towns-protocol/bot";
import type {
  CommandHandler,
  CommandEventWithArgs,
  HandlerContext,
} from "../types";
import { getThreadMessageOpts } from "../../utils/threadRouter";
import { formatEth, formatOutcome, truncateAddress } from "../../utils/format";
import type { DBMatch } from "../../types";
import { db } from "../../db";
import { matchLookup } from "../../services/matchLookup";
import {
  interactionService,
  InteractionType,
} from "../../services/interactions";

export const createClaimHandler = (
  context: HandlerContext,
): CommandHandler<CommandEventWithArgs> => {
  return async (handler, { channelId, args, userId, eventId, threadId }) => {
    const opts = getThreadMessageOpts(threadId, eventId);

    try {
      // Check if contract is available
      if (!context.contractService.isContractAvailable()) {
        await handler.sendMessage(
          channelId,
          "❌ Smart contract is not yet deployed. Please contact the admin.",
          opts,
        );
        return;
      }

      // Validate args
      if (args.length < 1) {
        await handler.sendMessage(
          channelId,
          `❌ Usage: \`/claim <match #>\`

Example: \`/claim 1\`

Use \`/claimable\` to see all your unclaimed winnings.`,
          opts,
        );
        return;
      }

      const input = args[0];

      // Use match lookup service
      const lookupResult = matchLookup.findMatch(input, {
        commandName: "/claim",
        suggestionCommand: "/claimable",
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
          opts,
        );
        return;
      }

      // Try to auto-resolve if match is unresolved but enough time has passed
      const resolvedMatch = await context.matchOps.tryAutoResolveMatch(match);

      // Check if match is resolved
      if (resolvedMatch.result === null || resolvedMatch.result === undefined) {
        await handler.sendMessage(
          channelId,
          `⏳ Match hasn't been resolved yet.

**${resolvedMatch.home_team} vs ${resolvedMatch.away_team}**
Status: ${resolvedMatch.status}

You can claim once the match is finished and resolved.`,
          opts,
        );
        return;
      }

      // Get user's bet on this match
      const userBet = db.getUserBetForMatch(userId, resolvedMatch.id);

      if (!userBet) {
        await handler.sendMessage(
          channelId,
          `❌ You didn't place a bet on this match.

**${resolvedMatch.home_team} vs ${resolvedMatch.away_team}**

Use \`/claimable\` to see matches you can claim from.`,
          opts,
        );
        return;
      }

      // Get wallet address (needed for claim status check)
      // If user has a wallet address set, use that, otherwise get the smart account address
      const smartAccount = await getSmartAccountFromUserId(context.bot, {
        userId: userId as `0x${string}`,
      });
      const walletAddress = userBet.wallet_address || smartAccount;

      if (!walletAddress) {
        await handler.sendMessage(
          channelId,
          `❌ Couldn't retrieve your wallet address. Please try again or contact support.`,
          opts,
        );
        return;
      }

      // Get on-chain bet to calculate winnings
      const onChainBet = await context.contractService.getUserBet(
        resolvedMatch.on_chain_match_id!,
        walletAddress,
      );

      if (onChainBet && onChainBet.claimed) {
        await handler.sendMessage(
          channelId,
          `✅ You've already claimed winnings for this match on-chain.

**${resolvedMatch.home_team} vs ${resolvedMatch.away_team}**

Use \`/stats\` to see your total winnings.`,
          opts,
        );
        if (userBet.claimed === 0) {
          // Update DB to match on-chain state
          db.updateBetClaimed(userId, resolvedMatch.id);
        }
        return;
      }

      // Use V2's getClaimStatus to determine eligibility
      // This handles both regular wins AND "no winners" refund cases
      const claimStatus = await context.contractService.getClaimStatus(
        resolvedMatch.on_chain_match_id!,
        walletAddress,
      );

      if (!onChainBet?.claimed && (!claimStatus || !claimStatus.canClaim)) {
        // Check if it's because they didn't win (not a "no winners" case)
        if (userBet.prediction !== resolvedMatch.result) {
          const userPrediction = formatOutcome(userBet.prediction);
          const actualResult = formatOutcome(resolvedMatch.result);

          await handler.sendMessage(
            channelId,
            `😔 You lost this match.

**${resolvedMatch.home_team} vs ${resolvedMatch.away_team}**
Your Prediction: ${userPrediction}
Result: ${actualResult}

Better luck next time!`,
            opts,
          );
          return;
        }

        // Some other reason they can't claim
        await handler.sendMessage(
          channelId,
          `❌ Unable to claim winnings for this match. ${
            claimStatus
              ? "Reason: " +
                (claimStatus.claimType === 0 ? "Not eligible" : "Unknown")
              : "Please contact support."
          }`,
          opts,
        );
        return;
      }

      // claimType: 0 = none, 1 = winnings (includes "no winners" refund), 2 = refund (cancelled) ==
      if (claimStatus.claimType !== 1) {
        await handler.sendMessage(
          channelId,
          `❌ This match requires a refund claim, not a winnings claim.

Use \`/claim_refund ${resolvedMatch.match_code || resolvedMatch.id}\` instead.`,
          opts,
        );
        return;
      }

      // Check if already claimed
      if (userBet.claimed === 1 && !onChainBet?.claimed) {
        // change userBet.claimed to 0
      }

      if (!onChainBet) {
        await handler.sendMessage(
          channelId,
          `❌ Couldn't find your bet on-chain. Please contact support.

Wallet: ${truncateAddress(walletAddress)}`,
          opts,
        );
        return;
      }

      // Use claimStatus amount (already calculated by V2)
      const potentialWinnings = claimStatus.amount;

      if (!potentialWinnings || potentialWinnings === 0n) {
        await handler.sendMessage(
          channelId,
          `⚠️ Winnings calculation returned 0 ETH. This might be a pool issue. Please contact support.

**${resolvedMatch.home_team} vs ${resolvedMatch.away_team}**`,
          opts,
        );
        return;
      }

      // Generate interaction ID using service
      // Use opts?.threadId to ensure we use the same threadId as messages
      const interactionId = interactionService.generateInteractionId(
        InteractionType.CLAIM,
        resolvedMatch.id,
        userId,
        opts?.threadId,
      );

      const stakeAmount = BigInt(onChainBet.amount);
      const profit = potentialWinnings - stakeAmount;

      // Check if this is a "no winners" refund case (payout = stake)
      const isNoWinnersRefund =
        profit === 0n && userBet.prediction !== resolvedMatch.result;

      let message: string;
      if (isNoWinnersRefund) {
        message = `💰 **Claim Your Refund**

**Match:** ${resolvedMatch.home_team} vs ${resolvedMatch.away_team}
**Your Prediction:** ${formatOutcome(userBet.prediction)}
**Actual Result:** ${formatOutcome(resolvedMatch.result)}
**Stake:** ${formatEth(stakeAmount)} ETH
**Refund Amount:** ${formatEth(potentialWinnings)} ETH

ℹ️ **No one predicted the correct outcome.** Everyone gets a full refund of their stake.

Ready to claim your refund?`;
      } else {
        message = `💰 **Claim Your Winnings**

**Match:** ${resolvedMatch.home_team} vs ${resolvedMatch.away_team}
**Your Prediction:** ${formatOutcome(userBet.prediction)} ✅
**Stake:** ${formatEth(stakeAmount)} ETH
**Payout:** ${formatEth(potentialWinnings)} ETH
**Profit:** ${formatEth(profit)} ETH

Ready to claim your winnings?`;
      }

      // Add wallet guidance message
      const walletInfo =
        smartAccount &&
        walletAddress.toLowerCase() === smartAccount.toLowerCase()
          ? "your **Towns smart account**"
          : `your **linked wallet** (${truncateAddress(walletAddress)})`;

      message += `\n\n📝 **Important:** You placed this bet with ${walletInfo}. Please sign the transaction with the same wallet.`;

      // Send interactive message with buttons using service
      await interactionService.sendFormInteraction(
        handler,
        channelId,
        userId,
        {
          id: interactionId,
          title: "Claim Winnings",
          content: message,
          buttons: [
            { id: "claim-confirm", label: "Claim Winnings", style: 1 },
            { id: "claim-cancel", label: "Cancel", style: 2 },
          ],
        },
        opts?.threadId,
      );

      // Store claim context in a temporary table/map
      // For now, we'll track it by storing matchId in the interaction ID
      // The onInteractionResponse handler will parse it
    } catch (error) {
      console.error("Error in /claim command:", error);

      // Check if it's a network error that failed after retries
      const isNetworkError =
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error.code === 9 || error.code === 14 || error.code === 4);

      const errorMessage = isNetworkError
        ? "❌ Network error - Towns Protocol nodes are experiencing issues. Please try again in a few moments."
        : "❌ An error occurred while processing your claim. Please try again or contact support.";

      await handler.sendMessage(channelId, errorMessage, opts);
    }
  };
};
