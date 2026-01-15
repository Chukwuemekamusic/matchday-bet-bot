/**
 * Match Operations Service
 *
 * Handles business logic for match operations including:
 * - Auto-resolution of finished matches
 * - Auto-cancellation of postponed matches
 *
 * This service orchestrates between the database, contract service, and football API
 * to perform complex match state transitions.
 */

import { db } from "../db";
import { footballApi, FootballAPIService } from "./footballApi";
import type { ContractService } from "./contract";
import { DBMatch, Outcome } from "../types";

export class MatchOperationsService {
  constructor(private contractService: ContractService) {}

  /**
   * Attempt to auto-resolve a match if it has passed its expected finish time
   * This helps catch matches that finished but weren't resolved yet
   * Returns the updated match if resolution succeeded, or the original match if not
   */
  async tryAutoResolveMatch(match: DBMatch): Promise<DBMatch> {
    // Only try if match is unresolved and has an on-chain ID
    if (match.result !== null || !match.on_chain_match_id) {
      return match;
    }

    // Don't try to resolve postponed matches - they should be cancelled instead
    if (match.status === "POSTPONED") {
      return match;
    }

    // Check if enough time has passed since kickoff (3 hours)
    const now = Math.floor(Date.now() / 1000);
    const timeSinceKickoff = now - match.kickoff_time;
    const threeHours = 3 * 60 * 60;

    if (timeSinceKickoff <= threeHours) {
      return match; // Too soon to auto-resolve
    }

    console.log(
      `🔄 Auto-resolve attempt for match ${match.match_code || match.id}: ${
        match.home_team
      } vs ${match.away_team} (Status: ${
        match.status
      }, Reason: 3+ hours since kickoff)`
    );

    try {
      // Fetch latest match data from API
      const apiMatch = await footballApi.getMatch(match.api_match_id);

      // Check if match is now finished
      if (!FootballAPIService.isFinished(apiMatch.status)) {
        console.log(
          `   ℹ️ Match still not finished (Status: ${apiMatch.status})`
        );
        return match;
      }

      // Get scores
      const homeScore = apiMatch.score.fullTime.home;
      const awayScore = apiMatch.score.fullTime.away;

      if (homeScore === null || awayScore === null) {
        console.log(`   ⚠️ Match finished but no scores available`);
        return match;
      }

      // Determine outcome
      const outcome = FootballAPIService.determineOutcome(homeScore, awayScore);

      if (outcome === null) {
        console.log(`   ❌ Could not determine outcome`);
        return match;
      }

      // Update database
      db.updateMatchResult(match.id, homeScore, awayScore, outcome);
      console.log(
        `   ✅ Database updated: ${homeScore}-${awayScore} (${Outcome[outcome]})`
      );

      // Resolve on-chain if contract is available
      if (this.contractService.isContractAvailable()) {
        const result = await this.contractService.resolveMatch(
          match.on_chain_match_id,
          outcome
        );

        if (result) {
          console.log(
            `   ✅ On-chain resolution successful for match ${match.on_chain_match_id}`
          );
        } else {
          console.log(`   ⚠️ On-chain resolution failed, but database updated`);
        }
      }

      // Return updated match
      const updatedMatch = db.getMatchById(match.id);
      if (updatedMatch) {
        console.log(
          `   🎉 Auto-resolution complete! Match ${
            match.match_code || match.id
          } is now resolved`
        );
        return updatedMatch;
      }

      return match;
    } catch (error) {
      console.error(
        `   ❌ Auto-resolve failed for match ${match.id}:`,
        error instanceof Error ? error.message : error
      );
      return match; // Return original match on error
    }
  }

  /**
   * Attempt to auto-cancel a postponed match from a past date
   * Returns the updated match if cancellation succeeded, or the original match if not
   */
  async tryAutoCancelMatch(match: DBMatch): Promise<DBMatch> {
    // Only try if match is not already cancelled and has an on-chain ID
    if (match.status === "CANCELLED" || !match.on_chain_match_id) {
      return match;
    }

    // Only cancel postponed matches
    if (match.status !== "POSTPONED") {
      return match;
    }

    // Check if match is postponed from a past date
    let shouldCancel = false;

    if (match.match_code) {
      // Extract date from match_code (format: YYYYMMDD-N)
      const matchDateStr = match.match_code.split("-")[0];
      const today = new Date();
      const todayStr = `${today.getUTCFullYear()}${String(
        today.getUTCMonth() + 1
      ).padStart(2, "0")}${String(today.getUTCDate()).padStart(2, "0")}`;

      // If match is from a past date and is postponed, cancel it
      if (matchDateStr < todayStr) {
        shouldCancel = true;
      }
    }

    if (!shouldCancel) {
      return match; // Not a postponed match from past date
    }

    console.log(
      `🚫 Auto-cancel attempt for postponed match ${
        match.match_code || match.id
      }: ${match.home_team} vs ${match.away_team} (Status: ${match.status})`
    );

    try {
      // Cancel on-chain if contract is available
      if (this.contractService.isContractAvailable()) {
        // Check on-chain status first to avoid reverting
        const onChainMatch = await this.contractService.getMatch(
          match.on_chain_match_id
        );

        // If match is already cancelled or resolved on-chain, just update DB
        if (onChainMatch) {
          if (onChainMatch.status === 3) {
            // Already CANCELLED
            console.log(
              `   ℹ️ Match ${match.on_chain_match_id} already cancelled on-chain`
            );
            db.updateMatchStatus(match.id, "CANCELLED");
            const updatedMatch = db.getMatchById(match.id);
            return updatedMatch || match;
          }

          if (onChainMatch.status === 2) {
            // Already RESOLVED
            console.log(
              `   ℹ️ Match ${match.on_chain_match_id} already resolved on-chain - cannot cancel`
            );
            return match;
          }
        }

        // Proceed with cancellation
        const result = await this.contractService.cancelMatch(
          match.on_chain_match_id,
          "Match postponed - auto-cancelled"
        );

        if (result) {
          console.log(
            `   ✅ On-chain cancellation successful for match ${match.on_chain_match_id}`
          );

          // Update database status
          db.updateMatchStatus(match.id, "CANCELLED");
          console.log(`   ✅ Database updated to CANCELLED`);

          // Return updated match
          const updatedMatch = db.getMatchById(match.id);
          if (updatedMatch) {
            console.log(
              `   🎉 Auto-cancellation complete! Match ${
                match.match_code || match.id
              } is now cancelled`
            );
            return updatedMatch;
          }
        } else {
          console.log(`   ⚠️ On-chain cancellation failed`);
        }
      }

      return match;
    } catch (error) {
      console.error(
        `   ❌ Auto-cancel failed for match ${match.id}:`,
        error instanceof Error ? error.message : error
      );
      return match; // Return original match on error
    }
  }
}
