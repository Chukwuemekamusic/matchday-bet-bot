/**
 * /matches command handler
 * Show today's matches
 */

import type { CommandHandler, CommandEventWithArgs } from "../types";
import { db } from "../../db";
import { formatMatchDisplay } from "../../utils/format";
import { getCompetitionEmoji, LEAGUE_CODE_MAP } from "../../utils/competition";
import { getSmartThreadOpts } from "../../utils/threadRouter";
import { subgraphService } from "../../services/subgraph";
import type { DBMatch } from "../../types";

export const handleMatches: CommandHandler<CommandEventWithArgs> = async (
  handler,
  { channelId, args, threadId }
) => {
  const opts = getSmartThreadOpts(threadId);
  const leagueFilter = args[0]?.toUpperCase();

  let matches = db.getTodaysMatches();

  if (matches.length === 0) {
    await handler.sendMessage(
      channelId,
      "📅 No matches scheduled for today. Check back tomorrow!",
      opts
    );
    return;
  }

  // Filter by league if specified
  if (leagueFilter) {
    const code = LEAGUE_CODE_MAP[leagueFilter];
    if (code) {
      matches = matches.filter((m) => m.competition_code === code);
    }
  }

  if (matches.length === 0) {
    await handler.sendMessage(
      channelId,
      `📅 No ${leagueFilter || ""} matches scheduled for today.`,
      opts
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

  let message = `⚽ **Matches for ${formattedDate}**\n\n`;

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

  message += "Use `/bet <#> <home|draw|away> <amount>` to place a bet!";

  await handler.sendMessage(channelId, message, opts);
};
