import type {
  CommandHandler,
  CommandEventWithArgs,
  HandlerContext,
} from "../types";
import { matchLookup } from "../../services/matchLookup";
import { db } from "../../db";
import { getSmartThreadOpts } from "../../utils/threadRouter";
import { formatOutcome, formatEth, truncateAddress } from "../../utils/format";

export const createWinnersHandler =
  (context: HandlerContext): CommandHandler<CommandEventWithArgs> =>
  async (handler, { channelId, args, threadId }) => {
    const opts = getSmartThreadOpts(threadId);
    if (args.length < 1) {
      await handler.sendMessage(
        channelId,
        `❌ **Invalid Usage**

**Usage:** \`/winners <match#|match_code>\`

**Examples:**
  \`/winners 1\` (today's match #1)
  \`/winners 20260110-4\` (specific match by code)

Use \`/matches\` to see today's match numbers.`,
        opts
      );
      return;
    }

    const input = args[0];

    try {
      // Use match lookup service
      const lookupResult = matchLookup.findMatch(input, {
        commandName: "/winners",
        suggestionCommand: "/matches",
      });

      if (!lookupResult.success) {
        await handler.sendMessage(channelId, lookupResult.errorMessage!, opts);
        return;
      }

      const match = lookupResult.match!;

      // Check if match is finished
      if (match.status !== "FINISHED") {
        await handler.sendMessage(
          channelId,
          `❌ **Match Not Finished**

This match hasn't finished yet. Current status: ${match.status}

Winners will be available once the match is resolved.`,
          opts
        );
        return;
      }

      // Check if match has result
      if (match.result === null) {
        await handler.sendMessage(
          channelId,
          `❌ **Match Not Resolved**

This match is finished but hasn't been resolved yet. Use \`/resolve ${
            match.match_code || match.daily_id
          }\` to resolve it (admin only).`,
          opts
        );
        return;
      }

      // Check if match has on-chain ID
      if (!match.on_chain_match_id) {
        await handler.sendMessage(
          channelId,
          `ℹ️ **No Bets Placed**

No bets were placed on this match (not created on-chain).`,
          opts
        );
        return;
      }

      // Get all bets for this match
      const allBets = db.getBetsForMatch(match.id);

      if (allBets.length === 0) {
        await handler.sendMessage(
          channelId,
          `ℹ️ **No Bets Placed**

No bets were placed on this match (not created on-chain).`,
          opts
        );
        return;
      }

      // Calculate winners
      const winners = allBets.filter((bet) => bet.prediction === match.result);
      const losers = allBets.filter((bet) => bet.prediction !== match.result);

      // Count losers by outcome (1=Home, 2=Draw, 3=Away)
      const losersByOutcome = losers.reduce((acc, bet) => {
        acc[bet.prediction] = (acc[bet.prediction] || 0) + 1;
        return acc;
      }, {} as Record<number, number>);

      // sort winners by amount
      winners.sort((a, b) => {
        const amountA = BigInt(a.amount);
        const amountB = BigInt(b.amount);
        return amountA > amountB ? -1 : amountA < amountB ? 1 : 0;
      });

      // Build message
      const matchCode = match.match_code || `#${match.daily_id || match.id}`;
      const score =
        match.home_score !== null && match.away_score !== null
          ? `${match.home_score}-${match.away_score}`
          : "";

      let message = `🏆 **Match Winners**\n\n`;
      message += `⚽ **${match.home_team} ${score} ${match.away_team}** (${matchCode})\n`;
      message += `**Result:** ${formatOutcome(match.result)}\n\n`;

      if (winners.length === 0) {
        message += `ℹ️ **No Winners**\n\n`;
        message += `All bettors lost this match. Pool will be redistributed or handled according to contract rules.\n\n`;
      } else {
        message += `💰 **Winning Bettors (${formatOutcome(
          match.result
        )}):**\n\n`;

        // Fetch payouts for all winners
        for (let i = 0; i < winners.length; i++) {
          const bet = winners[i];
          const betAmount = BigInt(bet.amount);
          const payout =
            await context.contractService.calculatePotentialWinnings(
              match.on_chain_match_id,
              bet.prediction,
              betAmount
            );

          const addressDisplay = truncateAddress(bet.wallet_address);
          const betEth = formatEth(betAmount);
          const payoutEth = payout ? formatEth(payout) : "?";
          const claimedIcon = bet.claimed ? "✅ Claimed" : "⏳ Unclaimed";

          message += `${
            i + 1
          }. ${addressDisplay} - Bet: ${betEth} ETH → Payout: ${payoutEth} ETH ${claimedIcon}\n`;
        }
        message += "\n";
      }

      // Add summary stats
      message += `📊 **Summary:**\n`;
      message += `• Total Winners: ${winners.length} (${formatOutcome(
        match.result
      )})\n`;

      const loserCount =
        (losersByOutcome[1] || 0) +
        (losersByOutcome[2] || 0) +
        (losersByOutcome[3] || 0);
      if (loserCount > 0) {
        const loserBreakdown: string[] = [];
        if (losersByOutcome[1] > 0)
          loserBreakdown.push(`Home: ${losersByOutcome[1]}`);
        if (losersByOutcome[2] > 0)
          loserBreakdown.push(`Draw: ${losersByOutcome[2]}`);
        if (losersByOutcome[3] > 0)
          loserBreakdown.push(`Away: ${losersByOutcome[3]}`);
        message += `• Total Losers: ${loserCount} (${loserBreakdown.join(
          ", "
        )})\n`;
      }

      message += `• Total Pool: ${formatEth(match.total_pool)} ETH`;

      await handler.sendMessage(channelId, message, opts);
    } catch (error) {
      console.error("Error in /winners command:", error);
      await handler.sendMessage(
        channelId,
        `❌ **Error**

An error occurred while fetching match winners. Please try again.

**Error:** ${error instanceof Error ? error.message : "Unknown error"}`,
        opts
      );
    }
  };
