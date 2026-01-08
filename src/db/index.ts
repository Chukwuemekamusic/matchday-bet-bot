import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import config from "../config";
import { DBMatch, PendingBet, UserStats, Outcome } from "../types";

class DatabaseService {
  private db: Database;

  constructor() {
    // Ensure database directory exists
    const dbDir = dirname(config.database.path);
    try {
      mkdirSync(dbDir, { recursive: true });
    } catch (error) {
      // Directory might already exist, ignore error
    }

    this.db = new Database(config.database.path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.init();
  }

  private init(): void {
    // Create matches table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_match_id INTEGER UNIQUE NOT NULL,
        on_chain_match_id INTEGER,
        home_team TEXT NOT NULL,
        away_team TEXT NOT NULL,
        competition TEXT NOT NULL,
        competition_code TEXT NOT NULL,
        kickoff_time INTEGER NOT NULL,
        status TEXT DEFAULT 'SCHEDULED',
        home_score INTEGER,
        away_score INTEGER,
        result INTEGER,
        total_pool TEXT DEFAULT '0',
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        resolved_at INTEGER,
        posted_to_towns INTEGER DEFAULT 0
      );
      
      CREATE INDEX IF NOT EXISTS idx_matches_kickoff ON matches(kickoff_time);
      CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
      CREATE INDEX IF NOT EXISTS idx_matches_api_id ON matches(api_match_id);
    `);

    // Create pending bets table (for confirmation flow)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pending_bets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_address TEXT NOT NULL,
        match_id INTEGER NOT NULL,
        prediction INTEGER NOT NULL,
        amount TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        expires_at INTEGER NOT NULL,
        FOREIGN KEY (match_id) REFERENCES matches(id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_pending_user ON pending_bets(user_address);
    `);

