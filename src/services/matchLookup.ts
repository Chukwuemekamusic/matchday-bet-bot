/**
 * Match Lookup Service
 * Centralized service for finding matches by various identifiers
 * with consistent error handling and helpful user messages
 */

import { db } from "../db";
import type { DBMatch } from "../types";

export interface MatchLookupResult {
  success: boolean;
  match?: DBMatch;
  errorMessage?: string;
}

export interface MatchLookupOptions {
  /**
   * Command name to use in error messages (e.g., "/claim", "/odds")
   */
  commandName?: string;
  /**
   * Suggestion for where to find matches (e.g., "/claimable", "/matches")
   */
  suggestionCommand?: string;
}

export class MatchLookupService {
  /**
   * Find a match by user input (match code or daily ID)
   * @param input - Either a match code (e.g., "20260108-2") or daily ID (e.g., "1")
   * @param options - Options for customizing error messages
   * @returns Result object with match or error message
   */
  findMatch(
    input: string,
    options: MatchLookupOptions = {},
  ): MatchLookupResult {
    const { commandName = "", suggestionCommand = "/matches" } = options;

    // Check if input is a match code (contains dash) or just a number
    if (input.includes("-")) {
      return this.findByMatchCode(input, suggestionCommand);
    } else {
      return this.findByDailyId(input, commandName, suggestionCommand);
    }
  }

  /**
   * Find match by match code (e.g., "20260108-2")
   */
  private findByMatchCode(
    matchCode: string,
    suggestionCommand: string,
  ): MatchLookupResult {
    const match = db.getMatchByMatchCode(matchCode);

    if (!match) {
      return {
        success: false,
        errorMessage: `❌ Match \`${matchCode}\` not found.\n\nUse \`${suggestionCommand}\` to see available matches.`,
      };
    }

    return {
      success: true,
      match,
    };
  }

  /**
   * Find match by daily ID (e.g., "1" for today's first match)
   */
  private findByDailyId(
    input: string,
    commandName: string,
    suggestionCommand: string,
  ): MatchLookupResult {
    const matchNum = parseInt(input);

    // Validate number
    if (isNaN(matchNum) || matchNum < 1) {
      return {
        success: false,
        errorMessage: `❌ Invalid match number. Use \`${suggestionCommand}\` to see available matches.`,
      };
    }

    // Try to find today's match with this daily_id
    const match = db.getMatchByDailyId(matchNum);

    if (!match) {
      // Generate today's match code hint
      const today = new Date();
      const year = today.getUTCFullYear();
      const month = String(today.getUTCMonth() + 1).padStart(2, "0");
      const day = String(today.getUTCDate()).padStart(2, "0");
      const todayCode = `${year}${month}${day}-${matchNum}`;

      const commandHint = commandName
        ? `Try: \`${commandName} ${todayCode}\` for match #${matchNum} from another day\n\n`
        : "";

      return {
        success: false,
        errorMessage: `❌ Match #${matchNum} not found for today.

**Looking for an older match?**
${commandHint}Use \`${suggestionCommand}\` to see available matches.`,
      };
    }

    return {
      success: true,
      match,
    };
  }

  /**
   * Find match by daily ID only (simpler version without match code hint)
   * Used by commands like /bet that only accept daily IDs
   */
  findByDailyIdOnly(dailyId: number): MatchLookupResult {
    const match = db.getMatchByDailyId(dailyId);

    if (!match) {
      return {
        success: false,
        errorMessage: `❌ Match #${dailyId} not found for today. Use \`/matches\` to see available matches.`,
      };
    }

    return {
      success: true,
      match,
    };
  }
}

// Export singleton instance
export const matchLookup = new MatchLookupService();
