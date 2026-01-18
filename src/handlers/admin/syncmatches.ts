import type {
  CommandHandler,
  CommandEventWithArgs,
  HandlerContext,
} from "../types";
import { getThreadMessageOpts } from "../../utils/threadRouter";
import { isUserAdmin } from "../../utils/wallet";
import { db } from "../../db";

export const createSyncMatchesHandler = (
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
      const shouldApply = args.includes("--apply");
      const mode = shouldApply ? "APPLY" : "DRY RUN";

      await handler.sendMessage(
        channelId,
        `🔍 Syncing on-chain match IDs (${mode})...\n\nChecking matches 19-25...`
      );

      // Define the range of on-chain match IDs to check
      const onChainMatchIds = [19, 20, 21, 22, 23, 24, 25];
      const updates: Array<{
        onChainId: number;
        dbMatchId: number;
        homeTeam: string;
        awayTeam: string;
        dailyId: number;
        oldMatchCode: string | null;
        newMatchCode: string;
      }> = [];

      // Check each on-chain match
      for (const onChainId of onChainMatchIds) {
        const onChainMatch = await context.contractService.getMatch(onChainId);

        if (!onChainMatch) {
          console.log(`⚠️ On-chain match ${onChainId} not found`);
          continue;
        }

        // Extract match details from contract
        const homeTeam = onChainMatch.homeTeam;
        const awayTeam = onChainMatch.awayTeam;
        const kickoffTime = Number(onChainMatch.kickoffTime);

        // Find matching DB record by team names and kickoff time
        // Use getRecentMatches(7) to search last 7 days instead of just today
        const allMatches = db.getRecentMatches(7);
        let bestMatch = null;

        // Try to find exact match by team names (case-insensitive)
        for (const dbMatch of allMatches) {
          const homeMatch =
            dbMatch.home_team.toLowerCase().includes(homeTeam.toLowerCase()) ||
            homeTeam.toLowerCase().includes(dbMatch.home_team.toLowerCase());
          const awayMatch =
            dbMatch.away_team.toLowerCase().includes(awayTeam.toLowerCase()) ||
            awayTeam.toLowerCase().includes(dbMatch.away_team.toLowerCase());

          // Check if kickoff times are within 5 minutes (300 seconds)
          const timeDiff = Math.abs(dbMatch.kickoff_time - kickoffTime);

          if (homeMatch && awayMatch && timeDiff < 300) {
            bestMatch = dbMatch;
            break;
          }
        }

        if (bestMatch) {
          // Skip if daily_id is null
          if (bestMatch.daily_id === null) {
            console.log(
              `⚠️ DB match ${bestMatch.id} has no daily_id, skipping`
            );
            continue;
          }

          // Generate new match code based on daily_id
          const newMatchCode = db.generateMatchCode(
            bestMatch.kickoff_time,
            bestMatch.daily_id
          );

          updates.push({
            onChainId,
            dbMatchId: bestMatch.id,
            homeTeam: bestMatch.home_team,
            awayTeam: bestMatch.away_team,
            dailyId: bestMatch.daily_id,
            oldMatchCode: bestMatch.match_code,
            newMatchCode,
          });
        } else {
          console.log(
            `⚠️ No DB match found for on-chain match ${onChainId}: ${homeTeam} vs ${awayTeam}`
          );
        }
      }

      // Build result message
      let message = `🔍 Syncing on-chain match IDs (${mode})\n\n`;

      if (updates.length === 0) {
        message += "No matches found to sync.";
      } else {
        for (const update of updates) {
          message += `Match ${update.onChainId}: ${update.homeTeam} vs ${update.awayTeam}\n`;
          message += `  ✅ Found DB match #${update.dbMatchId} (daily_id: ${update.dailyId})\n`;
          message += `  → ${
            shouldApply ? "Set" : "Would set"
          } on_chain_match_id: ${update.onChainId}\n`;

          if (update.oldMatchCode !== update.newMatchCode) {
            message += `  → ${
              shouldApply ? "Updated" : "Would update"
            } match_code: ${update.oldMatchCode || "null"} → ${
              update.newMatchCode
            }\n`;
          }
          message += `\n`;
        }

        message += `\nSummary: ${updates.length} match${
          updates.length > 1 ? "es" : ""
        } ${shouldApply ? "updated" : "would be updated"}`;

        if (!shouldApply) {
          message += `\n\nRun \`/syncmatches --apply\` to apply changes`;
        }

        // Apply changes if --apply flag is set
        if (shouldApply) {
          for (const update of updates) {
            db.setOnChainMatchId(update.dbMatchId, update.onChainId);
            if (update.oldMatchCode !== update.newMatchCode) {
              db.updateMatchCode(update.dbMatchId, update.newMatchCode);
            }
          }
          message += `\n\n✅ Database updated successfully!`;
          console.log(`✅ Synced ${updates.length} matches`);
        }
      }

      await handler.sendMessage(channelId, message);
    } catch (error) {
      console.error("Error in /syncmatches:", error);
      await handler.sendMessage(
        channelId,
        "❌ Failed to sync matches. Check logs for details."
      );
    }
  };
};
