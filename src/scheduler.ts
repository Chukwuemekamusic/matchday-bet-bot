/**
 * Scheduler - Handles automated tasks
 *
 * Since Towns bots are webhook-based, we use setInterval for scheduling.
 * In production, you might use a proper job queue or cron service.
 */

import { db } from "./db";
import { footballApi, FootballAPIService } from "./services/footballApi";
import type { ContractService } from "./services/contract";
import { Outcome } from "./types";
import { formatEth } from "./utils/format";

// Store intervals for cleanup
const intervals: NodeJS.Timeout[] = [];

// Store bot reference for posting messages
let botInstance: any = null;
let contractServiceInstance: ContractService | null = null;
let defaultChannelId: string | null = null;

// Scheduler state for intelligent polling
interface SchedulerState {
  todaysMatches: number; // Count of today's matches
  firstKickoff: number | null; // Unix timestamp
  lastKickoff: number | null; // Unix timestamp
  resultsPollingActive: boolean;
  resultsPollingInterval: NodeJS.Timeout | null;
}

const schedulerState: SchedulerState = {
  todaysMatches: 0,
  firstKickoff: null,
  lastKickoff: null,
  resultsPollingActive: false,
  resultsPollingInterval: null,
};

/**
 * Start all scheduled tasks
 * @param bot - The Towns bot instance for posting messages
 * @param contractService - The contract service instance
 */
export function startScheduler(
  bot: any,
  contractService: ContractService
): void {
  botInstance = bot;
  contractServiceInstance = contractService;
  defaultChannelId = process.env.DEFAULT_CHANNEL_ID || null;

  console.log("📅 Starting scheduler...");

  // Morning fetch at 06:00 UTC daily
  // Calculate ms until next 06:00 UTC
  const now = new Date();
  const next6AM = new Date();
  next6AM.setUTCHours(6, 0, 0, 0);
  if (now.getUTCHours() >= 6) {
    // If past 6 AM today, schedule for tomorrow
    next6AM.setUTCDate(next6AM.getUTCDate() + 1);
  }
  const msUntil6AM = next6AM.getTime() - now.getTime();

  console.log(`⏰ Next morning fetch: ${next6AM.toISOString()}`);

  // Schedule daily morning fetch
  setTimeout(() => {
    morningFetch();
    // Repeat daily
    intervals.push(
      setInterval(() => {
        morningFetch();
      }, 24 * 60 * 60 * 1000) // 24 hours
    );
  }, msUntil6AM);

  // Check for matches to close every minute
  intervals.push(
    setInterval(() => {
      closeExpiredBetting();
    }, 60 * 1000) // 1 minute
  );

  // Cleanup expired pending bets every 5 minutes
  intervals.push(
    setInterval(() => {
      cleanupPendingBets();
    }, 5 * 60 * 1000) // 5 minutes
  );

  // Initial fetch on startup (morning fetch logic)
  morningFetch();

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

  // Stop results polling if active
  if (schedulerState.resultsPollingInterval) {
    clearInterval(schedulerState.resultsPollingInterval);
    schedulerState.resultsPollingInterval = null;
  }

  console.log("✅ Scheduler stopped");
}

/**
 * Morning fetch - runs at 06:00 UTC daily
 * Fetches matches and schedules result polling based on kickoff times
 */
