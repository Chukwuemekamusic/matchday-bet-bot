/**
 * /matches command handler
 * Show today's matches
 */

import type { CommandHandler, CommandEventWithArgs } from "../types";
import { db } from "../../db";
import { formatMatchDisplay } from "../../utils/format";
import { getCompetitionEmoji, LEAGUE_CODE_MAP } from "../../utils/competition";
import type { DBMatch } from "../../types";

export const handleMatches: CommandHandler<CommandEventWithArgs> = async (
  handler,
  { channelId, args }
) => {
  const leagueFilter = args[0]?.toUpperCase();

  let matches = db.getTodaysMatches();

  if (matches.length === 0) {
    await handler.sendMessage(
      channelId,
      "📅 No matches scheduled for today. Check back tomorrow!"
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
      `📅 No ${leagueFilter || ""} matches scheduled for today.`
    );
    return;
  }

  // Group matches by competition
  const grouped = new Map<string, DBMatch[]>();
  for (const match of matches) {
    if (!grouped.has(match.competition)) {
      grouped.set(match.competition, []);
    }
    grouped.get(match.competition)!.push(match);
  }

  let message = "⚽ **Today's Matches**\n\n";

  for (const [competition, compMatches] of grouped) {
    const emoji = getCompetitionEmoji(compMatches[0].competition_code);
    message += `${emoji} **${competition}**\n\n`;

    for (const match of compMatches) {
      message += formatMatchDisplay(match);
    }
  }

  message += "Use `/bet <#> <home|draw|away> <amount>` to place a bet!";

  await handler.sendMessage(channelId, message);
};

