/**
 * /userHasBet command handler
 * Test if a user has bet on a specific match
 */

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
import { matchLookup } from "../../services/matchLookup";
import { isAddress } from "viem";
import { getLinkedWallets } from "../../utils/wallet";

export const createUserHasBetHandler = (
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
      const cleanArgs = sanitizeArgs(args);
      if (cleanArgs.length < 1) {
        await handler.sendMessage(
          channelId,
          `❌ Usage: \`/userHasBet <match #> [user_address]\`

**Examples:**
• \`/userHasBet 1\` - Check if you have bet on match #1
• \`/userHasBet 20260118-2\` - Check if you have bet on specific match code
• \`/userHasBet 1 0x123...\` - Check if specific user has bet on match #1

Use \`/matches\` to see available matches.`,
          opts,
        );
        return;
      }

      const matchInput = args[0];
      // Optional: user address to check (defaults to command sender)
      const targetUserInput = args[1];

      // Use match lookup service
      const lookupResult = matchLookup.findMatch(matchInput, {
        commandName: "/userHasBet",
        suggestionCommand: "/matches",
      });

      if (!lookupResult.success) {
        await handler.sendMessage(channelId, lookupResult.errorMessage!, opts);
        return;
      }

      const match = lookupResult.match!;

      // Check if match is on-chain
      if (!match.on_chain_match_id) {
        await handler.sendMessage(
          channelId,
          `❌ Match hasn't been created on-chain yet.

**${match.home_team} vs ${match.away_team}**

No bets have been placed on this match.`,
          opts,
        );
        return;
      }

      // Determine which user to check
      let targetUserAddress: string;
      let isCommandSender = true;

      if (targetUserInput) {
        // Validate address format
        if (!isAddress(targetUserInput)) {
          await handler.sendMessage(
            channelId,
            `❌ Invalid address format: \`${targetUserInput}\`\n\nPlease provide a valid Ethereum address.`,
            opts,
          );
          return;
        }
        targetUserAddress = targetUserInput.toLowerCase();
        isCommandSender = false;
      } else {
        // Get command sender's smart account
        const smartAccount = await getSmartAccountFromUserId(context.bot, {
          userId: userId as `0x${string}`,
        });
        if (!smartAccount) {
          await handler.sendMessage(
            channelId,
            "❌ Unable to determine your wallet address.",
            opts,
          );
          return;
        }
        targetUserAddress = smartAccount.toLowerCase();
      }

      // Check if user has bet on this match (on-chain)
      const hasBet = await context.contractService.hasUserBet(
        match.on_chain_match_id,
        targetUserAddress,
      );

      const matchCode = match.match_code || `#${match.daily_id || match.id}`;
      const userLabel = isCommandSender
        ? "You"
        : truncateAddress(targetUserAddress);
      const userLabelPossessive = isCommandSender
        ? "Your"
        : `${truncateAddress(targetUserAddress)}'s`;

      if (!hasBet) {
        await handler.sendMessage(
          channelId,
          `🔍 **Bet Check Result**

**Match:** ${match.home_team} vs ${match.away_team} (${matchCode})
**User:** ${userLabel}

❌ **No bet found**

${
  isCommandSender ? "You haven't" : "This user hasn't"
} placed a bet on this match.`,
          opts,
        );
        return;
      }

      // Fetch bet details
      const userBet = await context.contractService.getUserBet(
        match.on_chain_match_id,
        targetUserAddress,
      );

      if (!userBet) {
        // Shouldn't happen if hasUserBet returns true, but handle gracefully
        await handler.sendMessage(
          channelId,
          `⚠️ **Inconsistent State**

The contract indicates ${userLabel.toLowerCase()} ${
            isCommandSender ? "have" : "has"
          } a bet, but couldn't fetch bet details.`,
          opts,
        );
        return;
      }

      const prediction = formatOutcome(userBet.prediction);
      const amount = formatEth(userBet.amount);
      const claimedStatus = userBet.claimed ? "✅ Claimed" : "⏳ Unclaimed";

      await handler.sendMessage(
        channelId,
        `🔍 **Bet Check Result**

**Match:** ${match.home_team} vs ${match.away_team} (${matchCode})
**User:** ${userLabel}

✅ **Bet found!**

**${userLabelPossessive} Bet:**
• Pick: ${prediction}
• Stake: ${amount} ETH
• Status: ${claimedStatus}`,
        opts,
      );
    } catch (error) {
      console.error("userHasBet error:", error);
      await handler.sendMessage(
        channelId,
        `❌ Failed to check bet: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        opts,
      );
    }
  };
};
