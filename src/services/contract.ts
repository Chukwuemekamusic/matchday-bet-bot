import {
  createPublicClient,
  http,
  parseAbiItem,
  encodeFunctionData,
  type PublicClient,
  type Address,
} from "viem";
import { execute } from "viem/experimental/erc7821";
import { base } from "viem/chains";
import config from "../config";
import { Outcome, ContractMatch, ContractBet } from "../types";

// Contract ABI (using viem's parseAbiItem format)
const CONTRACT_ABI = [
  // Read functions
  parseAbiItem(
    "function getMatch(uint256 matchId) view returns (tuple(uint256 matchId, uint256 kickoffTime, uint256 totalPool, uint256 homePool, uint256 drawPool, uint256 awayPool, uint256 homeBetCount, uint256 drawBetCount, uint256 awayBetCount, uint256 platformFeeAmount, uint8 result, uint8 status, string homeTeam, string awayTeam, string competition))"
  ),
  parseAbiItem(
    "function getOdds(uint256 matchId) view returns (uint256 homeOdds, uint256 drawOdds, uint256 awayOdds)"
  ),
  parseAbiItem(
    "function getPools(uint256 matchId) view returns (uint256 total, uint256 home, uint256 draw, uint256 away)"
  ),
  parseAbiItem(
    "function getUserBet(uint256 matchId, address user) view returns (tuple(address bettor, uint256 amount, uint8 prediction, bool claimed))"
  ),
  parseAbiItem(
    "function hasUserBet(uint256 matchId, address user) view returns (bool)"
  ),
  parseAbiItem(
    "function calculatePotentialWinnings(uint256 matchId, uint8 outcome, uint256 amount) view returns (uint256)"
  ),
  parseAbiItem("function nextMatchId() view returns (uint256)"),
  parseAbiItem("function minStake() view returns (uint256)"),
  parseAbiItem("function maxStake() view returns (uint256)"),

  // Write functions
  parseAbiItem(
    "function createMatch(string homeTeam, string awayTeam, string competition, uint256 kickoffTime) returns (uint256)"
  ),
  parseAbiItem("function placeBet(uint256 matchId, uint8 prediction) payable"),
  parseAbiItem("function closeBetting(uint256 matchId)"),
  parseAbiItem("function resolveMatch(uint256 matchId, uint8 result)"),
  parseAbiItem("function cancelMatch(uint256 matchId, string reason)"),
  parseAbiItem("function claimWinnings(uint256 matchId)"),
  parseAbiItem("function claimRefund(uint256 matchId)"),

  // Events
  parseAbiItem(
    "event MatchCreated(uint256 indexed matchId, string homeTeam, string awayTeam, string competition, uint256 kickoffTime)"
  ),
  parseAbiItem(
    "event BetPlaced(uint256 indexed matchId, address indexed bettor, uint8 prediction, uint256 amount, uint256 newPoolTotal)"
  ),
  parseAbiItem("event BettingClosed(uint256 indexed matchId)"),
  parseAbiItem(
    "event MatchResolved(uint256 indexed matchId, uint8 result, uint256 totalPool, uint256 winnerPool, uint256 platformFee)"
  ),
  parseAbiItem("event MatchCancelled(uint256 indexed matchId, string reason)"),
  parseAbiItem(
    "event WinningsClaimed(uint256 indexed matchId, address indexed bettor, uint256 amount, uint256 profit)"
  ),
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
    return this.contractAddress.toLowerCase() !== placeholderAddress.toLowerCase();
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

  // ==================== WRITE FUNCTIONS ====================

  /**
   * Create a new match on-chain
   */
  async createMatch(
    homeTeam: string,
    awayTeam: string,
    competition: string,
    kickoffTime: number
  ): Promise<{ matchId: number; txHash: string } | null> {
    try {
      console.log(`Creating match: ${homeTeam} vs ${awayTeam}`);

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

      // Parse the MatchCreated event to get the match ID
      const matchCreatedEvent = receipt.logs.find((log) => {
        try {
          const topics = log.topics;
          // MatchCreated event signature
          return (
            topics[0] === "0x..." // You'll need to add the actual event signature hash
          );
        } catch {
          return false;
        }
      });

      if (matchCreatedEvent && matchCreatedEvent.topics[1]) {
        // First indexed parameter is matchId
        const matchId = Number(BigInt(matchCreatedEvent.topics[1]));
        console.log(`Match created with ID: ${matchId}`);
        return { matchId, txHash: hash };
      }

      // Fallback: get the next match ID - 1
      const nextId = await this.getNextMatchId();
      return { matchId: nextId - 1, txHash: hash };
    } catch (error) {
      console.error(`Failed to create match on-chain`, error);
      return null;
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
   * Get contract address
   */
  getContractAddress(): string {
    return config.contract.address;
  }
}

// Export class - will be instantiated with bot instance in index.ts
export { ContractService };
export default ContractService;
