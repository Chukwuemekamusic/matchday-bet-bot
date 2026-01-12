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
  ClaimableData,
  ClaimableMatch,
  SubgraphUser,
  SubgraphGlobalStats,
  Outcome,
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
        const isWinning = bet.match.status === "RESOLVED" && bet.prediction === bet.match.result;

        if (isRefund || isWinning) {
          const enriched = await enrichBetWithMatchData(
            bet,
            isRefund ? "refund" : "winning"
          );
          if (enriched) {
            if (isRefund) {
              refunds.push(enriched);
            } else {
              winnings.push(enriched);
            }
          }
        }
      }

      // Calculate totals
      const totalWinningsAmount = winnings
        .reduce((sum, bet) => sum + BigInt(bet.payout || "0"), BigInt(0))
        .toString();
      const totalRefundsAmount = refunds
        .reduce((sum, bet) => sum + BigInt(bet.amount), BigInt(0))
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
};
