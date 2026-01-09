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
