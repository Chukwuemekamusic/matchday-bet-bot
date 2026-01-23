/**
 * /odds command handler
 * Show odds for a match
 */

import type {
  CommandHandler,
  CommandEventWithArgs,
  HandlerContext,
} from "../types";
import { matchLookup } from "../../services/matchLookup";
import { getSmartThreadOpts } from "../../utils/threadRouter";
import {
  formatEth,
  formatTime,
  formatOdds,
  timeUntilKickoff,
  isBettingOpen,
  sanitizeArgs,
} from "../../utils/format";

export const createOddsHandler = (
  context: HandlerContext
): CommandHandler<CommandEventWithArgs> => {
  return async (handler, { channelId, args, threadId }) => {
    const opts = getSmartThreadOpts(threadId);
    const cleanArgs = sanitizeArgs(args);

    if (cleanArgs.length < 1) {
      await handler.sendMessage(
        channelId,
        "❌ Usage: `/odds <match #>`\nExample: `/odds 1`",
        opts
      );
      return;
    }

    const matchNum = parseInt(cleanArgs[0]);
    if (isNaN(matchNum) || matchNum < 1) {
      await handler.sendMessage(
        channelId,
        "❌ Invalid match number. Use `/matches` to see available matches.",
        opts
      );
      return;
    }

    // Use match lookup service
    const lookupResult = matchLookup.findByDailyIdOnly(matchNum);
    if (!lookupResult.success) {
      await handler.sendMessage(channelId, lookupResult.errorMessage!, opts);
      return;
    }

    const match = lookupResult.match!;

    // If match hasn't been created on-chain yet OR contract not deployed
    if (
      !match.on_chain_match_id ||
      !context.contractService.isContractAvailable()
    ) {
      const message = `⚽ **${match.home_team} vs ${match.away_team}**
${match.competition}

⏰ Kickoff: ${formatTime(match.kickoff_time)}

${
  context.contractService.isContractAvailable()
    ? "📊 No bets placed yet - be the first!\n\nOdds will update as bets come in."
    : "📊 Betting odds will be available once the smart contract is deployed!\n\nStay tuned for live betting action. ⚡"
}`;
      await handler.sendMessage(channelId, message, opts);
      return;
    }

    // Get pools and odds from contract
    const pools = await context.contractService.getPools(
      match.on_chain_match_id
    );
    const odds = await context.contractService.getOdds(match.on_chain_match_id);

    if (!pools || !odds) {
      await handler.sendMessage(
        channelId,
        "❌ Failed to fetch odds. Please try again.",
        opts
      );
      return;
    }

    const status = isBettingOpen(match.kickoff_time)
      ? "🟢 Betting Open"
      : "🔴 Betting Closed";

    const message = `⚽ **${match.home_team} vs ${match.away_team}**
${match.competition} | ${status}

⏰ Kickoff: ${formatTime(match.kickoff_time)} (${timeUntilKickoff(
      match.kickoff_time
    )})

📊 **Current Odds:** \n\n
• Home (${match.home_team}): ${formatOdds(odds.home)} — Pool: ${formatEth(
      pools.home
    )} ETH \n\n
• Draw: ${formatOdds(odds.draw)} — Pool: ${formatEth(pools.draw)} ETH \n\n
• Away (${match.away_team}): ${formatOdds(odds.away)} — Pool: ${formatEth(
      pools.away
    )} ETH \n\n

💰 **Total Pool:** ${formatEth(pools.total)} ETH

${
  isBettingOpen(match.kickoff_time)
    ? `Use \`/bet ${matchNum} <home|draw|away> <amount>\` to place your bet!`
    : ""
}`;

    await handler.sendMessage(channelId, message, opts);
  };
};