async function morningFetch(): Promise<void> {
  console.log("🌅 Morning fetch starting...");

  try {
    const matches = await footballApi.getTodaysMatches();

    if (matches.length === 0) {
      console.log("ℹ️ No matches found for today");
      return;
    }

    let newCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const match of matches) {
      const dbMatch = FootballAPIService.toDBMatch(match);

      // Skip if toDBMatch returned null (invalid data)
      if (!dbMatch) {
        console.warn(`⚠️ Skipping match with invalid data:`, {
          id: match?.id,
          homeTeam: match?.homeTeam?.name,
          awayTeam: match?.awayTeam?.name,
        });
        skippedCount++;
        continue;
      }

      // At this point, we know dbMatch is valid and has api_match_id
      const existing = db.getMatchByApiId(dbMatch.api_match_id);

      // DEBUG: Log the exact data being passed
      const matchData = {
        api_match_id: dbMatch.api_match_id,
        home_team: dbMatch.home_team,
        away_team: dbMatch.away_team,
        competition: dbMatch.competition,
        competition_code: dbMatch.competition_code,
        kickoff_time: dbMatch.kickoff_time,
        status: dbMatch.status,
        home_score: dbMatch.home_score,
        away_score: dbMatch.away_score,
      };

      console.log("🔍 DEBUG - About to insert match:", JSON.stringify(matchData, null, 2));
      console.log("🔍 DEBUG - Types:", {
        api_match_id: typeof dbMatch.api_match_id,
        home_team: typeof dbMatch.home_team,
        away_team: typeof dbMatch.away_team,
      });

      // Only pass fields that upsertMatch expects (matching SQL parameters)
      db.upsertMatch(matchData);

      if (existing) {
        updatedCount++;
      } else {
        newCount++;
      }
    }

    console.log(
      `✅ Matches fetched: ${newCount} new, ${updatedCount} updated${
        skippedCount > 0 ? `, ${skippedCount} skipped` : ""
      }`
    );

    // Update scheduler state and setup intelligent polling
    schedulerState.todaysMatches = matches.length;

    if (matches.length === 0) {
      console.log("📅 No matches today. Sleeping until tomorrow.");
      stopResultsPolling(); // Ensure polling is stopped
      return;
    }

    // Get kickoff range
    const kickoffRange = db.getTodaysKickoffRange();
    if (kickoffRange) {
      schedulerState.firstKickoff = kickoffRange.firstKickoff;
      schedulerState.lastKickoff = kickoffRange.lastKickoff;

      console.log(`⚽ ${matches.length} matches today`);
      console.log(`   First kickoff: ${new Date(kickoffRange.firstKickoff * 1000).toISOString()}`);
      console.log(`   Last kickoff: ${new Date(kickoffRange.lastKickoff * 1000).toISOString()}`);

      // Schedule results polling to start after first match could finish (90 minutes after kickoff)
      const resultsPollingStart = kickoffRange.firstKickoff + (90 * 60);
      const now = Math.floor(Date.now() / 1000);

      if (now < resultsPollingStart) {
        const msUntilPolling = (resultsPollingStart - now) * 1000;
        console.log(`⏰ Results polling will start in ${Math.floor(msUntilPolling / 60000)} minutes`);

        setTimeout(() => {
          startResultsPolling();
        }, msUntilPolling);
      } else {
        // Already past start time, start immediately
        startResultsPolling();
      }
    }
  } catch (error) {
    console.error("❌ Failed to fetch matches:", error);
  }
}

/**
 * Close betting for matches that have started
 */
