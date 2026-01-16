// Outcome enum matching the smart contract
export enum Outcome {
  NONE = 0,
  HOME = 1,
  DRAW = 2,
  AWAY = 3,
}

// Match status enum matching the smart contract
export enum MatchStatus {
  OPEN = 0,
  CLOSED = 1,
  RESOLVED = 2,
  CANCELLED = 3,
}

// Database match record
export interface DBMatch {
  id: number;
  api_match_id: number;
  on_chain_match_id: number | null;
  daily_id: number | null;
  match_code: string | null; // Format: YYYYMMDD-N (e.g., 20260111-2)
  home_team: string;
  away_team: string;
  competition: string;
  competition_code: string;
  kickoff_time: number; // Unix timestamp
  status: string; // 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'POSTPONED' | 'CANCELLED'
  home_score: number | null;
  away_score: number | null;
  result: Outcome | null;
  total_pool: string; // Store as string for precision
  created_at: number;
  resolved_at: number | null;
  posted_to_towns: boolean;
  postponed_at: number | null; // Unix timestamp when match was first marked as postponed
  on_chain_resolved: boolean; // Whether match has been successfully resolved on-chain
}

// Pending bet (for confirmation flow)
export interface PendingBet {
  user_address: string;
  match_id: number;
  prediction: Outcome;
  amount: string;
  created_at: number;
  expires_at: number;
  tx_hash?: string;
  interaction_id?: string;
  thread_id?: string;
}

// User stats for leaderboard
export interface UserStats {
  user_address: string;
  total_bets: number;
  total_wins: number;
  total_wagered: string;
  total_won: string;
  profit: string;
  updated_at: number;
}

// Football API types
// Note: API may return null/undefined for some fields in edge cases
export interface FootballAPIMatch {
  id: number | null;
  utcDate: string;
  status: string;
  homeTeam: {
    id: number;
    name: string;
    shortName: string;
    tla: string;
  } | null;
  awayTeam: {
    id: number;
    name: string;
    shortName: string;
    tla: string;
  } | null;
  competition: {
    id: number;
    name: string;
    code: string;
  } | null;
  score: {
    fullTime: {
      home: number | null;
      away: number | null;
    };
  };
}

export interface FootballAPIResponse {
  matches: FootballAPIMatch[];
}

// Contract types
export interface ContractMatch {
  matchId: bigint;
  kickoffTime: bigint;
  totalPool: bigint;
  homePool: bigint;
  drawPool: bigint;
  awayPool: bigint;
  homeBetCount: bigint;
  drawBetCount: bigint;
  awayBetCount: bigint;
  platformFeeAmount: bigint;
  result: number;
  status: number;
  homeTeam: string;
  awayTeam: string;
  competition: string;
}

export interface ContractBet {
  bettor: string;
  amount: bigint;
  prediction: number;
  claimed: boolean;
}

// Command context
export interface CommandContext {
  userId: string;
  userAddress: string;
  channelId: string;
  messageId: string;
  content: string;
  args: string[];
}

// Bot message types
export interface BotMessage {
  content: string;
  replyTo?: string;
}

// Competition mapping
export const COMPETITION_NAMES: Record<number, string> = {
  2021: "Premier League",
  2014: "La Liga",
  2002: "Bundesliga",
  2019: "Serie A",
  2015: "Ligue 1",
  2001: "Champions League",
};

export const COMPETITION_EMOJIS: Record<number, string> = {
  2021: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  2014: "🇪🇸",
  2002: "🇩🇪",
  2019: "🇮🇹",
  2015: "🇫🇷",
  2001: "🏆",
};

// Outcome display names
export const OUTCOME_NAMES: Record<Outcome, string> = {
  [Outcome.NONE]: "None",
  [Outcome.HOME]: "Home",
  [Outcome.DRAW]: "Draw",
  [Outcome.AWAY]: "Away",
};

// ============ Subgraph GraphQL Types ============

export interface SubgraphBet {
  id: string; // Format: matchId-userAddress
  amount: string; // BigInt as string
  prediction: "HOME" | "DRAW" | "AWAY" | "NONE";
  claimed: boolean;
  payout: string | null; // BigInt as string
  profit: string | null; // BigInt as string
  placedAt: string; // BigInt timestamp as string
  claimedAt: string | null; // BigInt timestamp as string
  match: {
    id: string;
    matchId: string;
    homeTeam: string;
    awayTeam: string;
    competition: string;
    kickoffTime: string;
    status: "OPEN" | "CLOSED" | "RESOLVED" | "CANCELLED";
    result: "HOME" | "DRAW" | "AWAY" | "NONE";
    totalPool: string;
    homePool: string;
    drawPool: string;
    awayPool: string;
    platformFeeAmount: string;
    totalClaimed: string;
    cancellationReason: string | null;
  };
}

export interface SubgraphUser {
  id: string; // User address
  address: string;
  totalBets: string; // BigInt as string
  totalWagered: string;
  totalWon: string;
  totalClaimed: string;
  totalProfit: string; // Can be negative
  winCount: string;
  lossCount: string;
  refundCount: string;
  firstBetAt: string;
  lastBetAt: string;
  lastActivityAt: string;
}

export interface SubgraphGlobalStats {
  id: string; // Always "1"
  totalMatches: string;
  activeMatches: string;
  resolvedMatches: string;
  cancelledMatches: string;
  totalBets: string;
  totalVolume: string;
  totalFeesCollected: string;
  totalPayouts: string;
  uniqueBettors: string;
  lastUpdatedAt: string;
}

// Query response types
export interface GetUserClaimableResponse {
  bets: SubgraphBet[];
}

export interface GetUserStatsResponse {
  user: SubgraphUser | null;
}

export interface GetLeaderboardResponse {
  users: SubgraphUser[];
}

export interface GetGlobalStatsResponse {
  globalStats: SubgraphGlobalStats | null;
}

// Processed claimable data (with database match info)
export interface ClaimableMatch {
  betId: string;
  matchId: number; // On-chain match ID
  onChainMatchId: string; // As string for display
  matchCode: string; // YYYYMMDD-N
  homeTeam: string;
  awayTeam: string;
  competition: string;
  competitionCode: string;
  kickoffTime: number; // Unix timestamp
  prediction: Outcome;
  amount: string; // ETH as string
  payout: string | null; // ETH as string
  profit: string | null; // ETH as string
  type: "winning" | "refund";
  claimed: boolean;
  reason?: string; // Optional reason for refund (e.g., "Match cancelled", "No winners")
}

export interface ClaimableData {
  winnings: ClaimableMatch[];
  refunds: ClaimableMatch[];
  totalWinningsAmount: string;
  totalRefundsAmount: string;
}
