import type {
  CommandHandler,
  CommandEventWithArgs,
  HandlerContext,
} from "../types";
import { getThreadMessageOpts } from "../../utils/threadRouter";
import { isUserAdmin } from "../../utils/wallet";
import { db } from "../../db";
import { config } from "../../config";

export const createDBCheckHandler = (
  context: HandlerContext
): CommandHandler<CommandEventWithArgs> => {
  return async (handler, { channelId, args, eventId, threadId, userId }) => {
    const opts = getThreadMessageOpts(threadId, eventId);

    try {
      // Check if user is admin
      if (!(await isUserAdmin(context.bot, userId as `0x${string}`))) {
        await handler.sendMessage(
          channelId,
          "❌ **Access Denied**\n\nThis command is only available to the bot administrator."
        );
        return;
      }

      // Get database stats
      const todaysMatches = db.getTodaysMatches();
      const recentMatches = db.getRecentMatches(7);
      const allMatches = db.getAllMatches();
      const onChainMatches = db.getAllOnChainMatches();

      // Get date range
      const now = new Date();
      const today = now.toISOString().split("T")[0];
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

      // Build message
      let message = "🔍 **Database Health Check**\n\n";
      message += `📊 **Database Path:** \`${config.database.path}\`\n\n`;
      message += `📅 **Match Counts:**\n`;
      message += `  • Today (${today}): ${todaysMatches.length} matches\n`;
      message += `  • Last 7 days (${sevenDaysAgo} to ${today}): ${recentMatches.length} matches\n`;
      message += `  • Total in DB: ${allMatches.length} matches\n`;
      message += `  • On-chain linked: ${onChainMatches.length} matches\n\n`;

      // Show sample of recent matches if any
      if (recentMatches.length > 0) {
        message += `📋 **Recent Matches (Last 3):**\n`;
        for (const match of recentMatches.slice(0, 3)) {
          const kickoffDate = new Date(match.kickoff_time * 1000)
            .toISOString()
            .split("T")[0];
          message += `  • #${match.daily_id || "?"} ${match.home_team} vs ${
            match.away_team
          }\n`;
          message += `    Date: ${kickoffDate}, On-chain ID: ${
            match.on_chain_match_id || "null"
          }\n`;
        }
      } else {
        message += `⚠️ **No recent matches found in database**\n`;
        message += `Try running \`/fetch YYYY-MM-DD\` to populate the database.\n`;
      }

      message += `\n✅ Database is accessible and responding.`;

      await handler.sendMessage(channelId, message);
    } catch (error) {
      console.error("Error in /dbcheck:", error);
      await handler.sendMessage(
        channelId,
        `❌ **Database Error**\n\nFailed to access database. Error: ${error}\n\nCheck DATABASE_PATH configuration.`
      );
    }
  };
};