async function closeExpiredBetting(): Promise<void> {
  // Skip if contract not available
  if (
    !contractServiceInstance ||
    !contractServiceInstance.isContractAvailable()
  ) {
    return;
  }

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
      const result = await contractServiceInstance!.closeBetting(
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
 * Start intelligent results polling
 * Polls every 15 minutes and auto-stops when all matches are resolved
 * or 3 hours after the last kickoff
 */
function startResultsPolling(): void {
  if (schedulerState.resultsPollingActive) {
    console.log("⚠️ Results polling already active");
    return;
  }

  console.log("🔍 Starting results polling (every 15 minutes)");
  schedulerState.resultsPollingActive = true;

  // Poll immediately
  pollMatchResults();

  // Then poll every 15 minutes
  schedulerState.resultsPollingInterval = setInterval(() => {
    pollMatchResults();
  }, 15 * 60 * 1000); // 15 minutes
}

/**
 * Stop results polling
 */
function stopResultsPolling(): void {
  if (!schedulerState.resultsPollingActive) {
    return;
  }

  console.log("✅ Stopping results polling - all matches resolved or polling window ended");
  schedulerState.resultsPollingActive = false;

  if (schedulerState.resultsPollingInterval) {
    clearInterval(schedulerState.resultsPollingInterval);
    schedulerState.resultsPollingInterval = null;
  }
}

/**
 * Poll for match results with intelligent stopping
 * Stops when all matches resolved OR 3 hours after last kickoff
 */
async function pollMatchResults(): Promise<void> {
  const unresolvedMatches = db.getMatchesAwaitingResults();

  // Check if we should stop polling
  const now = Math.floor(Date.now() / 1000);
  const pollingEnd = schedulerState.lastKickoff ? schedulerState.lastKickoff + (3 * 60 * 60) : null;

  if (unresolvedMatches.length === 0) {
    console.log("✅ All matches resolved. Stopping results polling.");
    stopResultsPolling();
    return;
  }

  if (pollingEnd && now > pollingEnd) {
    console.log("⏰ Polling window ended (3h after last kickoff). Stopping results polling.");
    stopResultsPolling();
    return;
  }

  console.log(`🔍 Checking results for ${unresolvedMatches.length} unresolved matches`);

  // Fetch all today's matches in one API call (more efficient)
  try {
    const apiMatches = await footballApi.getTodaysMatches();
    const matchesToResolve: Array<{ dbMatch: any; apiMatch: any; outcome: number }> = [];

    // First pass: collect all finished matches
    for (const apiMatch of apiMatches) {
      // Only process finished matches
      if (!FootballAPIService.isFinished(apiMatch.status)) {
        // Update to LIVE/IN_PLAY if needed
        if (FootballAPIService.isLive(apiMatch.status)) {
          const dbMatch = db.getMatchByApiId(apiMatch.id!);
          if (dbMatch && dbMatch.status !== "LIVE") {
            db.updateMatchStatus(dbMatch.id, apiMatch.status);
            console.log(`🔴 Match ${dbMatch.home_team} vs ${dbMatch.away_team} is now ${apiMatch.status}`);
          }
        }
        continue;
      }

      const dbMatch = db.getMatchByApiId(apiMatch.id!);

      // Skip if not found or already resolved
      if (!dbMatch || dbMatch.status === "FINISHED") {
        continue;
      }

      // Validate scores and outcome
      const homeScore = apiMatch.score.fullTime.home;
      const awayScore = apiMatch.score.fullTime.away;

      if (homeScore === null || awayScore === null) {
        console.warn(`⚠️ Match ${dbMatch.id} finished but no score available`);
        continue;
      }

      const outcome = FootballAPIService.determineOutcome(homeScore, awayScore);

      if (outcome === null) {
        console.error(`❌ Could not determine outcome for match ${dbMatch.id}`);
        continue;
      }

      // Add to batch resolution list
      matchesToResolve.push({ dbMatch, apiMatch, outcome });
    }

    // Update all local databases first
    for (const { dbMatch, apiMatch, outcome } of matchesToResolve) {
      const homeScore = apiMatch.score.fullTime.home;
      const awayScore = apiMatch.score.fullTime.away;
      db.updateMatchResult(dbMatch.id, homeScore, awayScore, outcome);
    }

    // Batch resolve on-chain if contract available
    if (matchesToResolve.length > 0 && contractServiceInstance?.isContractAvailable()) {
      const onChainMatches = matchesToResolve.filter(m => m.dbMatch.on_chain_match_id);

      if (onChainMatches.length > 0) {
        console.log(`📦 Batch resolving ${onChainMatches.length} matches on-chain...`);

        const batchData = onChainMatches.map(({ dbMatch, outcome }) => ({
          matchId: dbMatch.on_chain_match_id,
          result: outcome,
        }));

        const result = await contractServiceInstance.batchResolveMatches(batchData);

        if (result) {
          console.log(`✅ Successfully batch resolved ${onChainMatches.length} matches (tx: ${result.txHash})`);

          // Log each resolved match and post results
          for (const { dbMatch, apiMatch } of onChainMatches) {
            const homeScore = apiMatch.score.fullTime.home;
            const awayScore = apiMatch.score.fullTime.away;
            const outcome = FootballAPIService.determineOutcome(homeScore, awayScore);

            // Get pool info for logging
            const pools = await contractServiceInstance!.getPools(dbMatch.on_chain_match_id);
            const totalPool = pools ? formatEth(pools.total) : "?";

            console.log(
              `  ✓ ${dbMatch.home_team} ${homeScore}-${awayScore} ${dbMatch.away_team} ` +
                `(${Outcome[outcome!]}, Pool: ${totalPool} ETH)`
            );

            // Post result to channel if configured
            await postMatchResult(dbMatch, homeScore, awayScore);
          }
        } else {
          console.error(`❌ Batch resolution failed. Falling back to individual resolution.`);
          // Fallback to individual resolution
          for (const { dbMatch, apiMatch, outcome } of onChainMatches) {
            await resolveMatchFromAPI(dbMatch, apiMatch);
          }
        }
      }

      // Handle matches without on-chain IDs (just post results)
      const offChainMatches = matchesToResolve.filter(m => !m.dbMatch.on_chain_match_id);
      for (const { dbMatch, apiMatch } of offChainMatches) {
        const homeScore = apiMatch.score.fullTime.home;
        const awayScore = apiMatch.score.fullTime.away;
        console.log(`✅ ${dbMatch.home_team} ${homeScore}-${awayScore} ${dbMatch.away_team} (no on-chain bets)`);
        await postMatchResult(dbMatch, homeScore, awayScore);
      }
    } else if (matchesToResolve.length > 0) {
      // No contract, just post results
      for (const { dbMatch, apiMatch } of matchesToResolve) {
        const homeScore = apiMatch.score.fullTime.home;
        const awayScore = apiMatch.score.fullTime.away;
        console.log(`✅ ${dbMatch.home_team} ${homeScore}-${awayScore} ${dbMatch.away_team}`);
        await postMatchResult(dbMatch, homeScore, awayScore);
      }
    }
  } catch (error) {
    console.error("❌ Failed to poll match results:", error);
  }
}

/**
 * Post match result to channel (if configured)
 */
async function postMatchResult(
  dbMatch: any,
  homeScore: number,
  awayScore: number
): Promise<void> {
  if (!botInstance || !defaultChannelId) {
    return;
  }

  const outcome = FootballAPIService.determineOutcome(homeScore, awayScore);
  if (outcome === null) return;

  const winner =
    outcome === Outcome.HOME
      ? dbMatch.home_team
      : outcome === Outcome.AWAY
      ? dbMatch.away_team
      : "Draw";

  let poolInfo = "";
  if (dbMatch.on_chain_match_id && contractServiceInstance?.isContractAvailable()) {
    const pools = await contractServiceInstance.getPools(dbMatch.on_chain_match_id);
    const totalPool = pools ? formatEth(pools.total) : "?";
    poolInfo = `\n💰 Total Pool: ${totalPool} ETH\n\nWinners can now claim using \`/claim\``;
  }

  await botInstance.sendMessage(
    defaultChannelId,
    `🏁 **Match Result**

**${dbMatch.home_team} ${homeScore} - ${awayScore} ${dbMatch.away_team}**

✅ Result: ${winner}${outcome !== Outcome.DRAW ? " wins!" : ""}${poolInfo}`
  );
}

/**
 * Resolve a match from API data
 */
async function resolveMatchFromAPI(
  dbMatch: any,
  apiMatch: any
): Promise<void> {
  const homeScore = apiMatch.score.fullTime.home;
  const awayScore = apiMatch.score.fullTime.away;

  if (homeScore === null || awayScore === null) {
    console.warn(`⚠️ Match ${dbMatch.id} finished but no score available`);
    return;
  }

  const outcome = FootballAPIService.determineOutcome(homeScore, awayScore);

  if (outcome === null) {
    console.error(`❌ Could not determine outcome for match ${dbMatch.id}`);
    return;
  }

  // Update local database
  db.updateMatchResult(dbMatch.id, homeScore, awayScore, outcome);

  // Resolve on-chain if match was created AND contract is available
  if (
    dbMatch.on_chain_match_id &&
    contractServiceInstance &&
    contractServiceInstance.isContractAvailable()
  ) {
    const result = await contractServiceInstance!.resolveMatch(
      dbMatch.on_chain_match_id,
      outcome
    );

    if (result) {
      // Get pool info for logging
      const pools = await contractServiceInstance!.getPools(
        dbMatch.on_chain_match_id
      );
      const totalPool = pools ? formatEth(pools.total) : "?";

      console.log(
        `✅ Resolved ${dbMatch.home_team} ${homeScore}-${awayScore} ${dbMatch.away_team} ` +
          `(Outcome: ${Outcome[outcome]}, Pool: ${totalPool} ETH)`
      );

      // Post result to channel if configured
      await postMatchResult(dbMatch, homeScore, awayScore);
    }
  } else {
    console.log(
      `ℹ️ Match ${dbMatch.home_team} vs ${dbMatch.away_team} finished ` +
        `(${homeScore}-${awayScore})${
          !contractServiceInstance?.isContractAvailable()
            ? " (contract not deployed)"
            : " but was never bet on"
        }`
    );
  }
}

/**
 * Check for match results and resolve on-chain (LEGACY - kept for manual trigger)
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

      // Resolve on-chain if match was created AND contract is available
      if (
        match.on_chain_match_id &&
        contractServiceInstance &&
        contractServiceInstance.isContractAvailable()
      ) {
        const result = await contractServiceInstance!.resolveMatch(
          match.on_chain_match_id,
          outcome
        );

        if (result) {
          // Get pool info for logging
          const pools = await contractServiceInstance!.getPools(
            match.on_chain_match_id
          );
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
            `(${homeScore}-${awayScore})${
              !contractServiceInstance?.isContractAvailable()
                ? " (contract not deployed)"
                : " but was never bet on"
            }`
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
      await morningFetch();
      break;
    case "close":
      await closeExpiredBetting();
      break;
    case "results":
      await pollMatchResults();
      break;
    case "cleanup":
      cleanupPendingBets();
      break;
  }
}
