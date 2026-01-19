import type {
  CommandHandler,
  CommandEventWithArgs,
  HandlerContext,
} from "../types";
import { getThreadMessageOpts } from "../../utils/threadRouter";
import { isUserAdmin } from "../../utils/wallet";
import { db } from "../../db";
import { config } from "../../config";

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
        `🔍 Syncing on-chain match IDs (${mode})...\n\nFetching matches created in last 24 hours from subgraph...`
      );

      // Fetch matches created in the last 24 hours from subgraph
      const recentMatches = await context.subgraphService.getRecentMatchCreations(24);

      if (recentMatches.length === 0) {
        await handler.sendMessage(
          channelId,
          "⚠️ No matches found in subgraph for the last 24 hours.\n\nThis could mean:\n- No matches were created on-chain recently\n- Subgraph is not responding\n- Check logs for errors"
        );
        return;
      }
      const updates: Array<{
        onChainId: number;
        dbMatchId: number;
        homeTeam: string;
        awayTeam: string;
        matchCode: string | null;
      }> = [];

      // Check each on-chain match from subgraph
      for (const subgraphMatch of recentMatches) {
        const onChainId = parseInt(subgraphMatch.matchId);
        const homeTeam = subgraphMatch.homeTeam;
        const awayTeam = subgraphMatch.awayTeam;
        const kickoffTime = parseInt(subgraphMatch.kickoffTime);

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
          // Skip if already has on-chain ID
          if (bestMatch.on_chain_match_id !== null) {
            console.log(
              `⚠️ DB match ${bestMatch.id} already has on_chain_match_id: ${bestMatch.on_chain_match_id}, skipping`
            );
            continue;
          }

          updates.push({
            onChainId,
            dbMatchId: bestMatch.id,
            homeTeam: bestMatch.home_team,
            awayTeam: bestMatch.away_team,
            matchCode: bestMatch.match_code,
          });
        } else {
          console.log(
            `⚠️ No DB match found for on-chain match ${onChainId}: ${homeTeam} vs ${awayTeam}`
          );
        }
      }

      // Build result message
      const dbPath = config.database.path.includes("/")
        ? config.database.path.split("/").pop()
        : config.database.path;
      let message = `🔍 Syncing on-chain match IDs (${mode})\n\n`;
      message += `📊 Database: ${dbPath}\n`;
      message += `🔗 Subgraph matches found: ${recentMatches.length}\n\n`;

      if (updates.length === 0) {
        message += "No DB matches found to sync.\n\n";
        message += "This is expected if:\n";
        message += "- Your database doesn't have these matches yet\n";
        message += "- Matches were created on-chain before being fetched from API\n";
        message += "- You're syncing between local and remote databases";
      } else {
        for (const update of updates) {
          message += `Match ${update.onChainId}: ${update.homeTeam} vs ${update.awayTeam}\n`;
          message += `  ✅ Found DB match #${update.dbMatchId}`;
          if (update.matchCode) {
            message += ` (${update.matchCode})`;
          }
          message += `\n`;
          message += `  → ${
            shouldApply ? "Set" : "Would set"
          } on_chain_match_id: ${update.onChainId}\n`;
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
