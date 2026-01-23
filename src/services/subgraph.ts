/**
 * The Graph Subgraph Service
 *
 * Queries the MatchDayBetV2 subgraph for on-chain betting data with fallback to database + contract
 */

import { GraphQLClient, gql } from "graphql-request";
import { formatEther } from "viem";
import { config } from "../config/index.js";
import { db } from "../db/index.js";
import type {
  GetUserClaimableResponse,
  GetUserStatsResponse,
  GetLeaderboardResponse,
  GetGlobalStatsResponse,
  GetRecentMatchCreationsResponse,
  SubgraphMatchCreation,
  ClaimableData,
  ClaimableMatch,
  SubgraphUser,
  SubgraphGlobalStats,
  Outcome,
  GetMatchResolutionSkipsResponse,
  GetBatchResolutionSummaryResponse,
  GetBatchResolutionSummariesResponse,
  SubgraphMatchResolutionSkip,
  SubgraphBatchResolutionSummary,
  SubgraphMatch,
  GetMatchResponse,
  SkipReason,
  GetMatchesWithPoolsResponse,
  SubgraphMatchPool,
} from "../types/index.js";

// GraphQL client
const client = new GraphQLClient(config.subgraph.url);

// ============ GraphQL Queries ============

const GET_USER_CLAIMABLE_BETS = gql`
  query GetUserClaimableBets($userAddress: String!) {
    bets(
      where: {
        bettor: $userAddress,
        claimed: false,
        match_: {
          or: [
            { status: RESOLVED },
            { status: CANCELLED }
          ]
        }
      }
      orderBy: placedAt
      orderDirection: desc
    ) {
      id
      amount
      prediction
      claimed
      payout
      profit
      placedAt
      claimedAt
      match {
        id
        matchId
        homeTeam
        awayTeam
        competition
        kickoffTime
        status
        result
        totalPool
        homePool
        drawPool
        awayPool
        platformFeeAmount
        totalClaimed
        cancellationReason
      }
    }
  }
`;

const GET_USER_STATS = gql`
  query GetUserStats($userAddress: String!) {
    user(id: $userAddress) {
      id
      address
      totalBets
      totalWagered
      totalWon
      totalClaimed
      totalProfit
      winCount
      lossCount
      refundCount
      firstBetAt
      lastBetAt
      lastActivityAt
    }
  }
`;

const GET_LEADERBOARD = gql`
  query GetLeaderboard($limit: Int!) {
    users(
      first: $limit
      orderBy: totalProfit
      orderDirection: desc
      where: { totalBets_gt: "0" }
    ) {
      id
      address
      totalBets
      totalWagered
      totalWon
      totalClaimed
      totalProfit
      winCount
      lossCount
      refundCount
      firstBetAt
      lastBetAt
      lastActivityAt
    }
  }
`;

const GET_GLOBAL_STATS = gql`
  query GetGlobalStats {
    globalStats(id: "1") {
      id
      totalMatches
      activeMatches
      resolvedMatches
      cancelledMatches
      totalBets
      totalVolume
      totalFeesCollected
      totalPayouts
      uniqueBettors
      lastUpdatedAt
    }
  }
`;

const GET_RECENT_MATCH_CREATIONS = gql`
  query GetRecentMatchCreations($since: BigInt!) {
    matches(
      where: { createdAt_gte: $since }
      orderBy: createdAt
      orderDirection: desc
      first: 100
    ) {
      id
      matchId
      homeTeam
      awayTeam
      competition
      kickoffTime
      createdAt
      status
    }
  }
`;

// ============ V3 Queries ============

const GET_MATCH_RESOLUTION_SKIPS_BY_TX = gql`
  query GetMatchResolutionSkipsByTx($txHash: String!) {
    matchResolutionSkips(
      where: { transactionHash: $txHash }
      orderBy: timestamp
      orderDirection: desc
    ) {
      id
      match {
        id
        matchId
        homeTeam
        awayTeam
        status
        result
      }
      skipReason
      timestamp
      blockNumber
      transactionHash
    }
  }
`;

const GET_BATCH_RESOLUTION_SUMMARY_BY_TX = gql`
  query GetBatchResolutionSummaryByTx($txHash: String!) {
    batchResolutionSummaries(
      where: { transactionHash: $txHash }
      first: 1
    ) {
      id
      matchIds
      results
      resolvedCount
      skippedCount
      timestamp
      blockNumber
      transactionHash
    }
  }
`;