    // Create user stats table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_stats (
        user_address TEXT PRIMARY KEY,
        total_bets INTEGER DEFAULT 0,
        total_wins INTEGER DEFAULT 0,
        total_wagered TEXT DEFAULT '0',
        total_won TEXT DEFAULT '0',
        profit TEXT DEFAULT '0',
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
    `);

    // Create posted messages table (to track what we've posted)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS posted_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_date TEXT NOT NULL,
        competition_code TEXT NOT NULL,
        towns_message_id TEXT,
        posted_at INTEGER DEFAULT (strftime('%s', 'now')),
        UNIQUE(match_date, competition_code)
      );
    `);

    console.log("Database initialized successfully");
  }

  // ==================== MATCHES ====================

  /**
   * Upsert a match from the API
   * Only accepts fields that are inserted/updated in the SQL
   */
  upsertMatch(match: {
    api_match_id: number;
    home_team: string;
    away_team: string;
    competition: string;
    competition_code: string;
    kickoff_time: number;
    status: string;
    home_score: number | null;
    away_score: number | null;
  }): number {
    const stmt = this.db.prepare(`
      INSERT INTO matches (
        api_match_id, home_team, away_team, competition, competition_code,
        kickoff_time, status, home_score, away_score
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(api_match_id) DO UPDATE SET
        status = excluded.status,
        home_score = excluded.home_score,
        away_score = excluded.away_score,
        kickoff_time = excluded.kickoff_time
      RETURNING id
    `);

    const result = stmt.get(
      match.api_match_id,
      match.home_team,
      match.away_team,
      match.competition,
      match.competition_code,
      match.kickoff_time,
      match.status,
      match.home_score,
      match.away_score
    ) as { id: number };
    return result.id;
  }

  /**
   * Get match by internal ID
   */
  getMatchById(id: number): DBMatch | undefined {
    const stmt = this.db.prepare("SELECT * FROM matches WHERE id = ?");
    return stmt.get(id) as DBMatch | undefined;
  }

  /**
   * Get match by API match ID
   */
  getMatchByApiId(apiMatchId: number): DBMatch | undefined {
    const stmt = this.db.prepare(
      "SELECT * FROM matches WHERE api_match_id = ?"
    );
    return stmt.get(apiMatchId) as DBMatch | undefined;
  }

  /**
   * Get match by on-chain match ID
   */
  getMatchByOnChainId(onChainId: number): DBMatch | undefined {
    const stmt = this.db.prepare(
      "SELECT * FROM matches WHERE on_chain_match_id = ?"
    );
    return stmt.get(onChainId) as DBMatch | undefined;
  }

  /**
   * Get today's matches
   */
  getTodaysMatches(): DBMatch[] {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const stmt = this.db.prepare(`
      SELECT * FROM matches 
      WHERE kickoff_time >= ? AND kickoff_time < ?
      ORDER BY kickoff_time ASC
    `);

    return stmt.all(
      Math.floor(today.getTime() / 1000),
      Math.floor(tomorrow.getTime() / 1000)
    ) as DBMatch[];
  }

  /**
   * Get today's matches by competition
   */
  getTodaysMatchesByCompetition(competitionCode: string): DBMatch[] {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const stmt = this.db.prepare(`
      SELECT * FROM matches 
      WHERE kickoff_time >= ? AND kickoff_time < ?
        AND competition_code = ?
      ORDER BY kickoff_time ASC
    `);

    return stmt.all(
      Math.floor(today.getTime() / 1000),
      Math.floor(tomorrow.getTime() / 1000),
      competitionCode
    ) as DBMatch[];
  }

  /**
   * Get matches that need to be closed (kickoff passed)
   */
  getMatchesToClose(): DBMatch[] {
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(`
      SELECT * FROM matches 
      WHERE on_chain_match_id IS NOT NULL
        AND status = 'SCHEDULED'
        AND kickoff_time <= ?
    `);
    return stmt.all(now) as DBMatch[];
  }

  /**
   * Get matches that need results checked
   */
  getMatchesAwaitingResults(): DBMatch[] {
    const stmt = this.db.prepare(`
      SELECT * FROM matches
      WHERE on_chain_match_id IS NOT NULL
        AND status NOT IN ('FINISHED', 'CANCELLED', 'POSTPONED')
        AND result IS NULL
    `);
    return stmt.all() as DBMatch[];
  }

  /**
   * Get kickoff time range for today's matches
   * Returns { firstKickoff, lastKickoff } in Unix timestamp (seconds)
   * Returns null if no matches
   */
  getTodaysKickoffRange(): { firstKickoff: number; lastKickoff: number } | null {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const stmt = this.db.prepare(`
      SELECT MIN(kickoff_time) as first, MAX(kickoff_time) as last
      FROM matches
      WHERE kickoff_time >= ? AND kickoff_time < ?
    `);

    const result = stmt.get(
      Math.floor(today.getTime() / 1000),
      Math.floor(tomorrow.getTime() / 1000)
    ) as { first: number | null; last: number | null };

    if (result.first === null || result.last === null) {
      return null;
    }

    return { firstKickoff: result.first, lastKickoff: result.last };
  }

  /**
   * Update match with on-chain ID
   */
  setOnChainMatchId(matchId: number, onChainId: number): void {
    const stmt = this.db.prepare(`
      UPDATE matches SET on_chain_match_id = ? WHERE id = ?
    `);
    stmt.run(onChainId, matchId);
  }

  /**
   * Update match status
   */
  updateMatchStatus(matchId: number, status: string): void {
    const stmt = this.db.prepare(`
      UPDATE matches SET status = ? WHERE id = ?
    `);
    stmt.run(status, matchId);
  }

  /**
   * Update match result
   */
  updateMatchResult(
    matchId: number,
    homeScore: number,
    awayScore: number,
    result: Outcome
  ): void {
    const stmt = this.db.prepare(`
      UPDATE matches SET 
        home_score = ?,
        away_score = ?,
        result = ?,
        status = 'FINISHED',
        resolved_at = strftime('%s', 'now')
      WHERE id = ?
    `);
    stmt.run(homeScore, awayScore, result, matchId);
  }

  /**
   * Update match pool
   */
  updateMatchPool(matchId: number, totalPool: string): void {
    const stmt = this.db.prepare(`
      UPDATE matches SET total_pool = ? WHERE id = ?
    `);
    stmt.run(totalPool, matchId);
  }

  /**
   * Mark match as posted to Towns
   */
  markMatchAsPosted(matchId: number): void {
    const stmt = this.db.prepare(`
      UPDATE matches SET posted_to_towns = 1 WHERE id = ?
    `);
    stmt.run(matchId);
  }

  // ==================== PENDING BETS ====================

  /**
   * Create a pending bet
   */
  createPendingBet(
    userAddress: string,
    matchId: number,
    prediction: Outcome,
    amount: string
  ): number {
    // Clear any existing pending bet for this user
    this.clearPendingBet(userAddress);

    const expiresAt = Math.floor(Date.now() / 1000) + 300; // 5 minutes
    const stmt = this.db.prepare(`
      INSERT INTO pending_bets (user_address, match_id, prediction, amount, expires_at)
      VALUES (?, ?, ?, ?, ?)
      RETURNING id
    `);
    const result = stmt.get(
      userAddress,
      matchId,
      prediction,
      amount,
      expiresAt
    ) as { id: number };
    return result.id;
  }

  /**
   * Get pending bet for user
   */
  getPendingBet(userAddress: string): PendingBet | undefined {
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(`
      SELECT * FROM pending_bets 
      WHERE user_address = ? AND expires_at > ?
    `);
    return stmt.get(userAddress, now) as PendingBet | undefined;
  }

  /**
   * Clear pending bet for user
   */
  clearPendingBet(userAddress: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM pending_bets WHERE user_address = ?
    `);
    stmt.run(userAddress);
  }

  /**
   * Clean up expired pending bets
   */
  cleanupExpiredPendingBets(): number {
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(`
      DELETE FROM pending_bets WHERE expires_at <= ?
    `);
    const result = stmt.run(now);
    return result.changes;
  }

  // ==================== USER STATS ====================

  /**
   * Update user stats after a bet
   */
  recordBet(userAddress: string, amount: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO user_stats (user_address, total_bets, total_wagered, updated_at)
      VALUES (?, 1, ?, strftime('%s', 'now'))
      ON CONFLICT(user_address) DO UPDATE SET
        total_bets = total_bets + 1,
        total_wagered = CAST(
          (CAST(total_wagered AS REAL) + CAST(? AS REAL)) AS TEXT
        ),
        updated_at = strftime('%s', 'now')
    `);
    stmt.run(userAddress, amount, amount);
  }

  /**
   * Update user stats after a win
   */
  recordWin(userAddress: string, wonAmount: string, profit: string): void {
    const stmt = this.db.prepare(`
      UPDATE user_stats SET
        total_wins = total_wins + 1,
        total_won = CAST(
          (CAST(total_won AS REAL) + CAST(? AS REAL)) AS TEXT
        ),
        profit = CAST(
          (CAST(profit AS REAL) + CAST(? AS REAL)) AS TEXT
        ),
        updated_at = strftime('%s', 'now')
      WHERE user_address = ?
    `);
    stmt.run(wonAmount, profit, userAddress);
  }

  /**
   * Get user stats
   */
  getUserStats(userAddress: string): UserStats | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM user_stats WHERE user_address = ?
    `);
    return stmt.get(userAddress) as UserStats | undefined;
  }

  /**
   * Get leaderboard (top users by profit)
   */
  getLeaderboard(limit: number = 10): UserStats[] {
    const stmt = this.db.prepare(`
      SELECT * FROM user_stats
      ORDER BY CAST(profit AS REAL) DESC
      LIMIT ?
    `);
    return stmt.all(limit) as UserStats[];
  }

  // ==================== POSTED MESSAGES ====================

  /**
   * Check if matches for a date/competition have been posted
   */
  hasBeenPosted(matchDate: string, competitionCode: string): boolean {
    const stmt = this.db.prepare(`
      SELECT 1 FROM posted_messages 
      WHERE match_date = ? AND competition_code = ?
    `);
    return stmt.get(matchDate, competitionCode) !== undefined;
  }

  /**
   * Record that matches have been posted
   */
  recordPosted(
    matchDate: string,
    competitionCode: string,
    messageId?: string
  ): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO posted_messages (match_date, competition_code, towns_message_id)
      VALUES (?, ?, ?)
    `);
    stmt.run(matchDate, competitionCode, messageId || null);
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
    console.log("Database connection closed");
  }
}

// Export singleton instance
export const db = new DatabaseService();
export default db;
