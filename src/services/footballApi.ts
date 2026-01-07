import config from "../config";
import {
  FootballAPIMatch,
  FootballAPIResponse,
  Outcome,
  COMPETITION_NAMES,
} from "../types";

class FootballAPIService {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = config.footballApi.baseUrl;
    this.apiKey = config.footballApi.apiKey;
  }

  /**
   * Make authenticated request to Football-Data.org API
   */
  private async request<T>(endpoint: string): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      headers: {
        "X-Auth-Token": this.apiKey,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Football API error: ${response.status} - ${error}`);
      throw new Error(`Football API error: ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Fetch today's matches for supported competitions
   */
  async getTodaysMatches(): Promise<FootballAPIMatch[]> {
    const today = new Date().toISOString().split("T")[0];

    try {
      // Fetch matches from each competition separately
      const allMatches: FootballAPIMatch[] = [];

      for (const competitionId of config.footballApi.supportedCompetitions) {
        try {
          const response = await this.request<FootballAPIResponse>(
            `/competitions/${competitionId}/matches?dateFrom=${today}&dateTo=${today}`
          );
          allMatches.push(...response.matches);
        } catch (error) {
          // Log error for individual competition but continue with others
          console.warn(`Failed to fetch matches for competition ${competitionId}:`, error);
        }
      }

      console.log(`Fetched ${allMatches.length} matches for ${today}`);
      return allMatches;
    } catch (error) {
      console.error("Failed to fetch today's matches", error);
      throw error;
    }
  }

  /**
   * Fetch matches for a specific date
   */
  async getMatchesByDate(date: string): Promise<FootballAPIMatch[]> {
    try {
      // Fetch matches from each competition separately
      const allMatches: FootballAPIMatch[] = [];

      for (const competitionId of config.footballApi.supportedCompetitions) {
        try {
          const response = await this.request<FootballAPIResponse>(
            `/competitions/${competitionId}/matches?dateFrom=${date}&dateTo=${date}`
          );
          allMatches.push(...response.matches);
        } catch (error) {
          // Log error for individual competition but continue with others
          console.warn(`Failed to fetch matches for competition ${competitionId}:`, error);
        }
      }

      console.log(`Fetched ${allMatches.length} matches for ${date}`);
      return allMatches;
    } catch (error) {
      console.error(`Failed to fetch matches for ${date}`, error);
      throw error;
    }
  }

  /**
   * Fetch a single match by ID
   */
  async getMatch(matchId: number): Promise<FootballAPIMatch> {
    try {
      const response = await this.request<FootballAPIMatch>(
        `/matches/${matchId}`
      );
      return response;
    } catch (error) {
      console.error(`Failed to fetch match ${matchId}`, error);
      throw error;
    }
  }

  /**
   * Get matches for a specific competition today
   */
  async getTodaysMatchesByCompetition(
    competitionId: number
  ): Promise<FootballAPIMatch[]> {
    const today = new Date().toISOString().split("T")[0];

    try {
      const response = await this.request<FootballAPIResponse>(
        `/competitions/${competitionId}/matches?dateFrom=${today}&dateTo=${today}`
      );

      return response.matches;
    } catch (error) {
      console.error(
        `Failed to fetch matches for competition ${competitionId}`,
        error
      );
      throw error;
    }
  }

  /**
   * Determine result outcome from scores
   */
  static determineOutcome(
    homeScore: number | null,
    awayScore: number | null
  ): Outcome | null {
    if (homeScore === null || awayScore === null) {
      return null;
    }

    if (homeScore > awayScore) return Outcome.HOME;
    if (homeScore < awayScore) return Outcome.AWAY;
    return Outcome.DRAW;
  }

  /**
   * Check if match status indicates it's finished
   */
  static isFinished(status: string): boolean {
    return status === "FINISHED";
  }

  /**
   * Check if match is live
   */
  static isLive(status: string): boolean {
    return ["IN_PLAY", "PAUSED", "HALFTIME"].includes(status);
  }

  /**
   * Check if match is scheduled
   */
  static isScheduled(status: string): boolean {
    return ["SCHEDULED", "TIMED"].includes(status);
  }

  /**
   * Check if match is postponed or cancelled
   */
  static isPostponed(status: string): boolean {
    return ["POSTPONED", "CANCELLED", "SUSPENDED"].includes(status);
  }

  /**
   * Get competition name from ID
   */
  static getCompetitionName(competitionId: number): string {
    return COMPETITION_NAMES[competitionId] || "Unknown Competition";
  }

  /**
   * Convert API match to DB format
   */
  static toDBMatch(match: FootballAPIMatch): {
    api_match_id: number;
    home_team: string;
    away_team: string;
    competition: string;
    competition_code: string;
    kickoff_time: number;
    status: string;
    home_score: number | null;
    away_score: number | null;
  } {
    return {
      api_match_id: match.id,
      home_team: match.homeTeam.shortName || match.homeTeam.name,
      away_team: match.awayTeam.shortName || match.awayTeam.name,
      competition: match.competition.name,
      competition_code: match.competition.code,
      kickoff_time: Math.floor(new Date(match.utcDate).getTime() / 1000),
      status: match.status,
      home_score: match.score.fullTime.home,
      away_score: match.score.fullTime.away,
    };
  }
}

// Export class and singleton instance
export { FootballAPIService };
export const footballApi = new FootballAPIService();
export default footballApi;
