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
        daily_id INTEGER,
        match_code TEXT UNIQUE,
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
      CREATE INDEX IF NOT EXISTS idx_matches_daily_id ON matches(daily_id);
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
        tx_hash TEXT,
        interaction_id TEXT,
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

    // Create bets table (confirmed bets)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        wallet_address TEXT NOT NULL,
        match_id INTEGER NOT NULL,
        on_chain_match_id INTEGER NOT NULL,
        prediction INTEGER NOT NULL,
        amount TEXT NOT NULL,
        tx_hash TEXT,
        placed_at INTEGER NOT NULL,
        claimed INTEGER DEFAULT 0,
        UNIQUE(user_id, match_id),
        FOREIGN KEY (match_id) REFERENCES matches(id)
      );

      CREATE INDEX IF NOT EXISTS idx_bets_user ON bets(user_id);
      CREATE INDEX IF NOT EXISTS idx_bets_match ON bets(match_id);
      CREATE INDEX IF NOT EXISTS idx_bets_wallet ON bets(wallet_address);
    `);

    // Migrate existing databases: Add daily_id column if it doesn't exist
    try {
      this.db.exec(`ALTER TABLE matches ADD COLUMN daily_id INTEGER`);
      console.log("✅ Migration: Added daily_id column to matches table");
    } catch (error) {
      // Column already exists (fresh database or already migrated)
      // This is expected and safe to ignore
    }

    // Migrate existing databases: Add tx_hash and interaction_id columns to pending_bets
    try {
      this.db.exec(`ALTER TABLE pending_bets ADD COLUMN tx_hash TEXT`);
      console.log("✅ Migration: Added tx_hash column to pending_bets table");
    } catch (error) {
      // Column already exists
    }

    try {
      this.db.exec(`ALTER TABLE pending_bets ADD COLUMN interaction_id TEXT`);
      console.log(
        "✅ Migration: Added interaction_id column to pending_bets table"
      );
    } catch (error) {
      // Column already exists
    }

    // Migrate existing databases: Add match_code column if it doesn't exist
    // This is for backward compatibility with databases created before match_code was added
    // Note: We can't add UNIQUE constraint via ALTER TABLE on existing tables with data
    // The uniqueness will be enforced by the index created below
    try {
      this.db.exec(`ALTER TABLE matches ADD COLUMN match_code TEXT`);
      console.log("✅ Migration: Added match_code column to matches table");
    } catch (error) {
      // Column already exists (expected for fresh databases or already migrated)
      // This is safe to ignore
    }

    // Create unique index for match_code (safe to run multiple times with IF NOT EXISTS)
    // This must be AFTER the ALTER TABLE migration for existing databases
    // Using UNIQUE index enforces uniqueness even though ALTER TABLE couldn't add UNIQUE constraint
    try {
      this.db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_match_code ON matches(match_code)`
      );
    } catch (error) {
      // Index might already exist or column doesn't exist yet
      // This is safe to ignore
    }

    // Migrate existing matches without match codes
    // This generates match codes for any matches that don't have them yet
    this.migrateMatchCodes();

    console.log("Database initialized successfully");
  }

  // ==================== MATCHES ====================

  /**
   * Upsert a match from the API
   * Only accepts fields that are inserted/updated in the SQL
   * Generates daily_id and match_code for new matches
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
    // Check if match already exists
    const existing = this.getMatchByApiId(match.api_match_id);

    if (existing) {
      // Update existing match (don't change daily_id or match_code)
      const updateStmt = this.db.prepare(`
        UPDATE matches
        SET status = ?,
            home_score = ?,
            away_score = ?,
            kickoff_time = ?
        WHERE api_match_id = ?
      `);
      updateStmt.run(
        match.status,
        match.home_score,
        match.away_score,
        match.kickoff_time,
        match.api_match_id
      );
      return existing.id;
    }

    // New match - generate daily_id and match_code
    const dateString = this.getDateString(match.kickoff_time);
    const dailyId = this.getNextDailyIdForDate(dateString);
    const matchCode = this.generateMatchCode(match.kickoff_time, dailyId);

    const insertStmt = this.db.prepare(`
      INSERT INTO matches (
        api_match_id, home_team, away_team, competition, competition_code,
        kickoff_time, status, home_score, away_score, daily_id, match_code
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      RETURNING id
    `);

    const result = insertStmt.get(
      match.api_match_id,
      match.home_team,
      match.away_team,
      match.competition,
      match.competition_code,
      match.kickoff_time,
      match.status,
      match.home_score,
      match.away_score,
      dailyId,
      matchCode
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
   * Get match by daily ID for today
   */
  getMatchByDailyId(dailyId: number): DBMatch | undefined {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const stmt = this.db.prepare(`
      SELECT * FROM matches
      WHERE daily_id = ?
        AND kickoff_time >= ?
        AND kickoff_time < ?
    `);

    return stmt.get(
      dailyId,
      Math.floor(today.getTime() / 1000),
      Math.floor(tomorrow.getTime() / 1000)
    ) as DBMatch | undefined;
  }

  /**
   * Assign daily IDs to all today's matches based on kickoff order
   */
  assignDailyIds(): void {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    // Get all today's matches ordered by kickoff time
    const matches = this.getTodaysMatches();

    // Assign sequential daily IDs
    const updateStmt = this.db.prepare(`
      UPDATE matches SET daily_id = ? WHERE id = ?
    `);

    for (let i = 0; i < matches.length; i++) {
      updateStmt.run(i + 1, matches[i].id);
    }
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
   * Get all matches (for admin/migration purposes)
   */
  getAllMatches(): DBMatch[] {
    const stmt = this.db.prepare(`
      SELECT * FROM matches
      ORDER BY kickoff_time DESC
    `);

    return stmt.all() as DBMatch[];
  }

  /**
   * Get matches from the last N days (for verification)
   * Used by /verify command to check recent bets
   */
  getRecentMatches(daysBack: number = 7): DBMatch[] {
    const now = new Date();
    const startDate = new Date(now);
    startDate.setUTCDate(startDate.getUTCDate() - daysBack);
    startDate.setUTCHours(0, 0, 0, 0);

    const stmt = this.db.prepare(`
      SELECT * FROM matches
      WHERE kickoff_time >= ?
      ORDER BY kickoff_time DESC
    `);

    return stmt.all(Math.floor(startDate.getTime() / 1000)) as DBMatch[];
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
   * Get all matches with on-chain IDs (for migration)
   */
  getAllOnChainMatches(): DBMatch[] {
    const stmt = this.db.prepare(`
      SELECT * FROM matches
      WHERE on_chain_match_id IS NOT NULL
      ORDER BY kickoff_time DESC
    `);
    return stmt.all() as DBMatch[];
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
  getTodaysKickoffRange(): {
    firstKickoff: number;
    lastKickoff: number;
  } | null {
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

  /**
   * Get match by match code (persistent identifier)
   * Format: YYYYMMDD-N (e.g., 20260111-2)
   */
  getMatchByMatchCode(matchCode: string): DBMatch | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM matches WHERE match_code = ?
    `);
    return stmt.get(matchCode) as DBMatch | undefined;
  }

  /**
   * Get next daily_id for a specific date
   * Ensures sequential assignment regardless of fetch order
   */
  getNextDailyIdForDate(date: string): number {
    // date format: "2026-01-12"
    const dateStart = new Date(date + "T00:00:00Z");
    const dateEnd = new Date(date + "T23:59:59Z");

    const stmt = this.db.prepare(`
      SELECT MAX(daily_id) as max_id
      FROM matches
      WHERE kickoff_time >= ? AND kickoff_time < ?
    `);

    const result = stmt.get(
      Math.floor(dateStart.getTime() / 1000),
      Math.floor(dateEnd.getTime() / 1000)
    ) as { max_id: number | null };

    return (result.max_id || 0) + 1;
  }

  /**
   * Generate match code for a match
   * Format: YYYYMMDD-N
   */
  generateMatchCode(kickoffTime: number, dailyId: number): string {
    const date = new Date(kickoffTime * 1000);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}${month}${day}-${dailyId}`;
  }

  /**
   * Get date string from unix timestamp
   * Format: YYYY-MM-DD
   */
  private getDateString(kickoffTime: number): string {
    const date = new Date(kickoffTime * 1000);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  /**
   * Migrate existing matches to add match codes
   * Called during database initialization
   */
  private migrateMatchCodes(): void {
    try {
      // Check if match_code column exists by attempting to query it
      const testStmt = this.db.prepare(`
        SELECT match_code FROM matches LIMIT 1
      `);
      testStmt.get(); // This will throw if column doesn't exist
    } catch (error) {
      // Column doesn't exist yet, skip migration
      // This can happen on fresh databases before the column is added
      return;
    }

    try {
      // Get all matches without match codes
      const stmt = this.db.prepare(`
        SELECT * FROM matches WHERE match_code IS NULL
      `);
      const matches = stmt.all() as DBMatch[];

      if (matches.length === 0) {
        return; // No matches to migrate
      }

      console.log(
        `🔄 Migrating ${matches.length} matches to add match codes...`
      );

      for (const match of matches) {
        // Use existing daily_id if available, otherwise use match id
        const dailyId = match.daily_id || match.id;
        const matchCode = this.generateMatchCode(match.kickoff_time, dailyId);

        const updateStmt = this.db.prepare(`
          UPDATE matches
          SET match_code = ?
          WHERE id = ?
        `);

        try {
          updateStmt.run(matchCode, match.id);
        } catch (error) {
          // If match_code collision (unlikely), use match id as fallback
          const fallbackCode = this.generateMatchCode(
            match.kickoff_time,
            match.id
          );
          updateStmt.run(fallbackCode, match.id);
        }
      }

      console.log(`✅ Migrated ${matches.length} matches with match codes`);
    } catch (error) {
      console.error("Error during match code migration:", error);
      // Don't throw - allow app to continue even if migration fails
    }
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
   * Update pending bet with interaction ID
   */
  updatePendingBetInteractionId(
    userAddress: string,
    interactionId: string
  ): void {
    const stmt = this.db.prepare(`
      UPDATE pending_bets SET interaction_id = ? WHERE user_address = ?
    `);
    stmt.run(interactionId, userAddress);
  }

  /**
   * Update pending bet with transaction hash
   */
  updatePendingBetTxHash(userAddress: string, txHash: string): void {
    const stmt = this.db.prepare(`
      UPDATE pending_bets SET tx_hash = ? WHERE user_address = ?
    `);
    stmt.run(txHash, userAddress);
  }

  /**
   * Get pending bet by interaction ID
   */
  getPendingBetByInteractionId(interactionId: string): PendingBet | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM pending_bets WHERE interaction_id = ?
    `);
    return stmt.get(interactionId) as PendingBet | undefined;
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

  // ==================== BETS ====================

  /**
   * Check if user has already bet on a match
   */
  getUserBetOnMatch(
    userId: string,
    matchId: number
  ): { wallet_address: string } | undefined {
    const stmt = this.db.prepare(`
      SELECT wallet_address FROM bets WHERE user_id = ? AND match_id = ?
    `);
    return stmt.get(userId, matchId) as { wallet_address: string } | undefined;
  }

  /**
   * Create a bet record
   */
  createBet(
    userId: string,
    walletAddress: string,
    matchId: number,
    onChainMatchId: number,
    prediction: Outcome,
    amount: string,
    txHash: string
  ): number {
    const stmt = this.db.prepare(`
      INSERT INTO bets (
        user_id, wallet_address, match_id, on_chain_match_id,
        prediction, amount, tx_hash, placed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
      RETURNING id
    `);
    const result = stmt.get(
      userId,
      walletAddress,
      matchId,
      onChainMatchId,
      prediction,
      amount,
      txHash
    ) as { id: number };
    return result.id;
  }

  /**
   * Get all bets for a user
   */
  getUserBets(userId: string): Array<{
    id: number;
    user_id: string;
    wallet_address: string;
    match_id: number;
    on_chain_match_id: number;
    prediction: number;
    amount: string;
    tx_hash: string | null;
    placed_at: number;
    claimed: number;
  }> {
    const stmt = this.db.prepare(`
      SELECT * FROM bets WHERE user_id = ? ORDER BY placed_at DESC
    `);
    return stmt.all(userId) as Array<{
      id: number;
      user_id: string;
      wallet_address: string;
      match_id: number;
      on_chain_match_id: number;
      prediction: number;
      amount: string;
      tx_hash: string | null;
      placed_at: number;
      claimed: number;
    }>;
  }

  /**
   * Check if user has a bet on a specific match
   * Used by /verify command to avoid duplicate DB entries
   */
  hasBet(userId: string, matchId: number): boolean {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM bets
      WHERE user_id = ? AND match_id = ?
    `);
    const result = stmt.get(userId, matchId) as { count: number };
    return result.count > 0;
  }

  /**
   * Update bet claimed status
   */
  updateBetClaimed(userId: string, matchId: number): void {
    const stmt = this.db.prepare(`
      UPDATE bets SET claimed = 1 WHERE user_id = ? AND match_id = ?
    `);
    stmt.run(userId, matchId);
  }

  /**
   * Get all bets for a match
   */
  getBetsForMatch(matchId: number): Array<{
    id: number;
    user_id: string;
    wallet_address: string;
    match_id: number;
    on_chain_match_id: number;
    prediction: number;
    amount: string;
    tx_hash: string | null;
    placed_at: number;
    claimed: number;
  }> {
    const stmt = this.db.prepare(`
      SELECT * FROM bets WHERE match_id = ? ORDER BY placed_at ASC
    `);
    return stmt.all(matchId) as Array<{
      id: number;
      user_id: string;
      wallet_address: string;
      match_id: number;
      on_chain_match_id: number;
      prediction: number;
      amount: string;
      tx_hash: string | null;
      placed_at: number;
      claimed: number;
    }>;
  }

  /**
   * Get a user's full bet details for a specific match
   */
  getUserBetForMatch(
    userId: string,
    matchId: number
  ):
    | {
        id: number;
        user_id: string;
        wallet_address: string;
        match_id: number;
        on_chain_match_id: number;
        prediction: number;
        amount: string;
        tx_hash: string | null;
        placed_at: number;
        claimed: number;
      }
    | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM bets WHERE user_id = ? AND match_id = ?
    `);
    return stmt.get(userId, matchId) as
      | {
          id: number;
          user_id: string;
          wallet_address: string;
          match_id: number;
          on_chain_match_id: number;
          prediction: number;
          amount: string;
          tx_hash: string | null;
          placed_at: number;
          claimed: number;
        }
      | undefined;
  }

  /**
   * Get all claimable bets for a user (won bets that haven't been claimed)
   * Joins with matches table to check resolution status
   */
  getClaimableBets(userId: string): Array<{
    bet_id: number;
    user_id: string;
    wallet_address: string;
    match_id: number;
    on_chain_match_id: number;
    prediction: number;
    amount: string;
    tx_hash: string | null;
    placed_at: number;
    claimed: number;
    home_team: string;
    away_team: string;
    competition: string;
    competition_code: string;
    kickoff_time: number;
    home_score: number | null;
    away_score: number | null;
    result: number;
    daily_id: number | null;
    match_code: string | null;
  }> {
    const stmt = this.db.prepare(`
      SELECT
        b.id as bet_id,
        b.user_id,
        b.wallet_address,
        b.match_id,
        b.on_chain_match_id,
        b.prediction,
        b.amount,
        b.tx_hash,
        b.placed_at,
        b.claimed,
        m.home_team,
        m.away_team,
        m.competition,
        m.competition_code,
        m.kickoff_time,
        m.home_score,
        m.away_score,
        m.result,
        m.daily_id,
        m.match_code
      FROM bets b
      INNER JOIN matches m ON b.match_id = m.id
      WHERE b.user_id = ?
        AND b.claimed = 0
        AND (
          (m.result IS NOT NULL AND b.prediction = m.result)  -- Winning bets
          OR m.status = 'CANCELLED'  -- Cancelled matches (refunds)
        )
      ORDER BY m.kickoff_time DESC
    `);
    return stmt.all(userId) as Array<{
      bet_id: number;
      user_id: string;
      wallet_address: string;
      match_id: number;
      on_chain_match_id: number;
      prediction: number;
      amount: string;
      tx_hash: string | null;
      placed_at: number;
      claimed: number;
      home_team: string;
      away_team: string;
      competition: string;
      competition_code: string;
      kickoff_time: number;
      home_score: number | null;
      away_score: number | null;
      result: number;
      daily_id: number | null;
      match_code: string | null;
    }>;
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
