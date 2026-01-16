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
import { config } from "./config";

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
  nextPollTimeout: NodeJS.Timeout | null; // For dynamic scheduling
}

const schedulerState: SchedulerState = {
  todaysMatches: 0,
  firstKickoff: null,
  lastKickoff: null,
  resultsPollingActive: false,
  resultsPollingInterval: null,
  nextPollTimeout: null,
};

/**
 * Calculate expected finish time for a match
 * Typical match: 90 min + ~5 min stoppage = 95 minutes
 * @param kickoffTime - Unix timestamp of kickoff
 * @returns Unix timestamp of expected finish time
 */
function calculateExpectedFinishTime(kickoffTime: number): number {
  const TYPICAL_MATCH_DURATION = 95 * 60; // 95 minutes in seconds
  return kickoffTime + TYPICAL_MATCH_DURATION;
}

/**
 * Calculate next optimal poll time based on unresolved matches
 * Strategy:
 * - Before expected finish: Don't poll
 * - After expected finish: Poll at +0, +5, +10, +20 min intervals
 * - After 3 hours: Poll every 10 min (fallback for delayed matches)
 * @returns Number of milliseconds until next poll, or null if no polling needed
 */
function calculateNextPollDelay(): number | null {
  const unresolvedMatches = db.getMatchesAwaitingResults();

  if (unresolvedMatches.length === 0) {
    console.log("✅ No unresolved matches - polling not needed");
    return null;
  }

  const now = Math.floor(Date.now() / 1000);

  // Check if we're past the polling window (3h after last kickoff)
  const pollingEnd = schedulerState.lastKickoff
    ? schedulerState.lastKickoff + 3 * 60 * 60
    : null;
  if (pollingEnd && now > pollingEnd) {
    console.log("⏰ Past polling window (3h after last kickoff)");
    return null;
  }

  // Find the earliest time we should poll
  let earliestPollTime = Infinity;

  for (const match of unresolvedMatches) {
    const expectedFinish = calculateExpectedFinishTime(match.kickoff_time);
    const timeSinceExpectedFinish = now - expectedFinish;

    // If match hasn't reached expected finish yet, schedule for expected finish time
    if (timeSinceExpectedFinish < 0) {
      earliestPollTime = Math.min(earliestPollTime, expectedFinish);
      continue;
    }

    // Match has passed expected finish - use progressive intervals
    // Poll at: +0min, +5min, +10min, +20min, then every 10min
    const intervals = [0, 5 * 60, 10 * 60, 20 * 60]; // in seconds

    // Find which interval we're in
    let nextPollTime = expectedFinish;
    for (const interval of intervals) {
      const pollTime = expectedFinish + interval;
      if (now < pollTime) {
        nextPollTime = pollTime;
        break;
      }
    }

    // If we've exhausted intervals, use 10-minute fallback
    if (nextPollTime <= expectedFinish) {
      // Find next 10-minute boundary after the last interval
      const lastInterval = intervals[intervals.length - 1];
      const timeSinceLastInterval = timeSinceExpectedFinish - lastInterval;
      const nextTenMinBoundary =
        Math.ceil(timeSinceLastInterval / (10 * 60)) * (10 * 60);
      nextPollTime = expectedFinish + lastInterval + nextTenMinBoundary;
    }

    earliestPollTime = Math.min(earliestPollTime, nextPollTime);
  }

  // If no valid poll time found, return null
  if (earliestPollTime === Infinity) {
    return null;
  }

  // Convert to milliseconds delay
  const delaySeconds = Math.max(0, earliestPollTime - now);
  const delayMs = delaySeconds * 1000;

  // Log next poll timing
  const nextPollDate = new Date(earliestPollTime * 1000);
  const minutesUntil = Math.ceil(delaySeconds / 60);
  console.log(
    `⏰ Next poll scheduled in ${minutesUntil} minute(s) at ${nextPollDate.toISOString()}`
  );

  return delayMs;
}

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

  // Auto-cancel postponed matches every 15 minutes
  // This checks both past-date postponements and same-day postponements
  intervals.push(
    setInterval(() => {
      autoCancelPostponedMatches();
    }, 15 * 60 * 1000) // 15 minutes
  );

  // Initial fetch on startup (morning fetch logic)
  morningFetch();

  // Initial auto-cancel check on startup
  autoCancelPostponedMatches();

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

  // Stop next poll timeout if active
  if (schedulerState.nextPollTimeout) {
    clearTimeout(schedulerState.nextPollTimeout);
    schedulerState.nextPollTimeout = null;
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

      console.log(
        "🔍 DEBUG - About to insert match:",
        JSON.stringify(matchData, null, 2)
      );
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

    // Assign stable daily IDs based on kickoff order
    db.assignDailyIds();
    console.log(`🔢 Assigned daily IDs to ${matches.length} matches`);

    // Update scheduler state and setup intelligent polling
    schedulerState.todaysMatches = matches.length;

    // Check for unresolved matches from previous days
    const unresolvedMatches = db.getUnresolvedOnChainMatches(48);

    if (matches.length === 0 && unresolvedMatches.length === 0) {
      console.log(
        "📅 No matches today and no unresolved matches. Sleeping until tomorrow."
      );
      stopResultsPolling(); // Ensure polling is stopped
      return;
    }

    if (matches.length === 0 && unresolvedMatches.length > 0) {
      console.log(
        `📅 No matches today, but ${unresolvedMatches.length} unresolved match(es) from previous days need checking`
      );
      // Start polling to resolve yesterday's matches
      startResultsPolling();
      return;
    }

    // Get kickoff range
    const kickoffRange = db.getTodaysKickoffRange();
    if (kickoffRange) {
      schedulerState.firstKickoff = kickoffRange.firstKickoff;
      schedulerState.lastKickoff = kickoffRange.lastKickoff;

      console.log(`⚽ ${matches.length} matches today`);
      console.log(
        `   First kickoff: ${new Date(
          kickoffRange.firstKickoff * 1000
        ).toISOString()}`
      );
      console.log(
        `   Last kickoff: ${new Date(
          kickoffRange.lastKickoff * 1000
        ).toISOString()}`
      );

      // Start smart polling immediately - it will calculate optimal timing
      console.log(
        `🧠 Smart polling will schedule polls based on expected match finish times`
      );
      startResultsPolling();
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
 * Start intelligent results polling with predictive scheduling
 * Uses dynamic intervals based on expected match finish times
 */
function startResultsPolling(): void {
  if (schedulerState.resultsPollingActive) {
    console.log("⚠️ Results polling already active");
    return;
  }

  console.log("🔍 Starting smart predictive results polling");
  schedulerState.resultsPollingActive = true;

  // Schedule next poll dynamically
  scheduleNextPoll();
}

/**
 * Schedule the next poll based on match state
 */
function scheduleNextPoll(): void {
  // Clear any existing timeout
  if (schedulerState.nextPollTimeout) {
    clearTimeout(schedulerState.nextPollTimeout);
    schedulerState.nextPollTimeout = null;
  }

  // Calculate when to poll next
  const delayMs = calculateNextPollDelay();

  if (delayMs === null) {
    // No more polling needed
    stopResultsPolling();
    return;
  }

  // Schedule the poll
  schedulerState.nextPollTimeout = setTimeout(async () => {
    await pollMatchResults();
    // After polling, schedule the next one
    if (schedulerState.resultsPollingActive) {
      scheduleNextPoll();
    }
  }, delayMs);
}

/**
 * Stop results polling
 */
function stopResultsPolling(): void {
  if (!schedulerState.resultsPollingActive) {
    return;
  }

  console.log(
    "✅ Stopping results polling - all matches resolved or polling window ended"
  );
  schedulerState.resultsPollingActive = false;

  if (schedulerState.resultsPollingInterval) {
    clearInterval(schedulerState.resultsPollingInterval);
    schedulerState.resultsPollingInterval = null;
  }

  if (schedulerState.nextPollTimeout) {
    clearTimeout(schedulerState.nextPollTimeout);
    schedulerState.nextPollTimeout = null;
  }
}

/**
 * Poll for match results with intelligent stopping
 * Stops when all matches resolved OR 3 hours after last kickoff
 */
async function pollMatchResults(): Promise<void> {
  const pollStartTime = Date.now();
  const unresolvedMatches = db.getMatchesAwaitingResults();

  // Check if we should stop polling
  const now = Math.floor(Date.now() / 1000);
  const pollingEnd = schedulerState.lastKickoff
    ? schedulerState.lastKickoff + 3 * 60 * 60
    : null;

  if (unresolvedMatches.length === 0) {
    console.log("✅ All matches resolved. Stopping results polling.");
    stopResultsPolling();
    return;
  }

  if (pollingEnd && now > pollingEnd) {
    console.log(
      "⏰ Polling window ended (3h after last kickoff). Stopping results polling."
    );
    stopResultsPolling();
    return;
  }

  console.log(
    `🔍 [Poll #${new Date().toISOString()}] Checking results for ${
      unresolvedMatches.length
    } unresolved matches`
  );

  // Log match states for visibility
  for (const match of unresolvedMatches) {
    const expectedFinish = calculateExpectedFinishTime(match.kickoff_time);
    const minutesSinceExpectedFinish = Math.floor((now - expectedFinish) / 60);
    if (minutesSinceExpectedFinish >= 0) {
      console.log(
        `   📊 ${match.home_team} vs ${match.away_team}: ${minutesSinceExpectedFinish} min past expected finish`
      );
    } else {
      console.log(
        `   ⏳ ${match.home_team} vs ${match.away_team}: ${Math.abs(
          minutesSinceExpectedFinish
        )} min until expected finish`
      );
    }
  }

  // Fetch all today's matches in one API call (more efficient)
  try {
    const apiMatches = await footballApi.getTodaysMatches();

    // Also fetch updates for unresolved matches from previous days
    await footballApi.fetchUnresolvedMatchUpdates();

    const matchesToResolve: Array<{
      dbMatch: any;
      apiMatch: any;
      outcome: number;
    }> = [];

    // First pass: collect all finished matches
    for (const apiMatch of apiMatches) {
      // Only process finished matches
      if (!FootballAPIService.isFinished(apiMatch.status)) {
        // Update to LIVE/IN_PLAY if needed
        if (FootballAPIService.isLive(apiMatch.status)) {
          const dbMatch = db.getMatchByApiId(apiMatch.id!);
          if (dbMatch && dbMatch.status !== "LIVE") {
            db.updateMatchStatus(dbMatch.id, apiMatch.status);
            console.log(
              `🔴 Match ${dbMatch.home_team} vs ${dbMatch.away_team} is now ${apiMatch.status}`
            );
          }
        }
        continue;
      }

      const dbMatch = db.getMatchByApiId(apiMatch.id!);

      // Skip if not found or already resolved (check result, not just status)
      if (
        !dbMatch ||
        (dbMatch.status === "FINISHED" && dbMatch.result !== null)
      ) {
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
      try {
        const homeScore = apiMatch.score.fullTime.home;
        const awayScore = apiMatch.score.fullTime.away;
        db.updateMatchResult(dbMatch.id, homeScore, awayScore, outcome);
      } catch (error) {
        console.error(
          `❌ Failed to update match result for match ${dbMatch.id}:`,
          error
        );
      }
    }

    // Batch resolve on-chain if contract available
    if (
      matchesToResolve.length > 0 &&
      contractServiceInstance?.isContractAvailable()
    ) {
      const onChainMatches = matchesToResolve.filter(
        (m) => m.dbMatch.on_chain_match_id
      );

      if (onChainMatches.length > 0) {
        console.log(
          `📦 Batch resolving ${onChainMatches.length} matches on-chain...`
        );

        const batchData = onChainMatches.map(({ dbMatch, outcome }) => ({
          matchId: dbMatch.on_chain_match_id,
          result: outcome,
          dbMatchId: dbMatch.id,
        }));

        const result = await contractServiceInstance.batchResolveMatches(
          batchData
        );

        if (result) {
          console.log(
            `✅ Successfully batch resolved ${onChainMatches.length} matches (tx: ${result.txHash})`
          );

          // Log each resolved match and post results
          for (const { dbMatch, apiMatch } of onChainMatches) {
            const homeScore = apiMatch.score.fullTime.home;
            const awayScore = apiMatch.score.fullTime.away;
            const outcome = FootballAPIService.determineOutcome(
              homeScore,
              awayScore
            );

            // Get pool info for logging
            const pools = await contractServiceInstance!.getPools(
              dbMatch.on_chain_match_id
            );
            const totalPool = pools ? formatEth(pools.total) : "?";

            // Calculate resolution latency
            const expectedFinish = calculateExpectedFinishTime(
              dbMatch.kickoff_time
            );
            const resolutionLatencyMin = Math.floor(
              (now - expectedFinish) / 60
            );

            console.log(
              `  ✓ ${dbMatch.home_team} ${homeScore}-${awayScore} ${dbMatch.away_team} ` +
                `(${
                  Outcome[outcome!]
                }, Pool: ${totalPool} ETH, Latency: ${resolutionLatencyMin} min after expected finish)`
            );

            // Post result to channel if configured
            await postMatchResult(dbMatch, homeScore, awayScore);
          }
        } else {
          console.error(
            `❌ Batch resolution failed. Falling back to individual resolution.`
          );
          // Fallback to individual resolution
          for (const { dbMatch, apiMatch, outcome } of onChainMatches) {
            await resolveMatchFromAPI(dbMatch, apiMatch);
          }
        }
      }

      // Handle matches without on-chain IDs (just post results)
      const offChainMatches = matchesToResolve.filter(
        (m) => !m.dbMatch.on_chain_match_id
      );
      for (const { dbMatch, apiMatch } of offChainMatches) {
        const homeScore = apiMatch.score.fullTime.home;
        const awayScore = apiMatch.score.fullTime.away;
        console.log(
          `✅ ${dbMatch.home_team} ${homeScore}-${awayScore} ${dbMatch.away_team} (no on-chain bets)`
        );
        await postMatchResult(dbMatch, homeScore, awayScore);
      }
    } else if (matchesToResolve.length > 0) {
      // No contract, just post results
      for (const { dbMatch, apiMatch } of matchesToResolve) {
        const homeScore = apiMatch.score.fullTime.home;
        const awayScore = apiMatch.score.fullTime.away;
        console.log(
          `✅ ${dbMatch.home_team} ${homeScore}-${awayScore} ${dbMatch.away_team}`
        );
        await postMatchResult(dbMatch, homeScore, awayScore);
      }
    }

    // Retry matches that failed to resolve on-chain
    // V3 CONTRACT: Batch resolution is now idempotent (skips already-resolved matches)
    if (contractServiceInstance?.isContractAvailable()) {
      const unresolvedOnChain = db.getMatchesNeedingOnChainResolution();

      if (unresolvedOnChain.length > 0) {
        console.log(
          `🔄 Found ${unresolvedOnChain.length} matches needing on-chain resolution (retry)`
        );

        for (const match of unresolvedOnChain) {
          console.log(
            `   Retrying: ${match.home_team} vs ${match.away_team} (on-chain ID: ${match.on_chain_match_id})`
          );
        }

        // Batch retry resolution (V3 contract will skip already-resolved matches)
        const retryBatchData = unresolvedOnChain.map((match) => ({
          matchId: match.on_chain_match_id!,
          result: match.result!,
          dbMatchId: match.id,
        }));

        const retryResult = await contractServiceInstance.batchResolveMatches(
          retryBatchData
        );

        if (retryResult) {
          console.log(
            `✅ Successfully retried ${unresolvedOnChain.length} matches (tx: ${retryResult.txHash})`
          );
        } else {
          console.error(`❌ Batch retry failed. Will try again on next poll.`);
        }
      }
    }

    // Log poll completion time
    const pollDurationMs = Date.now() - pollStartTime;
    console.log(`✅ Poll completed in ${pollDurationMs}ms`);
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
  if (
    dbMatch.on_chain_match_id &&
    contractServiceInstance?.isContractAvailable()
  ) {
    const pools = await contractServiceInstance.getPools(
      dbMatch.on_chain_match_id
    );
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
async function resolveMatchFromAPI(dbMatch: any, apiMatch: any): Promise<void> {
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
      outcome,
      dbMatch.id
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
 * Auto-cancel postponed matches
 * Cancels matches that are:
 * 1. From past dates (at least 1 day old), OR
 * 2. Same-day postponements after a configured delay (default: 1 hour)
 *
 * Also sends notifications to the channel when matches are cancelled
 */
async function autoCancelPostponedMatches(): Promise<void> {
  if (!contractServiceInstance?.isContractAvailable()) {
    return;
  }

  // Get all postponed matches with on-chain IDs
  const allMatches = db.getAllMatches();
  const postponedMatches = allMatches.filter(
    (m) => m.status === "POSTPONED" && m.on_chain_match_id
  );

  if (postponedMatches.length === 0) {
    return;
  }

  const now = Math.floor(Date.now() / 1000); // Current time in seconds
  const today = new Date();
  const todayStr = `${today.getUTCFullYear()}${String(
    today.getUTCMonth() + 1
  ).padStart(2, "0")}${String(today.getUTCDate()).padStart(2, "0")}`;

  const postponementDelay = config.cancellation.postponementDelay; // Default: 3600 seconds (1 hour)

  let cancelledCount = 0;
  let skippedCount = 0;
  const cancelledMatches: Array<{
    homeTeam: string;
    awayTeam: string;
    competition: string;
    matchCode: string;
  }> = [];

  for (const match of postponedMatches) {
    if (!match.match_code) continue;

    const matchDateStr = match.match_code.split("-")[0];
    const isFromPastDate = matchDateStr < todayStr;
    const isSameDayPostponement = matchDateStr === todayStr;

    // Determine if we should cancel this match
    let shouldCancel = false;
    let cancelReason = "";

    if (isFromPastDate) {
      // Always cancel matches from past dates
      shouldCancel = true;
      cancelReason = "Match from past date - auto-cancelled";
    } else if (isSameDayPostponement && match.postponed_at) {
      // For same-day postponements, check if enough time has passed
      const timeSincePostponed = now - match.postponed_at;
      if (timeSincePostponed >= postponementDelay) {
        shouldCancel = true;
        const hoursWaited = Math.floor(timeSincePostponed / 3600);
        cancelReason = `Same-day postponement - auto-cancelled after ${hoursWaited}h`;
      }
    }

    if (!shouldCancel) {
      continue;
    }

    try {
      // Check on-chain status first to avoid reverting
      const onChainMatch = await contractServiceInstance.getMatch(
        match.on_chain_match_id!
      );

      // Skip if match not found on-chain or already cancelled/resolved
      if (!onChainMatch) {
        console.log(
          `⏭️ Skipping match ${match.match_code} - not found on-chain`
        );
        skippedCount++;
        continue;
      }

      if (
        onChainMatch.status === 3 || // CANCELLED
        onChainMatch.status === 2 // RESOLVED
      ) {
        console.log(
          `⏭️ Skipping match ${match.match_code} - already ${
            onChainMatch.status === 3 ? "cancelled" : "resolved"
          } on-chain`
        );
        // Update local DB to match on-chain status
        if (onChainMatch.status === 3 && match.status !== "CANCELLED") {
          db.updateMatchStatus(match.id, "CANCELLED");
        }
        skippedCount++;
        continue;
      }

      // Proceed with cancellation
      const result = await contractServiceInstance.cancelMatch(
        match.on_chain_match_id!,
        cancelReason
      );

      if (result) {
        db.updateMatchStatus(match.id, "CANCELLED");
        console.log(
          `✅ Auto-cancelled postponed match: ${match.home_team} vs ${match.away_team} (${match.match_code}) - ${cancelReason}`
        );
        cancelledCount++;

        // Track cancelled match for notification
        cancelledMatches.push({
          homeTeam: match.home_team,
          awayTeam: match.away_team,
          competition: match.competition,
          matchCode: match.match_code,
        });
      }
    } catch (error) {
      console.error(
        `❌ Failed to auto-cancel match ${match.id} (${match.match_code}):`,
        error instanceof Error ? error.message : error
      );
    }
  }

  // Send notification to channel if any matches were cancelled
  if (cancelledCount > 0 && botInstance && defaultChannelId) {
    try {
      const matchList = cancelledMatches
        .map((m) => `• **${m.homeTeam} vs ${m.awayTeam}** (${m.competition})`)
        .join("\n");

      await botInstance.sendMessage(
        defaultChannelId,
        `🚫 **Match${cancelledCount > 1 ? "es" : ""} Cancelled**

${matchList}

${cancelledCount > 1 ? "These matches were" : "This match was"} postponed and ${
          cancelledCount > 1 ? "have" : "has"
        } been automatically cancelled.

💰 **Refunds Available:** All bettors can claim refunds using \`/claim\``
      );
    } catch (error) {
      console.error("❌ Failed to send cancellation notification:", error);
    }
  }

  if (cancelledCount > 0 || skippedCount > 0) {
    console.log(
      `🚫 Auto-cancel summary: ${cancelledCount} cancelled, ${skippedCount} skipped`
    );
  }
}

/**
 * Manually trigger a job (for testing/admin)
 */
export async function triggerJob(
  job: "fetch" | "close" | "results" | "cleanup" | "cancel"
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
    case "cancel":
      await autoCancelPostponedMatches();
      break;
  }
}