const GET_RECENT_BATCH_SUMMARIES = gql`
  query GetRecentBatchSummaries($limit: Int!) {
    batchResolutionSummaries(
      first: $limit
      orderBy: timestamp
      orderDirection: desc
    ) {
      id
      matchIds
      results
      resolvedCount
      skippedCount
      timestamp
      blockNumber
      transactionHash
    }
  }
`;

const GET_MATCH = gql`
  query GetMatch($matchId: String!) {
    match(id: $matchId) {
      id
      matchId
      homeTeam
      awayTeam
      competition
      kickoffTime
      status
      result
      homeScore
      awayScore
      totalPool
      homeBets
      drawBets
      awayBets
      createdAt
    }
  }
`;

const GET_MATCHES_WITH_POOLS = gql`
  query GetMatchesWithPools($matchIds: [String!]!) {
    matches(where: { id_in: $matchIds }) {
      id
      matchId
      totalPool
      homePool
      drawPool
      awayPool
    }
  }
`;

// ============ Query with Fallback Helper ============

type QuerySource = "subgraph" | "fallback";

interface QueryResult<T> {
  data: T;
  source: QuerySource;
}

/**
 * Execute GraphQL query with fallback to alternative data source
 */
async function queryWithFallback<T>(
  queryFn: () => Promise<T>,
  fallbackFn: () => Promise<T>
): Promise<QueryResult<T>> {
  try {
    const data = await queryFn();
    return { data, source: "subgraph" };
  } catch (error) {
    console.warn("⚠️ Subgraph query failed, using fallback:", error);
    const data = await fallbackFn();
    return { data, source: "fallback" };
  }
}

// ============ Helper Functions ============

/**
 * Convert subgraph outcome string to Outcome enum
 */
function outcomeFromString(outcome: string): Outcome {
  switch (outcome) {
    case "HOME":
      return 1; // Outcome.HOME
    case "DRAW":
      return 2; // Outcome.DRAW
    case "AWAY":
      return 3; // Outcome.AWAY
    default:
      return 0; // Outcome.NONE
  }
}

/**
 * Join subgraph bet data with database match metadata
 */
async function enrichBetWithMatchData(
  bet: GetUserClaimableResponse["bets"][0],
  type: "winning" | "refund"
): Promise<ClaimableMatch | null> {
  // Get match from database by on_chain_match_id
  const onChainMatchId = parseInt(bet.match.matchId);
  const dbMatch = db.getMatchByOnChainId(onChainMatchId);

  if (!dbMatch) {
    console.warn(`No database match found for on-chain match ID ${onChainMatchId}`);
    return null;
  }

  return {
    betId: bet.id,
    matchId: onChainMatchId,
    onChainMatchId: bet.match.matchId,
    matchCode: dbMatch.match_code || `#${onChainMatchId}`,
    homeTeam: bet.match.homeTeam,
    awayTeam: bet.match.awayTeam,
    competition: bet.match.competition,
    competitionCode: dbMatch.competition_code,
    kickoffTime: parseInt(bet.match.kickoffTime),
    prediction: outcomeFromString(bet.prediction),
    amount: formatEther(BigInt(bet.amount)),
    payout: bet.payout ? formatEther(BigInt(bet.payout)) : null,
    profit: bet.profit ? formatEther(BigInt(bet.profit)) : null,
    type,
    claimed: bet.claimed,
  };
}

// ============ Subgraph Service ============

