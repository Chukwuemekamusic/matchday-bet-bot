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

export const handleActive: CommandHandler<CommandEventWithArgs> = async (
  handler,
  { channelId, threadId }
) => {
  const opts = getSmartThreadOpts(threadId);

  const matches = db.getActiveMatches();

  if (matches.length === 0) {
    await handler.sendMessage(
      channelId,
      "📊 No active betting pools today. Be the first to place a bet using `/bet`!",
      opts
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
      message += formatMatchDisplay(match);
    }
  }

  message += "\nUse `/bet <#> <home|draw|away> <amount>` to place a bet!\n";
  message += "Use `/odds <#>` to see current odds for a match.";

  await handler.sendMessage(channelId, message, opts);
};
