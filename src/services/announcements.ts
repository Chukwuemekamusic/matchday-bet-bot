/**
 * Announcement Service
 *
 * Handles all automated channel announcements:
 * - Daily match listings (morning & noon)
 * - Match results
 * - Betting closed notices
 * - Match cancellation notices
 */

import type { ContractService } from "./contract";
import type { DBMatch } from "../types";
import { Outcome } from "../types";
import { FootballAPIService } from "./footballApi";
import { formatEth, formatMatchDisplay } from "../utils/format";
import { getCompetitionEmoji } from "../utils/competition";

/**
 * Information about a cancelled match
 */
export interface CancelledMatchInfo {
  homeTeam: string;
  awayTeam: string;
  competition: string;
  matchCode: string;
}

/**
 * Service for posting automated announcements to the default channel
 */
export class AnnouncementService {
  constructor(
    private bot: any,
    private contractService: ContractService,
    private db: any,
    private channelId: string | null
  ) {}

  /**
   * Check if service is available (bot and channel configured)
   */
  private isAvailable(): boolean {
    return this.bot !== null && this.channelId !== null;
  }

  /**
   * Post daily match listings to the default channel
   * @param timeSlot - 'morning' or 'noon'
   */
  async postDailyMatchListings(timeSlot: string): Promise<void> {
    if (!this.isAvailable()) {
      console.log(
        "⏭️ Skipping daily match listing (no bot or channel configured)"
      );
      return;
    }

    const today = new Date();
    const matchDate = today.toISOString().split("T")[0]; // YYYY-MM-DD

    // Check if already posted for this time slot
    if (this.db.hasBeenPosted(matchDate, timeSlot)) {
      console.log(
        `✅ Already posted ${timeSlot} match listings for ${matchDate}`
      );
      return;
    }

    // Get today's matches
    const matches = this.db.getTodaysMatches();

    // Skip if no matches
    if (matches.length === 0) {
      console.log(
        `📅 No matches for ${matchDate}, skipping ${timeSlot} posting`
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

    // Format the date
    const dateFormatter = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const formattedDate = dateFormatter.format(today);

    // Build message
    let message = `⚽ **Matches for ${formattedDate}**\n\n`;

    for (const [competition, compMatches] of grouped) {
      const emoji = getCompetitionEmoji(compMatches[0].competition_code);
      message += `${emoji} **${competition}**\n\n`;

      for (const match of compMatches) {
        message += formatMatchDisplay(match);
      }
    }

    message += "Use `/bet <#> <home|draw|away> <amount>` to place a bet!";

    // Post to channel
    try {
      const result = await this.bot.sendMessage(this.channelId, message);
      const messageId = result?.id || undefined;

      // Record that we posted
      this.db.recordPosted(matchDate, timeSlot, messageId);

      console.log(
        `✅ Posted ${timeSlot} match listings for ${matchDate} (${matches.length} matches)`
      );
    } catch (error) {
      console.error(`❌ Failed to post ${timeSlot} match listings:`, error);
    }
  }

  /**
   * Post match result to channel (if configured)
   * @param dbMatch - Match from database
   * @param homeScore - Home team score
   * @param awayScore - Away team score
   */
  async postMatchResult(
    dbMatch: any,
    homeScore: number,
    awayScore: number
  ): Promise<void> {
    if (!this.isAvailable()) {
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
      this.contractService?.isContractAvailable()
    ) {
      const pools = await this.contractService.getPools(
        dbMatch.on_chain_match_id
      );
      const totalPool = pools ? formatEth(pools.total) : "?";
      poolInfo = `\n💰 Total Pool: ${totalPool} ETH\n\nWinners can now claim using \`/claim\``;
    }

    await this.bot.sendMessage(
      this.channelId,
      `🏁 **Match Result**

**${dbMatch.home_team} ${homeScore} - ${awayScore} ${dbMatch.away_team}**

✅ Result: ${winner}${outcome !== Outcome.DRAW ? " wins!" : ""}${poolInfo}`
    );
  }

  /**
   * Post betting closed announcement
   * @param match - Match that just closed for betting
   */
  async postBettingClosed(match: DBMatch): Promise<void> {
    if (!this.isAvailable()) {
      return;
    }

    try {
      await this.bot.sendMessage(
        this.channelId,
        `🔒 **Betting Closed**

${match.home_team} vs ${match.away_team}

Kickoff! Good luck to all bettors! ⚽`
      );
    } catch (error) {
      console.error("❌ Failed to post betting closed announcement:", error);
    }
  }

  /**
   * Post match cancellation announcement
   * @param matches - Array of cancelled matches
   */
  async postMatchesCancelled(matches: CancelledMatchInfo[]): Promise<void> {
    if (!this.isAvailable() || matches.length === 0) {
      return;
    }

    try {
      const matchList = matches
        .map((m) => `• **${m.homeTeam} vs ${m.awayTeam}** (${m.competition})`)
        .join("\n");

      await this.bot.sendMessage(
        this.channelId,
        `🚫 **Match${matches.length > 1 ? "es" : ""} Cancelled**

${matchList}

${matches.length > 1 ? "These matches were" : "This match was"} postponed and ${
          matches.length > 1 ? "have" : "has"
        } been automatically cancelled.

💰 **Refunds Available:** All bettors can claim refunds using \`/claim\``
      );
    } catch (error) {
      console.error("❌ Failed to send cancellation notification:", error);
    }
  }
}
