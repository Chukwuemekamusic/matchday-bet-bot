/**
 * Scheduler - Handles automated tasks
 *
 * Since Towns bots are webhook-based, we use setInterval for scheduling.
 * In production, you might use a proper job queue or cron service.
 */

import { db } from "./db";
import { footballApi, FootballAPIService } from "./services/footballApi";
import { contractService } from "./services/contract";
import { Outcome } from "./types";
import { formatEth } from "./utils/format";

// Store intervals for cleanup
const intervals: NodeJS.Timeout[] = [];

// Store bot reference for posting messages
let botInstance: any = null;
let defaultChannelId: string | null = null;

/**
 * Start all scheduled tasks
 * @param bot - The Towns bot instance for posting messages
 */
export function startScheduler(bot: any): void {
  botInstance = bot;
  defaultChannelId = process.env.DEFAULT_CHANNEL_ID || null;

  console.log("📅 Starting scheduler...");

  // Fetch matches every 6 hours
  intervals.push(
    setInterval(() => {
      fetchTodaysMatches();
    }, 6 * 60 * 60 * 1000) // 6 hours
  );

  // Check for matches to close every minute
  intervals.push(
    setInterval(() => {
      closeExpiredBetting();
    }, 60 * 1000) // 1 minute
  );

  // Check for match results every 15 minutes
  intervals.push(
    setInterval(() => {
      checkMatchResults();
    }, 15 * 60 * 1000) // 15 minutes
  );

  // Cleanup expired pending bets every 5 minutes
  intervals.push(
    setInterval(() => {
      cleanupPendingBets();
    }, 5 * 60 * 1000) // 5 minutes
  );

  // Initial fetch on startup
  fetchTodaysMatches();

  console.log("✅ Scheduler started");
}

/**
 * Stop all scheduled tasks
 */
export function stopScheduler(): void {
  console.log("🛑 Stopping scheduler...");
  for (const interval of intervals) {
    clearInterval(interval);
  }
  intervals.length = 0;
  console.log("✅ Scheduler stopped");
}

/**
 * Fetch today's matches from Football API
 */
async function fetchTodaysMatches(): Promise<void> {
  console.log("📥 Fetching today's matches...");

  try {
    const matches = await footballApi.getTodaysMatches();

    if (matches.length === 0) {
      console.log("ℹ️ No matches found for today");
      return;
    }

    let newCount = 0;
    let updatedCount = 0;

    for (const match of matches) {
      const dbMatch = FootballAPIService.toDBMatch(match);
      const existing = db.getMatchByApiId(match.id);

      db.upsertMatch({
        ...dbMatch,
        on_chain_match_id: null,
        result: null,
        total_pool: "0",
        resolved_at: null,
        posted_to_towns: false,
      });

      if (existing) {
        updatedCount++;
      } else {
        newCount++;
      }
    }

    console.log(`✅ Matches fetched: ${newCount} new, ${updatedCount} updated`);
  } catch (error) {
    console.error("❌ Failed to fetch matches:", error);
  }
}

/**
 * Close betting for matches that have started
 */
async function closeExpiredBetting(): Promise<void> {
  const matchesToClose = db.getMatchesToClose();

  if (matchesToClose.length === 0) {
    return;
  }

  console.log(`🔒 Found ${matchesToClose.length} matches to close betting`);

  for (const match of matchesToClose) {
    if (!match.on_chain_match_id) {
      continue;
    }

    try {
      const result = await contractService.closeBetting(
        match.on_chain_match_id
      );

      if (result) {
        db.updateMatchStatus(match.id, "LIVE");
        console.log(
          `✅ Closed betting for ${match.home_team} vs ${match.away_team}`
        );

        // Post to channel if configured
        if (botInstance && defaultChannelId) {
          await botInstance.sendMessage(
            defaultChannelId,
            `🔒 **Betting Closed**\n\n${match.home_team} vs ${match.away_team}\n\nKickoff! Good luck to all bettors! ⚽`
          );
        }
      }
    } catch (error) {
      console.error(`❌ Failed to close betting for match ${match.id}:`, error);
    }
  }
}

/**
 * Check for match results and resolve on-chain
 */
async function checkMatchResults(): Promise<void> {
  const matchesAwaiting = db.getMatchesAwaitingResults();

  if (matchesAwaiting.length === 0) {
    return;
  }

  console.log(`🔍 Checking results for ${matchesAwaiting.length} matches`);

  for (const match of matchesAwaiting) {
    try {
      // Fetch latest status from API
      const apiMatch = await footballApi.getMatch(match.api_match_id);

      // Check if match is finished
      if (!FootballAPIService.isFinished(apiMatch.status)) {
        // Update to LIVE if in play
        if (FootballAPIService.isLive(apiMatch.status)) {
          db.updateMatchStatus(match.id, "LIVE");
        }
        continue;
      }

      // Match is finished - determine outcome
      const homeScore = apiMatch.score.fullTime.home;
      const awayScore = apiMatch.score.fullTime.away;

      if (homeScore === null || awayScore === null) {
        console.warn(`⚠️ Match ${match.id} finished but no score available`);
        continue;
      }

      const outcome = FootballAPIService.determineOutcome(homeScore, awayScore);

      if (outcome === null) {
        console.error(`❌ Could not determine outcome for match ${match.id}`);
        continue;
      }

      // Update local database
      db.updateMatchResult(match.id, homeScore, awayScore, outcome);

      // Resolve on-chain if match was created
      if (match.on_chain_match_id) {
        const result = await contractService.resolveMatch(
          match.on_chain_match_id,
          outcome
        );

        if (result) {
          // Get pool info for logging
          const pools = await contractService.getPools(match.on_chain_match_id);
          const totalPool = pools ? formatEth(pools.total) : "?";

          console.log(
            `✅ Resolved ${match.home_team} ${homeScore}-${awayScore} ${match.away_team} ` +
              `(Outcome: ${Outcome[outcome]}, Pool: ${totalPool} ETH)`
          );

          // Post result to channel if configured
          if (botInstance && defaultChannelId) {
            const winner =
              outcome === Outcome.HOME
                ? match.home_team
                : outcome === Outcome.AWAY
                ? match.away_team
                : "Draw";

            await botInstance.sendMessage(
              defaultChannelId,
              `🏁 **Match Result**

**${match.home_team} ${homeScore} - ${awayScore} ${match.away_team}**

✅ Result: ${winner}${outcome !== Outcome.DRAW ? " wins!" : ""}
💰 Total Pool: ${totalPool} ETH

Winners can now claim using \`/claim\``
            );
          }
        }
      } else {
        console.log(
          `ℹ️ Match ${match.home_team} vs ${match.away_team} finished ` +
            `(${homeScore}-${awayScore}) but was never bet on`
        );
      }
    } catch (error) {
      console.error(`❌ Failed to check result for match ${match.id}:`, error);
    }
  }
}

/**
 * Cleanup expired pending bets
 */
function cleanupPendingBets(): void {
  const cleaned = db.cleanupExpiredPendingBets();
  if (cleaned > 0) {
    console.log(`🧹 Cleaned up ${cleaned} expired pending bets`);
  }
}

/**
 * Manually trigger a job (for testing/admin)
 */
export async function triggerJob(
  job: "fetch" | "close" | "results" | "cleanup"
): Promise<void> {
  switch (job) {
    case "fetch":
      await fetchTodaysMatches();
      break;
    case "close":
      await closeExpiredBetting();
      break;
    case "results":
      await checkMatchResults();
      break;
    case "cleanup":
      cleanupPendingBets();
      break;
  }
}
