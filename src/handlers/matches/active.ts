/**
 * /active command handler
 * Show today's matches with active betting pools (on-chain)
 */

import type { CommandHandler, CommandEventWithArgs } from "../types";
import { db } from "../../db";
import { formatMatchDisplay } from "../../utils/format";
import { getCompetitionEmoji } from "../../utils/competition";
import { getSmartThreadOpts } from "../../utils/threadRouter";
import type { DBMatch } from "../../types";
import { subgraphService } from "../../services/subgraph";

export const handleActive: CommandHandler<CommandEventWithArgs> = async (
  handler,
  { channelId, threadId },
) => {
  const opts = getSmartThreadOpts(threadId);

  const matches = db.getActiveMatches();

  if (matches.length === 0) {
    await handler.sendMessage(
      channelId,
      "📊 No active betting pools today. Be the first to place a bet using `/bet`!",
      opts,
    );
    return;
  }

  // Fetch pool amounts from subgraph (with contract fallback)
  const onChainMatchIds = matches
    .filter((m) => m.on_chain_match_id !== null)
    .map((m) => m.on_chain_match_id!);

  let poolsMap = new Map<number, bigint>();
  if (onChainMatchIds.length > 0) {
    try {
      poolsMap = await subgraphService.getMatchesPools(onChainMatchIds);
    } catch (error) {
      console.warn("⚠️ Failed to fetch pool data:", error);
      // Continue without pool data
    }
  }

  // Group matches by competition
  const grouped = new Map<string, DBMatch[]>();
  for (const match of matches) {
    if (!grouped.has(match.competition)) {
      grouped.set(match.competition, []);
    }
    grouped.get(match.competition)!.push(match);
  }

  // Format the current date
  const today = new Date();
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const formattedDate = dateFormatter.format(today);

  let message = `📊 **Active Betting Pools for ${formattedDate}**\n\n`;
  message += `_${matches.length} ${matches.length === 1 ? "match" : "matches"} with active betting_\n\n`;

  for (const [competition, compMatches] of grouped) {
    const emoji = getCompetitionEmoji(compMatches[0].competition_code);
    message += `${emoji} **${competition}**\n\n`;

    for (const match of compMatches) {
      const poolAmount = match.on_chain_match_id
        ? poolsMap.get(match.on_chain_match_id)
        : undefined;
      message += formatMatchDisplay(match, poolAmount);
    }
  }

  message += "\nUse `/bet <#> <home|draw|away> <amount>` to place a bet!\n";
  message += "Use `/odds <#>` to see current odds for a match.";

  await handler.sendMessage(channelId, message, opts);
};
