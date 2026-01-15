import {
  createPublicClient,
  http,
  encodeFunctionData,
  decodeEventLog,
  type PublicClient,
  type Address,
} from "viem";
import { execute } from "viem/experimental/erc7821";
import { base } from "viem/chains";
import config from "../config";
import { Outcome, ContractMatch, ContractBet } from "../types";

// Contract ABI (JSON format for complex types)
export const CONTRACT_ABI = [
  // Read functions with struct returns
  {
    type: "function",
    name: "getMatch",
    stateMutability: "view",
    inputs: [{ name: "matchId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "matchId", type: "uint256" },
          { name: "kickoffTime", type: "uint256" },
          { name: "totalPool", type: "uint256" },
          { name: "homePool", type: "uint256" },
          { name: "drawPool", type: "uint256" },
          { name: "awayPool", type: "uint256" },
          { name: "homeBetCount", type: "uint256" },
          { name: "drawBetCount", type: "uint256" },
          { name: "awayBetCount", type: "uint256" },
          { name: "platformFeeAmount", type: "uint256" },
          { name: "result", type: "uint8" },
          { name: "status", type: "uint8" },
          { name: "homeTeam", type: "string" },
          { name: "awayTeam", type: "string" },
          { name: "competition", type: "string" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getUserBet",
    stateMutability: "view",
    inputs: [
      { name: "matchId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "bettor", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "prediction", type: "uint8" },
          { name: "claimed", type: "bool" },
        ],
      },
    ],
  },
  // Read functions with multiple returns
  {
    type: "function",
    name: "getOdds",
    stateMutability: "view",
    inputs: [{ name: "matchId", type: "uint256" }],
    outputs: [
      { name: "homeOdds", type: "uint256" },
      { name: "drawOdds", type: "uint256" },
      { name: "awayOdds", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getPools",
    stateMutability: "view",
    inputs: [{ name: "matchId", type: "uint256" }],
    outputs: [
      { name: "total", type: "uint256" },
      { name: "home", type: "uint256" },
      { name: "draw", type: "uint256" },
      { name: "away", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "hasUserBet",
    stateMutability: "view",
    inputs: [
      { name: "matchId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "calculatePotentialWinnings",
    stateMutability: "view",
    inputs: [
      { name: "matchId", type: "uint256" },
      { name: "outcome", type: "uint8" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "nextMatchId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "minStake",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "maxStake",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "platformFeeBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getBetCounts",
    stateMutability: "view",
    inputs: [{ name: "matchId", type: "uint256" }],
    outputs: [
      { name: "homeBets", type: "uint256" },
      { name: "drawBets", type: "uint256" },
      { name: "awayBets", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "matchManagers",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "isMatchManager",
    stateMutability: "view",
    inputs: [{ name: "manager", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "accumulatedFees",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "version",
    stateMutability: "pure",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },

  // Write functions
  {
    type: "function",
    name: "createMatch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "homeTeam", type: "string" },
      { name: "awayTeam", type: "string" },
      { name: "competition", type: "string" },
      { name: "kickoffTime", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "placeBet",
    stateMutability: "payable",
    inputs: [
      { name: "matchId", type: "uint256" },
      { name: "prediction", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "closeBetting",
    stateMutability: "nonpayable",
    inputs: [{ name: "matchId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "resolveMatch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "matchId", type: "uint256" },
      { name: "result", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "batchResolveMatches",
    stateMutability: "nonpayable",
    inputs: [
      { name: "matchIds", type: "uint256[]" },
      { name: "results", type: "uint8[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelMatch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "matchId", type: "uint256" },
      { name: "reason", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claimWinnings",
    stateMutability: "nonpayable",
    inputs: [{ name: "matchId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claimRefund",
    stateMutability: "nonpayable",
    inputs: [{ name: "matchId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "emergencyPause",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },

  // Events
  {
    type: "event",
    name: "MatchCreated",
    inputs: [
      { name: "matchId", type: "uint256", indexed: true },
      { name: "homeTeam", type: "string", indexed: false },
      { name: "awayTeam", type: "string", indexed: false },
      { name: "competition", type: "string", indexed: false },
      { name: "kickoffTime", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BetPlaced",
    inputs: [
      { name: "matchId", type: "uint256", indexed: true },
      { name: "bettor", type: "address", indexed: true },
      { name: "prediction", type: "uint8", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "newPoolTotal", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BettingClosed",
    inputs: [{ name: "matchId", type: "uint256", indexed: true }],
  },
  {
    type: "event",
    name: "MatchResolved",
    inputs: [
      { name: "matchId", type: "uint256", indexed: true },
      { name: "result", type: "uint8", indexed: false },
      { name: "totalPool", type: "uint256", indexed: false },
      { name: "winnerPool", type: "uint256", indexed: false },
      { name: "platformFee", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "MatchCancelled",
    inputs: [
      { name: "matchId", type: "uint256", indexed: true },
      { name: "reason", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "WinningsClaimed",
    inputs: [
      { name: "matchId", type: "uint256", indexed: true },
      { name: "bettor", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "profit", type: "uint256", indexed: false },
    ],
  },

  // V2 Functions - Enhanced claim and batch operations
  {
    type: "function",
    name: "getClaimStatus",
    stateMutability: "view",
    inputs: [
      { name: "matchId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "canClaim", type: "bool" },
          { name: "claimType", type: "uint8" }, // 0 = none, 1 = winnings, 2 = refund
          { name: "amount", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getUnclaimedWinnings",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "matchIds", type: "uint256[]" },
      { name: "amounts", type: "uint256[]" },
    ],
  },
  {
    type: "function",
    name: "getClaimableAmount",
    stateMutability: "view",
    inputs: [
      { name: "matchId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getBatchClaimableAmounts",
    stateMutability: "view",
    inputs: [
      { name: "matchIds", type: "uint256[]" },
      { name: "user", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "batchClaimWinnings",
    stateMutability: "nonpayable",
    inputs: [{ name: "matchIds", type: "uint256[]" }],
    outputs: [],
  },
  {
    type: "function",
    name: "batchClaimRefunds",
    stateMutability: "nonpayable",
    inputs: [{ name: "matchIds", type: "uint256[]" }],
    outputs: [],
  },
] as const;

class ContractService {
  private publicClient: PublicClient;
  private bot: any; // Towns bot instance
  private contractAddress: Address;

  constructor(bot: any) {
    this.bot = bot;

    // Create public client for reading
    this.publicClient = createPublicClient({
      chain: base,
      transport: http(config.chain.rpcUrl),
    }) as PublicClient;

    this.contractAddress = config.contract.address as Address;

    console.log(`Contract service initialized`);
    console.log(`Bot wallet address: ${this.bot.viem.account.address}`);
    console.log(`Bot treasury address: ${this.bot.appAddress}`);
    console.log(`Contract address: ${config.contract.address}`);
  }

  /**
   * Check if a real contract is deployed and available
   * Returns false if using placeholder address (pre-deployment)
   */
  isContractAvailable(): boolean {
    const placeholderAddress = "0x0000000000000000000000000000000000000000";
    return (
      this.contractAddress.toLowerCase() !== placeholderAddress.toLowerCase()
    );
  }

  /**
   * Get bot wallet address (gas wallet)
   */
  getBotAddress(): string {
    return this.bot.viem.account.address;
  }

  /**
   * Get bot treasury address (SimpleAccount)
   */
  getBotTreasuryAddress(): string {
    return this.bot.appAddress;
  }

  /**
   * Get bot treasury balance
   */
  async getBotBalance(): Promise<bigint> {
    return await this.publicClient.getBalance({
      address: this.bot.appAddress,
    });
  }

  // ==================== READ FUNCTIONS ====================

  /**
   * Get match data from contract
   */
  async getMatch(matchId: number): Promise<ContractMatch | null> {
    try {
      const match = (await this.publicClient.readContract({
        address: this.contractAddress,
        abi: CONTRACT_ABI,
        functionName: "getMatch",
        args: [BigInt(matchId)],
      })) as ContractMatch;
      return match;
    } catch (error) {
      console.error(`Failed to get match ${matchId} from contract`, error);
      return null;
    }
  }

  /**
   * Get current odds for a match
   */
  async getOdds(
    matchId: number
  ): Promise<{ home: bigint; draw: bigint; away: bigint } | null> {
    try {
      const [homeOdds, drawOdds, awayOdds] =
        (await this.publicClient.readContract({
          address: this.contractAddress,
          abi: CONTRACT_ABI,
          functionName: "getOdds",
          args: [BigInt(matchId)],
        })) as [bigint, bigint, bigint];
      return { home: homeOdds, draw: drawOdds, away: awayOdds };
    } catch (error) {
      console.error(`Failed to get odds for match ${matchId}`, error);
      return null;
    }
  }

  /**
   * Get pool amounts for a match
   */
  async getPools(matchId: number): Promise<{
    total: bigint;
    home: bigint;
    draw: bigint;
    away: bigint;
  } | null> {
    try {
      const [total, home, draw, away] = (await this.publicClient.readContract({
        address: this.contractAddress,
        abi: CONTRACT_ABI,
        functionName: "getPools",
        args: [BigInt(matchId)],
      })) as [bigint, bigint, bigint, bigint];
      return { total, home, draw, away };
    } catch (error) {
      console.error(`Failed to get pools for match ${matchId}`, error);
      return null;
    }
  }

  /**
   * Get user's bet for a match
   */
  async getUserBet(
    matchId: number,
    userAddress: string
  ): Promise<ContractBet | null> {
    try {
      const bet = (await this.publicClient.readContract({
        address: this.contractAddress,
        abi: CONTRACT_ABI,
        functionName: "getUserBet",
        args: [BigInt(matchId), userAddress as Address],
      })) as ContractBet;
      return bet;
    } catch (error) {
      console.error(`Failed to get user bet for match ${matchId}`, error);
      return null;
    }
  }

  /**
   * Batch check multiple matches for user bets (single RPC call using multicall)
   * Used by /verify command to efficiently check recent matches
   */
  async getBatchUserBets(
    matchIds: number[],
    userAddress: string
  ): Promise<Array<{ matchId: number; bet: ContractBet | null }>> {
    try {
      if (matchIds.length === 0) {
        return [];
      }

      // Use multicall to batch all getUserBet calls into a single RPC request
      const results = await this.publicClient.multicall({
        contracts: matchIds.map((matchId) => ({
          address: this.contractAddress,
          abi: CONTRACT_ABI,
          functionName: "getUserBet",
          args: [BigInt(matchId), userAddress as Address],
        })),
      });

      // Map results back to matchIds
      return results.map((result, index) => {
        let bet: ContractBet | null = null;
        if (result.status === "success" && result.result) {
          // Viem returns the contract result directly
          bet = result.result as unknown as ContractBet;
        }
        return {
          matchId: matchIds[index],
          bet,
        };
      });
    } catch (error) {
      console.error("Failed to batch get user bets", error);
      return matchIds.map((matchId) => ({ matchId, bet: null }));
    }
  }

  /**
   * Check if user has bet on a match
   */
  async hasUserBet(matchId: number, userAddress: string): Promise<boolean> {
    try {
      return (await this.publicClient.readContract({
        address: this.contractAddress,
        abi: CONTRACT_ABI,
        functionName: "hasUserBet",
        args: [BigInt(matchId), userAddress as Address],
      })) as boolean;
    } catch (error) {
      console.error(`Failed to check user bet for match ${matchId}`, error);
      return false;
    }
  }

  /**
   * Calculate potential winnings for a bet
   */
  async calculatePotentialWinnings(
    matchId: number,
    outcome: Outcome,
    amount: bigint
  ): Promise<bigint | null> {
    try {
      return (await this.publicClient.readContract({
        address: this.contractAddress,
        abi: CONTRACT_ABI,
        functionName: "calculatePotentialWinnings",
        args: [BigInt(matchId), outcome, amount],
      })) as bigint;
    } catch (error) {
      console.error(`Failed to calculate potential winnings`, error);
      return null;
    }
  }

  /**
   * Get next match ID (for knowing what ID will be assigned)
   */
  async getNextMatchId(): Promise<number> {
    const nextId = (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: CONTRACT_ABI,
      functionName: "nextMatchId",
    })) as bigint;
    return Number(nextId);
  }

  /**
   * Get bet counts for a match
   */
  async getBetCounts(matchId: number): Promise<{
    home: bigint;
    draw: bigint;
    away: bigint;
  } | null> {
    try {
      const [home, draw, away] = (await this.publicClient.readContract({
        address: this.contractAddress,
        abi: CONTRACT_ABI,
        functionName: "getBetCounts",
        args: [BigInt(matchId)],
      })) as [bigint, bigint, bigint];
      return { home, draw, away };
    } catch (error) {
      console.error(`Failed to get bet counts for match ${matchId}`, error);
      return null;
    }
  }

  /**
   * Get stake limits
   */
  async getStakeLimits(): Promise<{ min: bigint; max: bigint }> {
    const [min, max] = await Promise.all([
      this.publicClient.readContract({
        address: this.contractAddress,
        abi: CONTRACT_ABI,
        functionName: "minStake",
      }) as Promise<bigint>,
      this.publicClient.readContract({
        address: this.contractAddress,
        abi: CONTRACT_ABI,
        functionName: "maxStake",
      }) as Promise<bigint>,
    ]);
    return { min, max };
  }

  /**
   * Check if an address is a match manager
   */
  async isMatchManager(address: Address): Promise<boolean> {
    try {
      return (await this.publicClient.readContract({
        address: this.contractAddress,
        abi: CONTRACT_ABI,
        functionName: "isMatchManager",
        args: [address],
      })) as boolean;
    } catch (error) {
      console.error(`Failed to check if ${address} is match manager`, error);
      return false;
    }
  }

  /**
   * Check if bot is a match manager
   */
  async isBotMatchManager(): Promise<boolean> {
    return this.isMatchManager(this.bot.appAddress as Address);
  }

  /**
   * Get contract owner address
   */
  async getOwner(): Promise<string | null> {
    try {
      return (await this.publicClient.readContract({
        address: this.contractAddress,
        abi: CONTRACT_ABI,
        functionName: "owner",
      })) as string;
    } catch (error) {
      console.error("Failed to get contract owner", error);
      return null;
    }
  }

  /**
   * Get contract version
   */
  async getVersion(): Promise<string | null> {
    try {
      return (await this.publicClient.readContract({
        address: this.contractAddress,
        abi: CONTRACT_ABI,
        functionName: "version",
      })) as string;
    } catch (error) {
      console.error("Failed to get contract version", error);
      return null;
    }
  }

  /**
   * Get platform fee in basis points
   */
  async getPlatformFeeBps(): Promise<bigint | null> {
    try {
      return (await this.publicClient.readContract({
        address: this.contractAddress,
        abi: CONTRACT_ABI,
        functionName: "platformFeeBps",
      })) as bigint;
    } catch (error) {
      console.error("Failed to get platform fee", error);
      return null;
    }
  }

  /**
   * Get accumulated fees
   */
  async getAccumulatedFees(): Promise<bigint | null> {
    try {
      return (await this.publicClient.readContract({
        address: this.contractAddress,
        abi: CONTRACT_ABI,
        functionName: "accumulatedFees",
      })) as bigint;
    } catch (error) {
      console.error("Failed to get accumulated fees", error);
      return null;
    }
  }

  // ==================== V2 FUNCTIONS ====================

  /**
   * Get claim status for a user's bet on a specific match
   * Returns: { canClaim: boolean, claimType: 0|1|2, amount: bigint }
   * claimType: 0 = none, 1 = winnings, 2 = refund
   */
  async getClaimStatus(
    matchId: number,
    userAddress: Address
  ): Promise<{ canClaim: boolean; claimType: number; amount: bigint } | null> {
    try {
      const result = (await this.publicClient.readContract({
        address: this.contractAddress,
        abi: CONTRACT_ABI,
        functionName: "getClaimStatus",
        args: [BigInt(matchId), userAddress],
      })) as { canClaim: boolean; claimType: number; amount: bigint };
      return result;
    } catch (error) {
      console.error(
        `Failed to get claim status for match ${matchId} and user ${userAddress}`,
        error
      );
      return null;
    }
  }

  /**
   * Get all unclaimed winnings for a user (V2)
   * Returns arrays of match IDs and corresponding amounts
   */
  async getUnclaimedWinnings(
    userAddress: Address
  ): Promise<{ matchIds: bigint[]; amounts: bigint[] } | null> {
    try {
      const result = (await this.publicClient.readContract({
        address: this.contractAddress,
        abi: CONTRACT_ABI,
        functionName: "getUnclaimedWinnings",
        args: [userAddress],
      })) as readonly [readonly bigint[], readonly bigint[]];

      return {
        matchIds: Array.from(result[0]),
        amounts: Array.from(result[1]),
      };
    } catch (error) {
      console.error(
        `Failed to get unclaimed winnings for user ${userAddress}`,
        error
      );
      return null;
    }
  }

  /**
   * Get claimable amount for a specific match and user
   */
  async getClaimableAmount(
    matchId: number,
    userAddress: Address
  ): Promise<bigint | null> {
    try {
      return (await this.publicClient.readContract({
        address: this.contractAddress,
        abi: CONTRACT_ABI,
        functionName: "getClaimableAmount",
        args: [BigInt(matchId), userAddress],
      })) as bigint;
    } catch (error) {
      console.error(
        `Failed to get claimable amount for match ${matchId} and user ${userAddress}`,
        error
      );
      return null;
    }
  }

  /**
   * Get claimable amounts for multiple matches in batch
   */
  async getBatchClaimableAmounts(
    matchIds: number[],
    userAddress: Address
  ): Promise<bigint[] | null> {
    try {
      const matchIdsBigInt = matchIds.map((id) => BigInt(id));
      return (await this.publicClient.readContract({
        address: this.contractAddress,
        abi: CONTRACT_ABI,
        functionName: "getBatchClaimableAmounts",
        args: [matchIdsBigInt, userAddress],
      })) as bigint[];
    } catch (error) {
      console.error(
        `Failed to get batch claimable amounts for user ${userAddress}`,
        error
      );
      return null;
    }
  }

  // ==================== WRITE FUNCTIONS ====================

  /**
   * Create a new match on-chain
   */
  async createMatch(
    homeTeam: string,
    awayTeam: string,
    competition: string,
    kickoffTime: number
  ): Promise<
    | { matchId: number; txHash: string; error?: never }
    | { matchId?: never; txHash?: never; error: string; errorType: string }
  > {
    try {
      console.log(`Creating match: ${homeTeam} vs ${awayTeam}`);

      // Pre-flight checks
      const balance = await this.getBotBalance();
      if (balance < BigInt(10 ** 15)) {
        // Less than 0.001 ETH
        console.error(
          `Insufficient balance: ${balance} wei (${
            Number(balance) / 10 ** 18
          } ETH)`
        );
        return {
          error: `Bot treasury has insufficient gas. Balance: ${
            Number(balance) / 10 ** 18
          } ETH. Please fund ${this.bot.appAddress}`,
          errorType: "INSUFFICIENT_GAS",
        };
      }

      const hash = await execute(this.bot.viem, {
        address: this.bot.appAddress,
        account: this.bot.viem.account,
        chain: base,
        calls: [
          {
            to: this.contractAddress,
            abi: CONTRACT_ABI,
            functionName: "createMatch",
            args: [homeTeam, awayTeam, competition, BigInt(kickoffTime)],
          },
        ],
      });

      console.log(`Match creation tx sent: ${hash}`);

      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });

      // Check if transaction was successful
      if (receipt.status === "reverted") {
        console.error(`Match creation transaction reverted: ${hash}`);
        return {
          error: `Transaction reverted. The bot may not be a match manager. Check with /checkmanager`,
          errorType: "TRANSACTION_REVERTED",
        };
      }

      // Parse the MatchCreated event to get the match ID
      let matchId: number | null = null;

      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: CONTRACT_ABI,
            data: log.data,
            topics: log.topics,
          });

          if (decoded.eventName === "MatchCreated") {
            matchId = Number(decoded.args.matchId);
            console.log(
              `✅ Match created with ID: ${matchId} (from MatchCreated event)`
            );
            break;
          }
        } catch {
          // Not a MatchCreated event or failed to decode, continue
          continue;
        }
      }

      if (matchId !== null) {
        return { matchId, txHash: hash };
      }

      // Fallback: If we couldn't parse the event, try to verify using nextMatchId
      console.warn(
        `⚠️  Failed to parse MatchCreated event from tx ${hash}. Attempting fallback verification...`
      );

      try {
        const nextId = await this.getNextMatchId();
        const candidateId = nextId - 1;

        console.log(
          `Checking if match ID ${candidateId} matches our created match...`
        );

        // Verify the match at candidateId matches what we created
        const onChainMatch = await this.getMatch(candidateId);

        if (!onChainMatch) {
          console.error(`❌ Match ID ${candidateId} does not exist on-chain`);
          return {
            error: `Failed to verify match creation. Transaction succeeded (${hash}) but cannot confirm match ID.`,
            errorType: "EVENT_PARSE_FAILED",
          };
        }

        // Verify teams match (case-insensitive)
        const homeMatches =
          onChainMatch.homeTeam.toLowerCase() === homeTeam.toLowerCase();
        const awayMatches =
          onChainMatch.awayTeam.toLowerCase() === awayTeam.toLowerCase();
        const kickoffMatches =
          Math.abs(Number(onChainMatch.kickoffTime) - kickoffTime) < 300; // Within 5 minutes

        if (homeMatches && awayMatches && kickoffMatches) {
          console.log(
            `✅ Verified match ID ${candidateId} via fallback (teams and kickoff match)`
          );
          return { matchId: candidateId, txHash: hash };
        } else {
          console.error(
            `❌ Match ID ${candidateId} does not match our created match`
          );
          console.error(
            `Expected: ${homeTeam} vs ${awayTeam} @ ${kickoffTime}`
          );
          console.error(
            `On-chain: ${onChainMatch.homeTeam} vs ${onChainMatch.awayTeam} @ ${onChainMatch.kickoffTime}`
          );
          return {
            error: `Failed to verify match creation. Transaction succeeded (${hash}) but match data mismatch. Please check manually.`,
            errorType: "MATCH_VERIFICATION_FAILED",
          };
        }
      } catch (fallbackError) {
        console.error(`❌ Fallback verification failed:`, fallbackError);
        return {
          error: `Failed to parse match creation event and fallback verification failed. Tx: ${hash}`,
          errorType: "EVENT_PARSE_FAILED",
        };
      }
    } catch (error: any) {
      console.error(`Failed to create match on-chain`, error);

      // Parse specific error types
      const errorMessage = error?.message || String(error);

      // Check for specific error patterns
      if (errorMessage.includes("insufficient funds")) {
        return {
          error: `Insufficient gas in bot treasury. Please fund ${this.bot.appAddress}`,
          errorType: "INSUFFICIENT_GAS",
        };
      }

      if (
        errorMessage.includes("NotMatchManager") ||
        errorMessage.includes("Ownable")
      ) {
        return {
          error: `Bot is not registered as a match manager. Use /checkmanager for instructions.`,
          errorType: "NOT_MATCH_MANAGER",
        };
      }

      if (errorMessage.includes("nonce")) {
        return {
          error: `Transaction nonce error. Please try again in a few seconds.`,
          errorType: "NONCE_ERROR",
        };
      }

      if (
        errorMessage.includes("timeout") ||
        errorMessage.includes("timed out")
      ) {
        return {
          error: `RPC timeout. The network may be congested. Please try again.`,
          errorType: "RPC_TIMEOUT",
        };
      }

      // Generic error
      return {
        error: `Failed to create match: ${errorMessage.slice(0, 100)}`,
        errorType: "UNKNOWN",
      };
    }
  }

  /**
   * Place a bet on behalf of a user
   * Note: In Towns, users sign their own transactions, so this is for reference
   * The actual implementation will use the user's connected wallet
   */
  async placeBetAsBot(
    matchId: number,
    prediction: Outcome,
    amount: bigint
  ): Promise<{ txHash: string } | null> {
    try {
      console.log(
        `Placing bet: match ${matchId}, prediction ${prediction}, amount ${amount}`
      );

      const hash = await execute(this.bot.viem, {
        address: this.bot.appAddress,
        account: this.bot.viem.account,
        chain: base,
        calls: [
          {
            to: this.contractAddress,
            abi: CONTRACT_ABI,
            functionName: "placeBet",
            args: [BigInt(matchId), prediction],
            value: amount,
          },
        ],
      });

      console.log(`Bet placement tx sent: ${hash}`);
      await this.publicClient.waitForTransactionReceipt({ hash });

      return { txHash: hash };
    } catch (error) {
      console.error(`Failed to place bet`, error);
      return null;
    }
  }

  /**
   * Close betting for a match
   */
  async closeBetting(matchId: number): Promise<{ txHash: string } | null> {
    try {
      console.log(`Closing betting for match ${matchId}`);

      const hash = await execute(this.bot.viem, {
        address: this.bot.appAddress,
        account: this.bot.viem.account,
        chain: base,
        calls: [
          {
            to: this.contractAddress,
            abi: CONTRACT_ABI,
            functionName: "closeBetting",
            args: [BigInt(matchId)],
          },
        ],
      });

      console.log(`Close betting tx sent: ${hash}`);
      await this.publicClient.waitForTransactionReceipt({ hash });

      return { txHash: hash };
    } catch (error) {
      console.error(`Failed to close betting for match ${matchId}`, error);
      return null;
    }
  }

  /**
   * Resolve a match with the final result
   */
  async resolveMatch(
    matchId: number,
    result: Outcome
  ): Promise<{ txHash: string } | null> {
    try {
      console.log(`Resolving match ${matchId} with result ${result}`);

      const hash = await execute(this.bot.viem, {
        address: this.bot.appAddress,
        account: this.bot.viem.account,
        chain: base,
        calls: [
          {
            to: this.contractAddress,
            abi: CONTRACT_ABI,
            functionName: "resolveMatch",
            args: [BigInt(matchId), result],
          },
        ],
      });

      console.log(`Resolve match tx sent: ${hash}`);
      await this.publicClient.waitForTransactionReceipt({ hash });

      return { txHash: hash };
    } catch (error) {
      console.error(`Failed to resolve match ${matchId}`, error);
      return null;
    }
  }

  /**
   * Resolve multiple matches in a single transaction (batch operation)
   * Gas-efficient for resolving multiple matches at once
   */
  async batchResolveMatches(
    matches: Array<{ matchId: number; result: Outcome }>
  ): Promise<{ txHash: string } | null> {
    try {
      if (matches.length === 0) {
        console.log("No matches to resolve");
        return null;
      }

      const matchIds = matches.map((m) => BigInt(m.matchId));
      const results = matches.map((m) => m.result);

      console.log(
        `Batch resolving ${matches.length} matches:`,
        matches.map((m) => `${m.matchId}=${m.result}`).join(", ")
      );

      const hash = await execute(this.bot.viem, {
        address: this.bot.appAddress,
        account: this.bot.viem.account,
        chain: base,
        calls: [
          {
            to: this.contractAddress,
            abi: CONTRACT_ABI,
            functionName: "batchResolveMatches",
            args: [matchIds, results],
          },
        ],
      });

      console.log(`Batch resolve tx sent: ${hash}`);
      await this.publicClient.waitForTransactionReceipt({ hash });

      console.log(`Successfully resolved ${matches.length} matches in batch`);
      return { txHash: hash };
    } catch (error) {
      console.error(`Failed to batch resolve ${matches.length} matches`, error);
      return null;
    }
  }

  /**
   * Cancel a match
   */
  async cancelMatch(
    matchId: number,
    reason: string
  ): Promise<{ txHash: string } | null> {
    try {
      console.log(`Cancelling match ${matchId}: ${reason}`);

      const hash = await execute(this.bot.viem, {
        address: this.bot.appAddress,
        account: this.bot.viem.account,
        chain: base,
        calls: [
          {
            to: this.contractAddress,
            abi: CONTRACT_ABI,
            functionName: "cancelMatch",
            args: [BigInt(matchId), reason],
          },
        ],
      });

      console.log(`Cancel match tx sent: ${hash}`);
      await this.publicClient.waitForTransactionReceipt({ hash });

      return { txHash: hash };
    } catch (error) {
      console.error(`Failed to cancel match ${matchId}`, error);
      return null;
    }
  }

  // ==================== EVENT POLLING ====================
  // NOTE: Event polling via RPC is currently disabled due to rate limits on free tier.
  // The bot now uses transaction response handling in onInteractionResponse for instant confirmations.
  // This method is reserved for future subgraph integration, which will provide efficient
  // historical event queries without RPC limitations.

  /**
   * Get recent BetPlaced events
   * Polls for events from a specific block range
   *
   * @deprecated Currently unused. Reserved for future subgraph integration.
   */
  async getRecentBetEvents(
    fromBlock: bigint,
    toBlock: bigint
  ): Promise<
    Array<{
      matchId: number;
      user: string;
      prediction: Outcome;
      amount: bigint;
      txHash: string;
      blockNumber: bigint;
    }>
  > {
    try {
      const logs = await this.publicClient.getLogs({
        address: this.contractAddress,
        event: CONTRACT_ABI.find((item) => item.name === "BetPlaced")!,
        fromBlock,
        toBlock,
      });

      return logs.map((log) => ({
        matchId: Number(log.args.matchId),
        user: log.args.bettor as string,
        prediction: log.args.prediction as Outcome,
        amount: log.args.amount as bigint,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
      }));
    } catch (error) {
      console.error("Failed to fetch BetPlaced events", error);
      return [];
    }
  }

  // ==================== HELPER FUNCTIONS ====================

  /**
   * Generate calldata for placeBet (for user to sign)
   */
  encodePlaceBet(matchId: number, prediction: Outcome): `0x${string}` {
    return encodeFunctionData({
      abi: CONTRACT_ABI,
      functionName: "placeBet",
      args: [BigInt(matchId), prediction],
    });
  }

  /**
   * Generate calldata for claimWinnings (for user to sign)
   */
  encodeClaimWinnings(matchId: number): `0x${string}` {
    return encodeFunctionData({
      abi: CONTRACT_ABI,
      functionName: "claimWinnings",
      args: [BigInt(matchId)],
    });
  }

  /**
   * Generate multiple claimWinnings calldata for batch claiming
   * Returns array of calldata hex strings
   */
  encodeBatchClaimWinnings(matchIds: number[]): `0x${string}`[] {
    return matchIds.map((matchId) =>
      encodeFunctionData({
        abi: CONTRACT_ABI,
        functionName: "claimWinnings",
        args: [BigInt(matchId)],
      })
    );
  }

  /**
   * Generate calldata for claimRefund (for user to sign)
   */
  encodeClaimRefund(matchId: number): `0x${string}` {
    return encodeFunctionData({
      abi: CONTRACT_ABI,
      functionName: "claimRefund",
      args: [BigInt(matchId)],
    });
  }

  /**
   * Check if a user is eligible for a refund
   * Returns true if:
   * 1. Match is CANCELLED, OR
   * 2. Match is RESOLVED and everyone bet on the same outcome (winnerPool == totalPool), OR
   * 3. Match is RESOLVED and no one bet on the winning outcome (winnerPool == 0)
   */
  async isRefundEligible(
    matchId: number,
    userAddress: Address
  ): Promise<{ eligible: boolean; reason?: string }> {
    if (!this.isContractAvailable()) {
      return { eligible: false, reason: "Contract not available" };
    }

    try {
      // Get match data
      const match = await this.getMatch(matchId);
      if (!match) {
        return { eligible: false, reason: "Match not found" };
      }

      // Get user's bet
      const userBet = await this.getUserBet(matchId, userAddress);
      if (!userBet || userBet.amount === 0n) {
        return { eligible: false, reason: "No bet found" };
      }

      // Check if already claimed
      if (userBet.claimed) {
        return { eligible: false, reason: "Already claimed" };
      }

      // Case 1: Match is CANCELLED (status = 3)
      if (match.status === 3) {
        return { eligible: true, reason: "Match cancelled" };
      }

      // Case 2 & 3: Match is RESOLVED (status = 2)
      if (match.status === 2) {
        // Get the winner pool based on the result
        let winnerPool = 0n;
        if (match.result === 1) {
          // HOME
          winnerPool = match.homePool;
        } else if (match.result === 2) {
          // DRAW
          winnerPool = match.drawPool;
        } else if (match.result === 3) {
          // AWAY
          winnerPool = match.awayPool;
        }

        // Case 2: Everyone bet on the same outcome
        if (winnerPool === match.totalPool && winnerPool > 0n) {
          // User gets refund via claimWinnings (returns original stake)
          // But they should use /claim, not /claim-refund
          return {
            eligible: false,
            reason: "Use /claim to get your stake back (everyone bet the same)",
          };
        }

        // Case 3: No one bet on the winning outcome
        // In V2, this is handled by claimWinnings(), not claimRefund()
        if (winnerPool === 0n) {
          return {
            eligible: false,
            reason:
              "Use /claim to get your refund (no winners - everyone gets refund)",
          };
        }

        // User is a loser in a normal resolved match
        return { eligible: false, reason: "Match resolved - you lost" };
      }

      // Match is not resolved or cancelled yet
      return {
        eligible: false,
        reason: "Match not resolved or cancelled yet",
      };
    } catch (error) {
      console.error("Error checking refund eligibility:", error);
      return { eligible: false, reason: "Error checking eligibility" };
    }
  }

  /**
   * Get contract address
   */
  getContractAddress(): string {
    return config.contract.address;
  }
}

// Export class - will be instantiated with bot instance in index.ts
export { ContractService };
export default ContractService;
