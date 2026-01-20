import type {
  CommandHandler,
  CommandEventWithArgs,
  HandlerContext,
} from "../types";
import { getThreadMessageOpts } from "../../utils/threadRouter";
import { isUserAdmin } from "../../utils/wallet";
import { db } from "../../db";
import { matchLookup } from "../../services/matchLookup";
import { footballApi, FootballAPIService } from "../../services/footballApi";
import { formatOutcome, formatEth } from "../../utils/format";

export const createResolveHandler = (
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

      // Validate arguments
      if (args.length !== 1) {
        await handler.sendMessage(
          channelId,
          `❌ **Invalid Usage**

**Usage:** \`/resolve <match#|match_code>\`

**Examples:**
  \`/resolve 1\` (today's match #1)
  \`/resolve 20260111-2\` (specific match by code)

Use \`/matches\` to see today's match numbers.`,
          opts,
        );
        return;
      }

      const input = args[0];

      // Use match lookup service
      const lookupResult = matchLookup.findMatch(input, {
        commandName: "/resolve",
        suggestionCommand: "/matches",
      });

      if (!lookupResult.success) {
        await handler.sendMessage(channelId, lookupResult.errorMessage!, opts);
        return;
      }

      const match = lookupResult.match!;

      // Check if match has on-chain ID
      if (!match.on_chain_match_id) {
        const matchDisplay =
          match.match_code || `#${match.daily_id || match.id}`;
        await handler.sendMessage(
          channelId,
          `❌ **Cannot Resolve Match**

**Match ${matchDisplay}:** ${match.home_team} vs ${match.away_team}

This match hasn't been created on-chain yet (no bets placed).`,
          opts,
        );
        return;
      }

      // Check if already resolved
      if (match.status === "FINISHED" && match.result !== null) {
        const matchDisplay =
          match.match_code || `#${match.daily_id || match.id}`;
        await handler.sendMessage(
          channelId,
          `ℹ️ **Match Already Resolved**

**Match ${matchDisplay}:** ${match.home_team} vs ${match.away_team}
**Score:** ${match.home_score} - ${match.away_score}
**Result:** ${formatOutcome(match.result)}`,
          opts,
        );
        return;
      }

      // Fetch latest match data from API
      await handler.sendMessage(
        channelId,
        `🔍 Fetching latest match data for **${match.home_team} vs ${match.away_team}**...`,
        opts,
      );

      const apiMatch = await footballApi.getMatch(match.api_match_id);

      // Check if match is postponed or cancelled
      if (FootballAPIService.isPostponed(apiMatch.status)) {
        const matchDisplay =
          match.match_code || `#${match.daily_id || match.id}`;
        await handler.sendMessage(
          channelId,
          `🚫 **Match Postponed/Cancelled**

**Match ${matchDisplay}:** ${match.home_team} vs ${match.away_team}
**Status:** ${apiMatch.status}
**On-Chain Match ID:** ${match.on_chain_match_id}

Checking on-chain status...`,
        );

        // Check on-chain status first to avoid reverting
        const onChainMatch = await context.contractService.getMatch(
          match.on_chain_match_id,
        );

        if (!onChainMatch) {
          await handler.sendMessage(
            channelId,
            `❌ **Match Not Found On-Chain**

**Match ID:** ${match.on_chain_match_id}

The match was not found on the blockchain. It may have been deleted or never created.`,
          );
          return;
        }

        // Check if already cancelled or resolved
        if (onChainMatch.status === 3) {
          // Already CANCELLED
          db.updateMatchStatus(match.id, "CANCELLED");
          await handler.sendMessage(
            channelId,
            `ℹ️ **Match Already Cancelled**

**Match ID:** ${match.on_chain_match_id}
**On-Chain Status:** CANCELLED (${onChainMatch.status})

This match is already cancelled on-chain. Bettors can claim refunds using \`/claim\``,
          );
          return;
        }

        if (onChainMatch.status === 2) {
          // Already RESOLVED
          await handler.sendMessage(
            channelId,
            `❌ **Match Already Resolved**

**Match ID:** ${match.on_chain_match_id}
**On-Chain Status:** RESOLVED (${onChainMatch.status})

This match has already been resolved on-chain and cannot be cancelled.`,
          );
          return;
        }

        // Cancel on-chain
        await handler.sendMessage(
          channelId,
          `⏳ Cancelling match on-chain and enabling refunds...`,
        );

        const cancelReason = `Match ${apiMatch.status.toLowerCase()} - manually cancelled by admin`;
        const cancelResult = await context.contractService.cancelMatch(
          match.on_chain_match_id,
          cancelReason,
        );

        if (!cancelResult) {
          await handler.sendMessage(
            channelId,
            `❌ **On-Chain Cancellation Failed**

Failed to cancel the match on-chain. Check logs for details.`,
          );
          return;
        }

        // Update local database
        db.updateMatchStatus(match.id, "CANCELLED");

        // Get pool info for refund message
        const pools = await context.contractService.getPools(
          match.on_chain_match_id,
        );
        const totalPool = pools ? formatEth(pools.total) : "?";

        // Success message
        await handler.sendMessage(
          channelId,
          `✅ **Match Cancelled Successfully**

🚫 **${match.home_team} vs ${match.away_team}**
📊 **Total Pool:** ${totalPool} ETH
🔗 **Transaction:** [View on BaseScan](https://basescan.org/tx/${cancelResult.txHash})

💰 **Refunds Available:** All bettors can claim full refunds using \`/claim\``,
        );
        return;
      }

      // Check if match is finished
      if (!FootballAPIService.isFinished(apiMatch.status)) {
        const matchDisplay =
          match.match_code || `#${match.daily_id || match.id}`;
        await handler.sendMessage(
          channelId,
          `❌ **Match Not Finished**

**Match ${matchDisplay}:** ${match.home_team} vs ${match.away_team}
**Status:** ${apiMatch.status}

Cannot resolve a match that hasn't finished yet.
💡 **Tip:** If the match is postponed/cancelled, run \`/resolve ${input}\` again to cancel it on-chain.`,
        );
        return;
      }

      // Get scores
      const homeScore = apiMatch.score.fullTime.home;
      const awayScore = apiMatch.score.fullTime.away;

      if (homeScore === null || awayScore === null) {
        await handler.sendMessage(
          channelId,
          `❌ **No Score Available**

Match is marked as finished but scores are not available yet. Please try again later.`,
          opts,
        );
        return;
      }

      // Determine outcome
      const outcome = FootballAPIService.determineOutcome(homeScore, awayScore);

      if (outcome === null) {
        await handler.sendMessage(
          channelId,
          `❌ **Error Determining Outcome**

Could not determine match outcome from scores: ${homeScore} - ${awayScore}`,
          opts,
        );
        return;
      }

      // Update local database
      db.updateMatchResult(match.id, homeScore, awayScore, outcome);

      // Resolve on-chain
      await handler.sendMessage(
        channelId,
        `⏳ Resolving match on-chain...\n\n**${
          match.home_team
        } ${homeScore} - ${awayScore} ${
          match.away_team
        }**\n**Result:** ${formatOutcome(outcome)}`,
        opts,
      );

      const result = await context.contractService.resolveMatch(
        match.on_chain_match_id,
        outcome,
      );

      if (!result) {
        await handler.sendMessage(
          channelId,
          `❌ **On-Chain Resolution Failed**

The match result was saved locally but the on-chain transaction failed. Check logs for details.`,
          opts,
        );
        return;
      }

      // Get pool info
      const pools = await context.contractService.getPools(
        match.on_chain_match_id,
      );
      const totalPool = pools ? formatEth(pools.total) : "?";

      // Success message
      const matchCode = match.match_code || `${match.daily_id}`;
      await handler.sendMessage(
        channelId,
        `✅ **Match Resolved Successfully**

🏁 **${match.home_team} ${homeScore} - ${awayScore} ${match.away_team}**

**Result:** ${formatOutcome(outcome)}
💰 **Total Pool:** ${totalPool} ETH
🔗 **Transaction:** \`${result.txHash}\`

Winners can now claim their winnings using \`/claim ${matchCode}\``,
        opts,
      );
    } catch (error) {
      console.error("Error in /resolve command:", error);
      await handler.sendMessage(
        channelId,
        `❌ **Resolution Failed**

**Error:** ${error instanceof Error ? error.message : "Unknown error"}

Please check the logs for more details.`,
        opts,
      );
    }
  };
};