export const subgraphService = {
  /**
   * Get user's claimable bets (winnings + refunds)
   * Falls back to database + contract queries if subgraph fails
   */
  async getUserClaimable(userAddress: string): Promise<QueryResult<ClaimableData>> {
    const queryFn = async (): Promise<ClaimableData> => {
      const response = await client.request<GetUserClaimableResponse>(
        GET_USER_CLAIMABLE_BETS,
        { userAddress: userAddress.toLowerCase() }
      );

      const winnings: ClaimableMatch[] = [];
      const refunds: ClaimableMatch[] = [];

      for (const bet of response.bets) {
        const isRefund = bet.match.status === "CANCELLED";

        // Check if winner pool is zero (no winners case)
        let winnerPool = BigInt(0);
        if (bet.match.status === "RESOLVED") {
          try {
            if (bet.match.result === "HOME" && bet.match.homePool) {
              winnerPool = BigInt(bet.match.homePool);
            } else if (bet.match.result === "DRAW" && bet.match.drawPool) {
              winnerPool = BigInt(bet.match.drawPool);
            } else if (bet.match.result === "AWAY" && bet.match.awayPool) {
              winnerPool = BigInt(bet.match.awayPool);
            }
          } catch (e) {
            console.warn(`Failed to parse winner pool for match ${bet.match.id}:`, e);
            winnerPool = BigInt(0);
          }
        }
        const isNoWinnersRefund = bet.match.status === "RESOLVED" && winnerPool === BigInt(0);

        // Regular winning bet (user predicted correctly AND there are winners)
        const isWinning =
          bet.match.status === "RESOLVED" &&
          bet.prediction === bet.match.result &&
          winnerPool > BigInt(0);

        if (isRefund || isNoWinnersRefund || isWinning) {
          const enriched = await enrichBetWithMatchData(
            bet,
            (isRefund || isNoWinnersRefund) ? "refund" : "winning"
          );
          if (enriched) {
            if (isRefund) {
              refunds.push(enriched);
            } else if (isNoWinnersRefund) {
              // Treat as refund (everyone gets stake back)
              enriched.reason = "No winners - everyone gets refund";
              refunds.push(enriched);
            } else {
              winnings.push(enriched);
            }
          }
        }
      }

      // Calculate totals
      const totalWinningsAmount = winnings
        .reduce((sum, bet) => {
          try {
            return sum + BigInt(bet.payout || "0");
          } catch (e) {
            console.warn("Failed to parse payout:", bet.payout);
            return sum;
          }
        }, BigInt(0))
        .toString();
      const totalRefundsAmount = refunds
        .reduce((sum, bet) => {
          try {
            return sum + BigInt(bet.amount || "0");
          } catch (e) {
            console.warn("Failed to parse refund amount:", bet.amount);
            return sum;
          }
        }, BigInt(0))
        .toString();

      return {
        winnings,
        refunds,
        totalWinningsAmount: formatEther(BigInt(totalWinningsAmount)),
        totalRefundsAmount: formatEther(BigInt(totalRefundsAmount)),
      };
    };

    const fallbackFn = async (): Promise<ClaimableData> => {
      // Use existing database query (already filters for unclaimed winning bets)
      const claimableBets = db.getClaimableBets(userAddress);

      const winnings: ClaimableMatch[] = [];
      const refunds: ClaimableMatch[] = [];

      for (const bet of claimableBets) {
        if (!bet.on_chain_match_id) continue;

        const isRefund = bet.result === null; // Cancelled matches have null result
        const claimableMatch: ClaimableMatch = {
          betId: `${bet.on_chain_match_id}-${userAddress}`,
          matchId: bet.on_chain_match_id,
          onChainMatchId: bet.on_chain_match_id.toString(),
          matchCode: bet.match_code || `#${bet.on_chain_match_id}`,
          homeTeam: bet.home_team,
          awayTeam: bet.away_team,
          competition: bet.competition,
          competitionCode: bet.competition_code,
          kickoffTime: bet.kickoff_time,
          prediction: bet.prediction,
          amount: bet.amount, // Database stores as string
          payout: null, // Fallback doesn't have pre-calculated payout
          profit: null,
          type: isRefund ? "refund" : "winning",
          claimed: false,
        };

        if (isRefund) {
          refunds.push(claimableMatch);
        } else {
          winnings.push(claimableMatch);
        }
      }

      return {
        winnings,
        refunds,
        totalWinningsAmount: "0", // Fallback doesn't calculate totals
        totalRefundsAmount: "0",
      };
    };

    return queryWithFallback(queryFn, fallbackFn);
  },

  /**
   * Get user statistics
   * Falls back to database stats if subgraph fails
   */
  async getUserStats(userAddress: string): Promise<QueryResult<SubgraphUser | null>> {
    const queryFn = async (): Promise<SubgraphUser | null> => {
      const response = await client.request<GetUserStatsResponse>(
        GET_USER_STATS,
        { userAddress: userAddress.toLowerCase() }
      );
      return response.user;
    };

    const fallbackFn = async (): Promise<SubgraphUser | null> => {
      const stats = db.getUserStats(userAddress);

      if (!stats) {
        return null;
      }

      // Convert database stats to SubgraphUser format
      return {
        id: userAddress.toLowerCase(),
        address: userAddress.toLowerCase(),
        totalBets: stats.total_bets.toString(),
        totalWagered: stats.total_wagered,
        totalWon: stats.total_won,
        totalClaimed: stats.total_won, // Database doesn't track claimed separately
        totalProfit: stats.profit,
        winCount: stats.total_wins.toString(),
        lossCount: (stats.total_bets - stats.total_wins).toString(),
        refundCount: "0", // Database doesn't track refunds
        firstBetAt: "0",
        lastBetAt: stats.updated_at.toString(),
        lastActivityAt: stats.updated_at.toString(),
      };
    };

    return queryWithFallback(queryFn, fallbackFn);
  },

  /**
   * Get leaderboard (top users by profit)
   * No fallback - returns cached or empty on failure
   */
  async getLeaderboard(limit: number = 10): Promise<QueryResult<SubgraphUser[]>> {
    const queryFn = async (): Promise<SubgraphUser[]> => {
      const response = await client.request<GetLeaderboardResponse>(
        GET_LEADERBOARD,
        { limit }
      );
      return response.users;
    };

    const fallbackFn = async (): Promise<SubgraphUser[]> => {
      // Could implement database leaderboard here
      // For now, return empty array
      console.warn("⚠️ Leaderboard unavailable (subgraph down, no fallback implemented)");
      return [];
    };

    return queryWithFallback(queryFn, fallbackFn);
  },

  /**
   * Get global protocol statistics
   * No fallback - returns null on failure
   */
  async getGlobalStats(): Promise<QueryResult<SubgraphGlobalStats | null>> {
    const queryFn = async (): Promise<SubgraphGlobalStats | null> => {
      const response = await client.request<GetGlobalStatsResponse>(GET_GLOBAL_STATS);
      return response.globalStats;
    };

    const fallbackFn = async (): Promise<SubgraphGlobalStats | null> => {
      console.warn("⚠️ Global stats unavailable (subgraph down, no fallback implemented)");
      return null;
    };

    return queryWithFallback(queryFn, fallbackFn);
  },

  /**
   * Get matches created in the last N hours
   * Used for syncing on-chain match IDs to database
   * Falls back to empty array if subgraph fails
   */
  async getRecentMatchCreations(hoursAgo: number = 24): Promise<SubgraphMatchCreation[]> {
    try {
      const nowInSeconds = Math.floor(Date.now() / 1000);
      const sinceTimestamp = nowInSeconds - (hoursAgo * 3600);

      const response = await client.request<GetRecentMatchCreationsResponse>(
        GET_RECENT_MATCH_CREATIONS,
        { since: sinceTimestamp.toString() }
      );

      console.log(`✅ Fetched ${response.matches.length} matches created in last ${hoursAgo} hours from subgraph`);
      return response.matches;
    } catch (error) {
      console.warn(`⚠️ Failed to fetch recent matches from subgraph:`, error);
      return [];
    }
  },

  // ============ V3 Methods ============

  /**
   * Get match resolution skip events for a specific transaction
   * Used to detect result conflicts and other skip reasons after batch resolution
   */
  async getMatchResolutionSkipsByTx(txHash: string): Promise<SubgraphMatchResolutionSkip[]> {
    try {
      const response = await client.request<GetMatchResolutionSkipsResponse>(
        GET_MATCH_RESOLUTION_SKIPS_BY_TX,
        { txHash }
      );

      return response.matchResolutionSkips;
    } catch (error) {
      console.warn(`⚠️ Failed to fetch match resolution skips for tx ${txHash}:`, error);
      return [];
    }
  },

  /**
   * Get batch resolution summary for a specific transaction
   * Returns counts of resolved and skipped matches
   */
  async getBatchResolutionSummaryByTx(txHash: string): Promise<SubgraphBatchResolutionSummary | null> {
    try {
      const response = await client.request<GetBatchResolutionSummaryResponse>(
        GET_BATCH_RESOLUTION_SUMMARY_BY_TX,
        { txHash }
      );

      return response.batchResolutionSummary;
    } catch (error) {
      console.warn(`⚠️ Failed to fetch batch resolution summary for tx ${txHash}:`, error);
      return null;
    }
  },

  /**
   * Get recent batch resolution summaries
   * Useful for monitoring batch operation efficiency
   */
  async getRecentBatchSummaries(limit: number = 10): Promise<SubgraphBatchResolutionSummary[]> {
    try {
      const response = await client.request<GetBatchResolutionSummariesResponse>(
        GET_RECENT_BATCH_SUMMARIES,
        { limit }
      );

      return response.batchResolutionSummaries;
    } catch (error) {
      console.warn(`⚠️ Failed to fetch recent batch summaries:`, error);
      return [];
    }
  },

  /**
   * Check if a transaction has any result conflict skips
   * Returns true if ALREADY_RESOLVED_DIFFERENT_RESULT was detected
   */
  async hasResultConflict(txHash: string): Promise<boolean> {
    const skips = await this.getMatchResolutionSkipsByTx(txHash);
    return skips.some(skip => skip.skipReason === "ALREADY_RESOLVED_DIFFERENT_RESULT");
  },

  /**
   * Get result conflict details for a transaction
   * Returns matches that had result conflicts
   */
  async getResultConflicts(txHash: string): Promise<SubgraphMatchResolutionSkip[]> {
    const skips = await this.getMatchResolutionSkipsByTx(txHash);
    return skips.filter(skip => skip.skipReason === "ALREADY_RESOLVED_DIFFERENT_RESULT");
  },

  /**
   * Get a single match by its on-chain match ID
   * Used for verifying match state during resolution
   */
  async getMatch(matchId: string): Promise<SubgraphMatch | null> {
    try {
      const response = await client.request<GetMatchResponse>(
        GET_MATCH,
        { matchId }
      );

      return response.match;
    } catch (error) {
      console.warn(`⚠️ Failed to fetch match ${matchId} from subgraph:`, error);
      return null;
    }
  },

  /**
   * Get pool amounts for multiple matches
   * Returns a map of matchId -> totalPool for easy lookup
   * Falls back to contract calls if subgraph fails
   */
  async getMatchesPools(
    onChainMatchIds: number[],
    contractService?: any
  ): Promise<Map<number, bigint>> {
    const poolsMap = new Map<number, bigint>();

    if (onChainMatchIds.length === 0) {
      return poolsMap;
    }

    const queryFn = async (): Promise<Map<number, bigint>> => {
      // Subgraph uses entity IDs (string match IDs)
      const matchIdStrings = onChainMatchIds.map(id => id.toString());

      const response = await client.request<GetMatchesWithPoolsResponse>(
        GET_MATCHES_WITH_POOLS,
        { matchIds: matchIdStrings }
      );

      const result = new Map<number, bigint>();
      for (const match of response.matches) {
        const matchId = parseInt(match.matchId);
        const totalPool = BigInt(match.totalPool);
        result.set(matchId, totalPool);
      }

      console.log(`✅ Fetched pool data for ${result.size}/${onChainMatchIds.length} matches from subgraph`);
      return result;
    };

    const fallbackFn = async (): Promise<Map<number, bigint>> => {
      console.log(`⚠️ Subgraph unavailable, falling back to contract calls for ${onChainMatchIds.length} matches`);

      if (!contractService || !contractService.isContractAvailable()) {
        console.warn("⚠️ Contract service not available, returning empty pools");
        return new Map<number, bigint>();
      }

      const result = new Map<number, bigint>();

      // Fetch pools from contract for each match
      for (const matchId of onChainMatchIds) {
        try {
          const pools = await contractService.getPools(matchId);
          if (pools) {
            result.set(matchId, pools.total);
          }
        } catch (error) {
          console.warn(`⚠️ Failed to fetch pools for match ${matchId} from contract:`, error);
        }
      }

      console.log(`✅ Fetched pool data for ${result.size}/${onChainMatchIds.length} matches from contract`);
      return result;
    };

    try {
      const { data } = await queryWithFallback(queryFn, fallbackFn);
      return data;
    } catch (error) {
      console.error("❌ Failed to fetch match pools from both subgraph and contract:", error);
      return new Map<number, bigint>();
    }
  },
};
