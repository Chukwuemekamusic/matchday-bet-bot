import type {
  CommandHandler,
  CommandEventWithArgs,
  HandlerContext,
} from "../types";
import { db } from "../../db";
import { getThreadMessageOpts } from "../../utils/threadRouter";
import { footballApi, FootballAPIService } from "../../services/footballApi";
import { isUserAdmin } from "../../utils/wallet";
import { sanitizeArgs } from "../../utils/format";

export const createFetchHandler = (
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
        );
        return;
      }

      // Parse date argument if provided (format: YYYY-MM-DD)
      let targetDate: string;
      let matches: any[];

      const cleanArgs = sanitizeArgs(args);
      if (cleanArgs.length > 0) {
        targetDate = cleanArgs[0];
        // Validate date format (basic check)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
          await handler.sendMessage(
            channelId,
            "❌ Invalid date format. Use YYYY-MM-DD (e.g., 2026-01-17)",
          );
          return;
        }
        matches = await footballApi.getMatchesByDate(targetDate);
      } else {
        targetDate = new Date().toISOString().split("T")[0];
        matches = await footballApi.getTodaysMatches();
      }

      let newCount = 0;
      let skippedCount = 0;

      for (const match of matches) {
        const dbMatch = FootballAPIService.toDBMatch(match);

        // Skip if toDBMatch returned null (invalid data)
        if (!dbMatch) {
          console.warn(`⚠️ Skipping match with invalid data in /fetch:`, {
            id: match?.id,
            homeTeam: match?.homeTeam?.name,
            awayTeam: match?.awayTeam?.name,
          });
          skippedCount++;
          continue;
        }

        // At this point, we know dbMatch is valid and has api_match_id
        const existing = db.getMatchByApiId(dbMatch.api_match_id);

        // Only pass fields that upsertMatch expects (matching SQL parameters)
        db.upsertMatch({
          api_match_id: dbMatch.api_match_id,
          home_team: dbMatch.home_team,
          away_team: dbMatch.away_team,
          competition: dbMatch.competition,
          competition_code: dbMatch.competition_code,
          kickoff_time: dbMatch.kickoff_time,
          status: dbMatch.status,
          home_score: dbMatch.home_score,
          away_score: dbMatch.away_score,
        });

        if (!existing) newCount++;
      }

      await handler.sendMessage(
        channelId,
        `✅ Fetched ${
          matches.length
        } matches for ${targetDate} (${newCount} new${
          skippedCount > 0 ? `, ${skippedCount} skipped` : ""
        })`,
      );
    } catch (error) {
      await handler.sendMessage(
        channelId,
        "❌ Failed to fetch matches. Check API configuration.",
      );
    }
  };
};
