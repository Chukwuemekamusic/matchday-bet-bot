import { makeTownsBot, getSmartAccountFromUserId } from "@towns-protocol/bot";
import { hexToBytes } from "viem";
import commands from "./commands";
import { db } from "./db";
import { ContractService, CONTRACT_ABI } from "./services/contract";
import { footballApi, FootballAPIService } from "./services/footballApi";
import { subgraphService } from "./services/subgraph";
import { MatchOperationsService } from "./services/matchOperations";
import { matchLookup } from "./services/matchLookup";
import {
  formatEth,
  parseEth,
  truncateAddress,
  isBettingOpen,
  formatOutcome,
} from "./utils/format";
import { DBMatch, ContractBet } from "./types";
import { config } from "./config";
import { startScheduler } from "./scheduler";
import { getLinkedWallets } from "./utils/wallet";
import { getThreadMessageOpts } from "./utils/threadRouter";
import { retryWithBackoff } from "./utils/retry";
import {
  handleHelp,
  createBetHandler,
  handlePending,
  handleCancel,
  handleMatches,
  createOddsHandler,
  createMyBetsHandler,
  createClaimHandler,
  createClaimableHandler,
  createClaimAllHandler,
  createStatsHandler,
  handleLeaderboard,
  type HandlerContext,
} from "./handlers";

const bot = await makeTownsBot(
  process.env.APP_PRIVATE_DATA!,
  process.env.JWT_SECRET!,
  {
    commands,
  }
);

// Log SDK version info for debugging
console.log("📦 SDK Information:");
console.log("  - @towns-protocol/bot: 0.0.453");
console.log("  - viem:", "2.29.3");
console.log("  - Bot initialized successfully");

// Initialize services with bot instance
const contractService = new ContractService(bot);
const matchOps = new MatchOperationsService(contractService);

// Create handler context for dependency injection
const handlerContext: HandlerContext = {
  bot,
  contractService,
  matchOps,
  subgraphService,
};

// ==================== BOT HANDLERS ====================

// /help - Show available commands
bot.onSlashCommand("help", handleHelp);

// /matches - Show today's matches
bot.onSlashCommand("matches", handleMatches);

// /odds - Show odds for a match
bot.onSlashCommand("odds", createOddsHandler(handlerContext));

// /bet - Place a bet (step 1: create pending bet)
bot.onSlashCommand("bet", createBetHandler(handlerContext));

// /pending - Check pending bet status
bot.onSlashCommand("pending", handlePending);

// /cancel - Cancel pending bet
bot.onSlashCommand("cancel", handleCancel);

// /mybets - Show user's bets
bot.onSlashCommand("mybets", createMyBetsHandler(handlerContext));

// /verify - Verify and sync bets with on-chain state
bot.onSlashCommand(
  "verify",
  async (handler, { channelId, userId, eventId, threadId }) => {
    const opts = getThreadMessageOpts(threadId, eventId);

    try {
      console.log(`[/verify] Starting verification for user ${userId}`);

      // Check if contract is available
      if (!contractService.isContractAvailable()) {
        await handler.sendMessage(
          channelId,
          "❌ Smart contract is not yet deployed. Verification unavailable.",
          opts
        );
        return;
      }

      // Send initial message
      await handler.sendMessage(
        channelId,
        "🔍 **Verifying Your Bets...**\n\nChecking on-chain state, please wait...",
        opts
      );

      // Get user's smart account address
      const walletAddress = await getSmartAccountFromUserId(bot, {
        userId: userId as `0x${string}`,
      });

      if (!walletAddress) {
        await handler.sendMessage(
          channelId,
          "❌ Couldn't retrieve your wallet address. Please try again.",
          opts
        );
        return;
      }

      console.log(`[/verify] User wallet: ${walletAddress}`);

      // Get recent matches (last 7 days) plus today's matches
      const recentMatches = db.getRecentMatches(7);
      const todaysMatches = db.getTodaysMatches();

      // Combine and deduplicate
      const allMatches = new Map<number, DBMatch>();
      [...recentMatches, ...todaysMatches].forEach((match) => {
        if (match.on_chain_match_id !== null) {
          allMatches.set(match.on_chain_match_id, match);
        }
      });

      if (allMatches.size === 0) {
        await handler.sendMessage(
          channelId,
          "📭 **No Matches Found**\n\nNo on-chain matches available to verify.",
          opts
        );
        return;
      }

      console.log(`[/verify] Checking ${allMatches.size} on-chain matches`);

      // Batch check all matches for user's bets (single RPC call!)
      const onChainMatchIds = Array.from(allMatches.keys());
      const batchResults = await contractService.getBatchUserBets(
        onChainMatchIds,
        walletAddress
      );

      // Analyze results
      const foundBets: Array<{
        match: DBMatch;
        bet: ContractBet;
        inDB: boolean;
        recovered: boolean;
      }> = [];

      for (const { matchId: onChainMatchId, bet } of batchResults) {
        if (!bet || bet.amount === 0n) continue; // No bet on this match

        const match = allMatches.get(onChainMatchId);
        if (!match) continue;

        // Check if bet exists in DB
        const inDB = db.hasBet(userId, match.id);

        if (!inDB) {
          // BET FOUND ON-CHAIN BUT NOT IN DB - RECOVER IT!
          console.log(
            `[/verify] 🔄 Recovering bet: Match ${match.id}, Amount: ${bet.amount}`
          );

          try {
            // Create the bet record in DB
            // Store amount as wei string (not decimal) so formatEth works correctly
            const amountWeiString = bet.amount.toString(); // e.g., "10000000000000000"
            const amountEthString = formatEth(bet.amount); // e.g., "0.01" for display/stats

            db.createBet(
              userId,
              walletAddress,
              match.id,
              match.on_chain_match_id!,
              bet.prediction,
              amountWeiString, // Store wei string in DB
              "" // No tx hash available for recovered bets
            );

            // Update user stats (uses decimal for stats tracking)
            db.recordBet(userId, amountEthString);

            foundBets.push({ match, bet, inDB: false, recovered: true });
            console.log(`[/verify] ✅ Bet recovered for match ${match.id}`);
          } catch (error) {
            console.error(
              `[/verify] Failed to recover bet for match ${match.id}:`,
              error
            );
          }
        } else {
          foundBets.push({ match, bet, inDB: true, recovered: false });
        }
      }

      // Build response message
      let message = "✅ **Verification Complete!**\n\n";

      if (foundBets.length === 0) {
        message += "📭 No on-chain bets found for recent matches.\n\n";
        message +=
          "If you just placed a bet, please wait a moment and try again.";
      } else {
        const recoveredCount = foundBets.filter((b) => b.recovered).length;
        const syncedCount = foundBets.filter((b) => !b.recovered).length;

        message += `**Summary:**\n`;
        message += `├ Total on-chain bets: ${foundBets.length}\n`;
        message += `├ Already synced: ${syncedCount}\n`;
        message += `└ Recovered: ${recoveredCount}\n\n`;

        if (recoveredCount > 0) {
          message += `🔄 **Recovered Bets:**\n\n`;

          for (const { match, bet, recovered } of foundBets) {
            if (recovered) {
              const matchCode =
                match.match_code || `#${match.daily_id || match.id}`;
              message += `• **${match.home_team} vs ${match.away_team}** (${matchCode})\n`;
              message += `  ├ Your Pick: ${formatOutcome(bet.prediction)}\n`;
              message += `  └ Stake: ${formatEth(bet.amount)} ETH\n\n`;
            }
          }

          message += `✅ Database has been updated!\n\n`;
        }

        message += `💡 **Next Steps:**\n`;
        message += `• Use \`/mybets\` to view all your bets\n`;
        message += `• Use \`/claimable\` to see winnings\n`;
      }

      // Check for pending bets
      const pendingBet = db.getPendingBet(userId);
      if (pendingBet) {
        message += `\n⏳ **Pending Bet Detected:**\n`;
        message += `You have an unconfirmed bet waiting.\n`;
        message += `• Match ID: ${pendingBet.match_id}\n`;
        message += `• Amount: ${pendingBet.amount} ETH\n\n`;
        message += `If your transaction succeeded, the bet should now be synced.\n`;
        message += `Run \`/mybets\` to check.`;
      }

      await handler.sendMessage(channelId, message, opts);
      console.log(`[/verify] Verification complete for ${userId}`);
    } catch (error) {
      console.error("[/verify] Error during verification:", error);
      await handler.sendMessage(
        channelId,
        "❌ **Verification Failed**\n\nAn error occurred while verifying your bets. Please try again or contact support.",
        opts
      );
    }
  }
);

// /claim_refund - Claim refund from a cancelled match
bot.onSlashCommand(
  "claim_refund",
  async (handler, { channelId, args, userId, eventId, threadId }) => {
    const opts = getThreadMessageOpts(threadId, eventId);

    try {
      // Check if contract is available
      if (!contractService.isContractAvailable()) {
        await handler.sendMessage(
          channelId,
          "❌ Smart contract is not yet deployed. Please contact the admin.",
          opts
        );
        return;
      }

      // Validate args
      if (args.length < 1) {
        await handler.sendMessage(
          channelId,
          `❌ **Invalid Usage**

**Usage:** \`/claim_refund <match #>\` or \`/claim_refund <match code>\`

**Examples:**
  • \`/claim_refund 1\` — Match #1 from today
  • \`/claim_refund 20260108-2\` — Match using match code

Use \`/matches\` to see today's match numbers or \`/mybets\` to see match codes.`,
          opts
        );
        return;
      }

      const input = args[0];
      let match: DBMatch | undefined;

      // Check if input is a match code (contains dash) or just a number
      if (input.includes("-")) {
        // Full match code provided (e.g., 20260108-2)
        match = db.getMatchByMatchCode(input);

        if (!match) {
          await handler.sendMessage(
            channelId,
            `❌ Match \`${input}\` not found.\n\nUse \`/matches\` to see available matches.`,
            opts
          );
          return;
        }
      } else {
        // Just a number - try as today's match
        const matchNum = parseInt(input);

        if (isNaN(matchNum) || matchNum < 1) {
          await handler.sendMessage(
            channelId,
            "❌ Invalid match number. Use `/matches` to see available matches.",
            opts
          );
          return;
        }

        // Try to find today's match with this daily_id
        match = db.getMatchByDailyId(matchNum);

        if (!match) {
          // Generate today's match code hint
          const today = new Date();
          const year = today.getUTCFullYear();
          const month = String(today.getUTCMonth() + 1).padStart(2, "0");
          const day = String(today.getUTCDate()).padStart(2, "0");
          const todayCode = `${year}${month}${day}-${matchNum}`;

          await handler.sendMessage(
            channelId,
            `❌ Match #${matchNum} not found for today.\n\n**Looking for an older match?**\nTry: \`/claim_refund ${todayCode}\` for match #${matchNum} from another day\n\nOr use \`/mybets\` to see your bets with match codes.`,
            opts
          );
          return;
        }
      }

      // Check if match is on-chain
      if (!match.on_chain_match_id) {
        await handler.sendMessage(
          channelId,
          `❌ This match hasn't been created on-chain yet. No bets have been placed.`,
          opts
        );
        return;
      }

      // Try to auto-cancel if match is postponed from a past date
      match = await matchOps.tryAutoCancelMatch(match);

      // Get wallet address first (needed for eligibility check)
      const walletAddress = await getSmartAccountFromUserId(bot, {
        userId: userId as `0x${string}`,
      });

      if (!walletAddress) {
        await handler.sendMessage(
          channelId,
          `❌ Couldn't retrieve your wallet address. Please try again or contact support.`,
          opts
        );
        return;
      }

      // Check refund eligibility on-chain
      const eligibility = await contractService.isRefundEligible(
        match.on_chain_match_id!,
        walletAddress
      );

      if (!eligibility.eligible) {
        const matchCode = match.match_code || `#${match.daily_id || match.id}`;
        let message = `❌ **Not Eligible for Refund**

**Match (${matchCode}):** ${match.home_team} vs ${match.away_team}
**Status:** ${match.status}

`;

        // Add specific reason
        if (eligibility.reason) {
          if (eligibility.reason.includes("Use /claim")) {
            message += `${eligibility.reason}`;
          } else if (eligibility.reason === "Already claimed") {
            message += `You've already claimed your refund for this match.`;
          } else if (eligibility.reason === "No bet found") {
            message += `You didn't place a bet on this match.`;
          } else if (eligibility.reason === "Match resolved - you lost") {
            message += `This match has been resolved and you didn't win. Only cancelled matches are eligible for refunds via this command.`;
          } else {
            message += `Reason: ${eligibility.reason}`;
          }
        }

        await handler.sendMessage(channelId, message, opts);
        return;
      }

      // Get on-chain bet for amount
      const onChainBet = await contractService.getUserBet(
        match.on_chain_match_id!,
        walletAddress
      );

      if (!onChainBet || onChainBet.amount === 0n) {
        await handler.sendMessage(
          channelId,
          `❌ Couldn't find your bet on-chain. Please contact support.

Wallet: ${truncateAddress(walletAddress)}`,
          opts
        );
        return;
      }

      // Create interaction for claiming refund (encode threadId for later retrieval)
      const interactionId = `claim_refund-${match.id}-${userId.slice(
        0,
        8
      )}-${eventId}`;
      const refundAmount = BigInt(onChainBet.amount);

      // Determine status display and reason
      let statusDisplay = match.status;
      let reasonText = "You can claim a full refund of your stake.";

      if (eligibility.reason === "Match cancelled") {
        statusDisplay = "CANCELLED ❌";
        reasonText =
          "This match was cancelled. You can claim a full refund of your stake.";
      }
      // Note: "No winners" case is now handled by /claim (claimWinnings), not /claim_refund
      // isRefundEligible() returns eligible=false for that case

      const message = `💸 **Claim Your Refund**

**Match:** ${match.home_team} vs ${match.away_team}
**Status:** ${statusDisplay}
**Your Stake:** ${formatEth(refundAmount)} ETH
**Refund Amount:** ${formatEth(refundAmount)} ETH

${reasonText}

Ready to claim your refund?`;

      // Send interactive message with buttons (with retry for network errors)
      await retryWithBackoff(
        async () => {
          await handler.sendInteractionRequest(
            channelId,
            {
              case: "form",
              value: {
                id: interactionId,
                title: "Claim Refund",
                content: message,
                components: [
                  {
                    id: "refund-confirm",
                    component: {
                      case: "button",
                      value: {
                        label: "Claim Refund",
                        style: 1, // PRIMARY style
                      },
                    },
                  },
                  {
                    id: "refund-cancel",
                    component: {
                      case: "button",
                      value: {
                        label: "Cancel",
                        style: 2, // SECONDARY style
                      },
                    },
                  },
                ],
              },
            } as any,
            hexToBytes(userId as `0x${string}`),
            opts // threading options
          );
        },
        3, // max retries
        1000 // base delay (1s)
      );
    } catch (error) {
      console.error("Error in /claim_refund command:", error);

      // Check if it's a network error that failed after retries
      const isNetworkError =
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error.code === 9 || error.code === 14 || error.code === 4);

      const errorMessage = isNetworkError
        ? "❌ Network error - Towns Protocol nodes are experiencing issues. Please try again in a few moments."
        : "❌ An error occurred while processing your refund claim. Please try again or contact support.";

      await handler.sendMessage(channelId, errorMessage, opts);
    }
  }
);

// /claimable - List all unclaimed winnings
bot.onSlashCommand("claimable", createClaimableHandler(handlerContext));

// /claim_all - Claim all unclaimed winnings
bot.onSlashCommand("claim_all", createClaimAllHandler(handlerContext));

// /stats - Show user stats
bot.onSlashCommand("stats", createStatsHandler(handlerContext));

// /leaderboard - Show top bettors
bot.onSlashCommand("leaderboard", handleLeaderboard);

// /claim - Claim winnings from a specific match
bot.onSlashCommand("claim", createClaimHandler(handlerContext));

// /winners - Show winning bettors for a specific match
bot.onSlashCommand("winners", async (handler, { channelId, args }) => {
  try {
    // Validate arguments
    if (args.length !== 1) {
      await handler.sendMessage(
        channelId,
        `❌ **Invalid Usage**

**Usage:** \`/winners <match#|match_code>\`

**Examples:**
  \`/winners 1\` (today's match #1)
  \`/winners 20260110-4\` (specific match by code)

Use \`/matches\` to see today's match numbers.`
      );
      return;
    }

    const input = args[0];
    let match: DBMatch | undefined;

    // Check if input is a match code (contains dash) or just a number
    if (input.includes("-")) {
      // Full match code provided (e.g., 20260110-4)
      match = db.getMatchByMatchCode(input);

      if (!match) {
        await handler.sendMessage(
          channelId,
          `❌ Match \`${input}\` not found. Use \`/matches\` to see available matches.`
        );
        return;
      }
    } else {
      // Just a number - try as today's match
      const matchNum = parseInt(input);

      if (isNaN(matchNum) || matchNum < 1) {
        await handler.sendMessage(
          channelId,
          "❌ Invalid match number. Use `/matches` to see available matches."
        );
        return;
      }

      // Try to find today's match with this daily_id
      match = db.getMatchByDailyId(matchNum);

      if (!match) {
        // Generate today's match code hint
        const today = new Date();
        const year = today.getUTCFullYear();
        const month = String(today.getUTCMonth() + 1).padStart(2, "0");
        const day = String(today.getUTCDate()).padStart(2, "0");
        const todayCode = `${year}${month}${day}-${matchNum}`;

        await handler.sendMessage(
          channelId,
          `❌ Match #${matchNum} not found for today.

**Looking for an older match?**
Try: \`/winners ${todayCode}\` for match #${matchNum} from another day

Use \`/matches\` to see today's matches.`
        );
        return;
      }
    }

    // Check if match is finished
    if (match.status !== "FINISHED") {
      await handler.sendMessage(
        channelId,
        `❌ **Match Not Finished**

This match hasn't finished yet. Current status: ${match.status}

Winners will be available once the match is resolved.`
      );
      return;
    }

    // Check if match has result
    if (match.result === null) {
      await handler.sendMessage(
        channelId,
        `❌ **Match Not Resolved**

This match is finished but hasn't been resolved yet. Use \`/resolve ${
          match.match_code || match.daily_id
        }\` to resolve it (admin only).`
      );
      return;
    }

    // Check if match has on-chain ID
    if (!match.on_chain_match_id) {
      await handler.sendMessage(
        channelId,
        `ℹ️ **No Bets Placed**

No bets were placed on this match (not created on-chain).`
      );
      return;
    }

    // Get all bets for this match
    const allBets = db.getBetsForMatch(match.id);

    if (allBets.length === 0) {
      await handler.sendMessage(
        channelId,
        `ℹ️ **No Bets Placed**

No bets were placed on this match.`
      );
      return;
    }

    // Separate winners and losers
    const winners: typeof allBets = [];
    const losers: { [key: number]: number } = { 1: 0, 2: 0, 3: 0 }; // HOME, DRAW, AWAY

    for (const bet of allBets) {
      if (bet.prediction === match.result) {
        winners.push(bet);
      } else {
        losers[bet.prediction] = (losers[bet.prediction] || 0) + 1;
      }
    }

    // Sort winners by bet amount (highest first)
    winners.sort((a, b) => {
      const amountA = BigInt(a.amount);
      const amountB = BigInt(b.amount);
      return amountA > amountB ? -1 : amountA < amountB ? 1 : 0;
    });

    // Build message
    const matchCode = match.match_code || `#${match.daily_id || match.id}`;
    const score =
      match.home_score !== null && match.away_score !== null
        ? `${match.home_score}-${match.away_score}`
        : "";

    let message = `🏆 **Match Winners**\n\n`;
    message += `⚽ **${match.home_team} ${score} ${match.away_team}** (${matchCode})\n`;
    message += `**Result:** ${formatOutcome(match.result)}\n\n`;

    if (winners.length === 0) {
      message += `ℹ️ **No Winners**\n\n`;
      message += `All bettors lost this match. Pool will be redistributed or handled according to contract rules.\n\n`;
    } else {
      message += `💰 **Winning Bettors (${formatOutcome(match.result)}):**\n\n`;

      // Fetch payouts for all winners
      for (let i = 0; i < winners.length; i++) {
        const bet = winners[i];
        const betAmount = BigInt(bet.amount);
        const payout = await contractService.calculatePotentialWinnings(
          match.on_chain_match_id,
          bet.prediction,
          betAmount
        );

        const addressDisplay = truncateAddress(bet.wallet_address);
        const betEth = formatEth(betAmount);
        const payoutEth = payout ? formatEth(payout) : "?";
        const claimedIcon = bet.claimed ? "✅ Claimed" : "⏳ Unclaimed";

        message += `${
          i + 1
        }. ${addressDisplay} - Bet: ${betEth} ETH → Payout: ${payoutEth} ETH ${claimedIcon}\n`;
      }
      message += "\n";
    }

    // Add summary stats
    message += `📊 **Summary:**\n`;
    message += `• Total Winners: ${winners.length} (${formatOutcome(
      match.result
    )})\n`;

    const loserCount = (losers[1] || 0) + (losers[2] || 0) + (losers[3] || 0);
    if (loserCount > 0) {
      const loserBreakdown: string[] = [];
      if (losers[1] > 0) loserBreakdown.push(`Home: ${losers[1]}`);
      if (losers[2] > 0) loserBreakdown.push(`Draw: ${losers[2]}`);
      if (losers[3] > 0) loserBreakdown.push(`Away: ${losers[3]}`);
      message += `• Total Losers: ${loserCount} (${loserBreakdown.join(
        ", "
      )})\n`;
    }

    message += `• Total Pool: ${formatEth(match.total_pool)} ETH`;

    await handler.sendMessage(channelId, message);
  } catch (error) {
    console.error("Error in /winners command:", error);
    await handler.sendMessage(
      channelId,
      `❌ **Error**

An error occurred while fetching match winners. Please try again.

**Error:** ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
});

// /migrate - Temporary command to migrate existing on-chain bets to DB
bot.onSlashCommand("migrate", async (handler, { channelId, userId }) => {
  if (!contractService.isContractAvailable()) {
    await handler.sendMessage(
      channelId,
      "❌ Contract not available. Cannot migrate bets."
    );
    return;
  }

  await handler.sendMessage(
    channelId,
    "🔄 Starting bet migration from blockchain to database...\n\nThis may take a moment..."
  );

  try {
    console.log(`[/migrate] Starting migration for user ${userId}`);

    // Get all user's linked wallets
    const linkedWallets = await getLinkedWallets(bot, userId as `0x${string}`);
    console.log(
      `[/migrate] Found ${linkedWallets.length} linked wallet(s) for ${userId}`
    );

    if (linkedWallets.length === 0) {
      await handler.sendMessage(
        channelId,
        "❌ No linked wallets found for your account."
      );
      return;
    }

    // Get all matches with on-chain IDs (not just today's)
    const onChainMatches = db.getAllOnChainMatches();

    console.log(
      `[/migrate] Found ${onChainMatches.length} matches with on-chain IDs`
    );

    let migratedCount = 0;
    let skippedCount = 0;
    let duplicateCount = 0;
    const duplicateMatches: string[] = [];

    // Check each match for bets from any linked wallet
    for (const match of onChainMatches) {
      if (!match.on_chain_match_id) continue;

      // Check if user already has this match in DB
      const existingBet = db.getUserBetOnMatch(userId, match.id);
      if (existingBet) {
        console.log(
          `[/migrate] Skipping match ${match.id} - already in DB for ${userId}`
        );
        skippedCount++;
        continue;
      }

      // Check each wallet for a bet on this match
      let foundBets: Array<{ wallet: string; bet: any }> = [];

      for (const wallet of linkedWallets) {
        try {
          const bet = await contractService.getUserBet(
            match.on_chain_match_id,
            wallet
          );

          if (bet && bet.amount > 0n) {
            foundBets.push({ wallet, bet });
            console.log(
              `[/migrate] Found bet on match ${
                match.id
              } from wallet ${truncateAddress(wallet)}: ${formatEth(
                bet.amount
              )} ETH`
            );
          }
        } catch (error) {
          console.error(
            `[/migrate] Error checking wallet ${wallet} for match ${match.on_chain_match_id}:`,
            error
          );
        }
      }

      // Handle the bets found
      if (foundBets.length === 0) {
        // No bets found for this match
        continue;
      } else if (foundBets.length === 1) {
        // Single bet - migrate it
        const { wallet, bet } = foundBets[0];
        try {
          db.createBet(
            userId,
            wallet,
            match.id,
            match.on_chain_match_id,
            bet.prediction,
            bet.amount.toString(),
            "0x0" // No tx hash available for historical bets
          );
          migratedCount++;
          console.log(
            `[/migrate] ✅ Migrated bet for match ${
              match.id
            } from wallet ${truncateAddress(wallet)}`
          );
        } catch (error) {
          console.error(
            `[/migrate] Failed to insert bet for match ${match.id}:`,
            error
          );
          skippedCount++;
        }
      } else {
        // Multiple bets found (duplicate situation!)
        duplicateCount++;
        duplicateMatches.push(
          `${match.home_team} vs ${match.away_team} (${foundBets.length} bets)`
        );
        console.warn(
          `[/migrate] ⚠️ Found ${foundBets.length} bets for match ${match.id} - keeping largest`
        );

        // Keep the bet with the largest amount
        const largestBet = foundBets.reduce((prev, current) =>
          current.bet.amount > prev.bet.amount ? current : prev
        );

        try {
          db.createBet(
            userId,
            largestBet.wallet,
            match.id,
            match.on_chain_match_id,
            largestBet.bet.prediction,
            largestBet.bet.amount.toString(),
            "0x0"
          );
          migratedCount++;
          console.log(
            `[/migrate] ✅ Migrated largest bet (${formatEth(
              largestBet.bet.amount
            )} ETH) from ${truncateAddress(largestBet.wallet)}`
          );
        } catch (error) {
          console.error(
            `[/migrate] Failed to insert largest bet for match ${match.id}:`,
            error
          );
          skippedCount++;
        }
      }
    }

    // Build result message
    let resultMessage = `✅ **Migration Complete!**\n\n`;
    resultMessage += `📊 **Summary:**\n`;
    resultMessage += `• Migrated: ${migratedCount} bet${
      migratedCount !== 1 ? "s" : ""
    }\n`;
    resultMessage += `• Skipped (already in DB): ${skippedCount}\n`;

    if (duplicateCount > 0) {
      resultMessage += `• ⚠️ Duplicates found: ${duplicateCount}\n\n`;
      resultMessage += `**Note:** You had multiple bets on the same match from different wallets. I kept the largest bet for each match:\n`;
      for (const match of duplicateMatches) {
        resultMessage += `• ${match}\n`;
      }
      resultMessage += `\nGoing forward, you can only place one bet per match (with any wallet).`;
    }

    resultMessage += `\n\nUse \`/mybets\` to view your migrated bets!`;

    await handler.sendMessage(channelId, resultMessage);
    console.log(
      `[/migrate] Migration completed for ${userId}: ${migratedCount} migrated, ${skippedCount} skipped, ${duplicateCount} duplicates handled`
    );
  } catch (error) {
    console.error(`[/migrate] Migration failed for ${userId}:`, error);
    await handler.sendMessage(
      channelId,
      `❌ **Migration Failed**\n\nAn error occurred during migration. Please try again or contact support.\n\nError: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
});

// /fetch - Admin command to manually fetch matches
bot.onSlashCommand("fetch", async (handler, { channelId }) => {
  try {
    const matches = await footballApi.getTodaysMatches();

    let newCount = 0;
    let skippedCount = 0;

    for (const match of matches) {
      const dbMatch = FootballAPIService.toDBMatch(match);

      // Skip if toDBMatch returned null (invalid data)
      if (!dbMatch) {
        console.warn(`⚠️ Skipping match with invalid data in /fetch:`, {
          id: match?.id,
          homeTeam: match?.homeTeam?.name,
          awayTeam: match?.awayTeam?.name,
        });
        skippedCount++;
        continue;
      }

      // At this point, we know dbMatch is valid and has api_match_id
      const existing = db.getMatchByApiId(dbMatch.api_match_id);

      // Only pass fields that upsertMatch expects (matching SQL parameters)
      db.upsertMatch({
        api_match_id: dbMatch.api_match_id,
        home_team: dbMatch.home_team,
        away_team: dbMatch.away_team,
        competition: dbMatch.competition,
        competition_code: dbMatch.competition_code,
        kickoff_time: dbMatch.kickoff_time,
        status: dbMatch.status,
        home_score: dbMatch.home_score,
        away_score: dbMatch.away_score,
      });

      if (!existing) newCount++;
    }

    await handler.sendMessage(
      channelId,
      `✅ Fetched ${matches.length} matches (${newCount} new${
        skippedCount > 0 ? `, ${skippedCount} skipped` : ""
      })`
    );
  } catch (error) {
    await handler.sendMessage(
      channelId,
      "❌ Failed to fetch matches. Check API configuration."
    );
  }
});

// ==================== INTERACTION HANDLERS ====================

// Handle button clicks and form submissions
bot.onInteractionResponse(async (handler, event) => {
  const { response, channelId, userId } = event;

  console.log("🔔 [INTERACTION] Received interaction response");
  console.log("  - userId:", userId);
  console.log("  - channelId:", channelId);
  console.log(
    "  - response.payload.content?.case:",
    response.payload.content?.case
  );

  // Handle form interactions (buttons)
  if (response.payload.content?.case === "form") {
    const form = response.payload.content.value;
    const requestId = form.requestId;

    console.log("📋 [INTERACTION] Form interaction detected");
    console.log("  - requestId:", requestId);
    console.log("  - form.components.length:", form.components.length);

    // Check if this is a claim interaction (starts with "claim-" or "claim_refund-")
    // Claim interactions are NOT stored in pending_bets, so skip that check
    const isClaimInteraction =
      requestId.startsWith("claim-") || requestId.startsWith("claim_refund-");

    console.log("  - isClaimInteraction:", isClaimInteraction);

    // Retrieve threadId for threading responses (before checking pending bet)
    let threadId: string | undefined;
    let pendingBet = null;

    // Only check pending_bets for bet confirmations (not claims)
    if (!isClaimInteraction) {
      // Find the pending bet for this interaction
      pendingBet = db.getPendingBetByInteractionId(requestId);

      // Get threadId from pending bet (if it exists)
      if (pendingBet) {
        threadId = pendingBet.thread_id;
      }
    } else {
      // For claim/claim_refund interactions, parse threadId from requestId
      // Format: "claim-{matchId}-{userIdPrefix}-{threadId}" or "claim_refund-{matchId}-{userIdPrefix}-{threadId}"
      const parts = requestId.split("-");
      if (parts.length >= 4) {
        threadId = parts[parts.length - 1]; // Last part is threadId
      }
    }

    // Create threading opts (BEFORE any sendMessage calls)
    const opts = threadId ? { threadId } : undefined;

    // Now check if pending bet exists (for non-claim interactions)
    if (!isClaimInteraction && !pendingBet) {
      await handler.sendMessage(
        channelId,
        "❌ Bet expired or already processed. Please place a new bet with `/bet`.",
        opts
      );
      return;
    }

    // Find which button was clicked
    console.log("🔍 [INTERACTION] Checking which button was clicked...");
    for (const component of form.components) {
      console.log("  - component.id:", component.id);
      console.log("  - component.component.case:", component.component.case);

      if (component.component.case === "button") {
        // Handle confirm button
        if (component.id === "confirm") {
          console.log(
            "✅ [INTERACTION] 'confirm' button clicked (bet confirmation)"
          );

          // Confirm button should only be for bet confirmations, not claims
          if (!pendingBet) {
            await handler.sendMessage(
              channelId,
              "❌ Bet expired or already processed. Please place a new bet with `/bet`.",
              opts
            );
            return;
          }

          // Get the match
          const match = db.getMatchById(pendingBet.match_id);
          if (!match) {
            db.clearPendingBet(userId);
            await handler.sendMessage(
              channelId,
              "❌ Match no longer available.",
              opts
            );
            return;
          }

          // Check if betting is still open
          if (!isBettingOpen(match.kickoff_time)) {
            db.clearPendingBet(userId);
            await handler.sendMessage(
              channelId,
              "❌ Betting is now closed for this match.",
              opts
            );
            return;
          }

          // Check if contract is available
          if (!contractService.isContractAvailable()) {
            db.clearPendingBet(userId);
            await handler.sendMessage(
              channelId,
              "❌ Smart contract is not yet deployed. Please try again once the contract is live.",
              opts
            );
            return;
          }

          // Create match on-chain if not exists
          let onChainMatchId = match.on_chain_match_id;
          if (!onChainMatchId) {
            console.log(
              `📝 Match not yet on-chain. Creating match: ${match.home_team} vs ${match.away_team}`
            );

            const result = await contractService.createMatch(
              match.home_team,
              match.away_team,
              match.competition,
              match.kickoff_time
            );

            // Handle errors with specific messages
            if ("error" in result && result.error) {
              const errorType = result.errorType;
              const errorMsg = result.error;

              console.error(
                `❌ Match creation failed: ${errorType} - ${errorMsg}`
              );

              let userMessage = `❌ **Unable to Create Match**\n\n${errorMsg}`;

              // Add specific instructions based on error type
              if (errorType === "INSUFFICIENT_GAS") {
                userMessage += `\n\n**What to do:**\n1. Admin needs to fund the bot treasury\n2. Your pending bet is saved\n3. Try clicking "Confirm & Sign" again in a few minutes`;
              } else if (errorType === "NOT_MATCH_MANAGER") {
                userMessage += `\n\n**What to do:**\n1. Admin needs to register bot as match manager\n2. Run \`/checkmanager\` for instructions\n3. Your pending bet is saved\n4. Try clicking "Confirm & Sign" again after fixing`;
              } else if (errorType === "NONCE_ERROR") {
                userMessage += `\n\n**What to do:**\nJust wait a few seconds and click "Confirm & Sign" again.`;
              } else if (errorType === "RPC_TIMEOUT") {
                userMessage += `\n\n**What to do:**\nThe network is busy. Wait a moment and click "Confirm & Sign" again.`;
              } else {
                userMessage += `\n\n**What to do:**\n1. Check bot logs for details\n2. Your pending bet is saved\n3. Try again or contact support`;
              }

              userMessage += `\n\n_Your pending bet expires in 5 minutes. Use \`/cancel\` to cancel it._`;

              await handler.sendMessage(channelId, userMessage, opts);
              // Don't clear pending bet - user can retry
              return;
            }

            // Success - we have a match ID
            if (!result.matchId) {
              await handler.sendMessage(
                channelId,
                "❌ Match creation succeeded but no match ID returned. Please contact support.",
                opts
              );
              return;
            }

            onChainMatchId = result.matchId;
            db.setOnChainMatchId(match.id, onChainMatchId);
            console.log(
              `✅ Match ${match.id} created on-chain with ID ${onChainMatchId}, tx: ${result.txHash}`
            );

            // Notify user that match was created
            await handler.sendMessage(
              channelId,
              `✅ Match created on-chain! Now sending your bet transaction...`,
              opts
            );
          }

          // At this point, onChainMatchId must be set
          if (!onChainMatchId) {
            await handler.sendMessage(
              channelId,
              "❌ Match ID not available. Please try again.",
              opts
            );
            return;
          }

          // Generate transaction for user to sign
          const calldata = contractService.encodePlaceBet(
            onChainMatchId,
            pendingBet.prediction
          );

          const amount = parseEth(pendingBet.amount);

          // Encode threadId in transaction ID for later retrieval
          const txId = `tx-${onChainMatchId}-${userId.slice(0, 8)}-${
            threadId || "none"
          }`;

          // Send transaction request to user
          await handler.sendInteractionRequest(
            channelId,
            {
              case: "transaction",
              value: {
                id: txId,
                title: `Bet on ${match.home_team} vs ${match.away_team}`,
                content: {
                  case: "evm",
                  value: {
                    chainId: "8453", // Base mainnet
                    to: contractService.getContractAddress(),
                    value: amount.toString(),
                    data: calldata,
                  },
                },
              },
            } as any, // Type assertion for complex protobuf types
            hexToBytes(userId as `0x${string}`), // recipient
            opts // threading options
          );

          await handler.sendMessage(
            channelId,
            "✅ **Transaction Request Sent!**\n\nPlease sign the transaction in your wallet.\n\n_I'll confirm once the transaction is mined._",
            opts
          );

          // Note: Bet stats will be recorded after transaction is confirmed
          // This happens in the transaction response handler below

          return;
        }

        // Handle cancel button
        if (component.id === "cancel") {
          console.log("🚫 CANCEL BUTTON CLICKED");
          console.log("  - userId:", userId);
          console.log("  - channelId:", channelId);
          console.log("  - requestId:", requestId);

          // Get pending bet BEFORE clearing (for logging)
          const pendingBetToCancel = db.getPendingBet(userId);
          console.log(
            "  - Pending bet before clear:",
            pendingBetToCancel
              ? `match ${pendingBetToCancel.match_id}, ${pendingBetToCancel.amount} ETH`
              : "NONE FOUND"
          );

          db.clearPendingBet(userId);

          // Verify it's actually cleared
          const checkCleared = db.getPendingBet(userId);
          console.log(
            "  - Pending bet after clear:",
            checkCleared ? "❌ STILL EXISTS!" : "✅ Successfully cleared"
          );

          await handler.sendMessage(channelId, "✅ Bet cancelled.", opts);

          console.log(
            "  - Cancel complete, user should be able to place new bet"
          );
          return;
        }

        // Handle claim confirm button
        if (component.id === "claim-confirm") {
          console.log("🔍 [CLAIM-CONFIRM] Button clicked");
          console.log("  - requestId:", requestId);
          console.log("  - userId:", userId);
          console.log("  - channelId:", channelId);
          console.log("  - threadId:", threadId);

          // Parse match ID from interaction ID (format: claim-{matchId}-{userIdPrefix}-{threadId})
          const parts = requestId.split("-");
          console.log("  - parts after split:", parts);
          console.log("  - parts.length:", parts.length);
          console.log("  - parts[0]:", parts[0]);

          if (parts.length < 2 || parts[0] !== "claim") {
            console.log("❌ [CLAIM-CONFIRM] Invalid requestId format");
            await handler.sendMessage(
              channelId,
              "❌ Invalid claim request. Please try again with `/claim`.",
              opts
            );
            return;
          }

          const matchId = parseInt(parts[1]);
          console.log("  - matchId:", matchId);

          const match = db.getMatchById(matchId);
          console.log(
            "  - match found:",
            match ? `${match.home_team} vs ${match.away_team}` : "NULL"
          );

          if (!match) {
            console.log("❌ [CLAIM-CONFIRM] Match not found in DB");
            await handler.sendMessage(
              channelId,
              "❌ Match no longer available.",
              opts
            );
            return;
          }

          console.log("  - match.on_chain_match_id:", match.on_chain_match_id);

          if (!match.on_chain_match_id) {
            console.log("❌ [CLAIM-CONFIRM] Match has no on_chain_match_id");
            await handler.sendMessage(
              channelId,
              "❌ Match not found on-chain.",
              opts
            );
            return;
          }

          // Get user's bet
          const userBet = db.getUserBetForMatch(userId, matchId);
          console.log(
            "  - userBet found:",
            userBet
              ? `${userBet.amount} ETH, claimed: ${userBet.claimed}`
              : "NULL"
          );

          if (!userBet) {
            console.log("❌ [CLAIM-CONFIRM] User has no bet on this match");
            await handler.sendMessage(
              channelId,
              "❌ You don't have a bet on this match.",
              opts
            );
            return;
          }

          // Double-check not already claimed
          if (userBet.claimed === 1) {
            console.log("❌ [CLAIM-CONFIRM] Bet already claimed");
            await handler.sendMessage(
              channelId,
              "✅ You've already claimed winnings for this match.",
              opts
            );
            return;
          }

          console.log(
            "✅ [CLAIM-CONFIRM] All checks passed, generating transaction..."
          );

          // Generate transaction for user to sign
          const calldata = contractService.encodeClaimWinnings(
            match.on_chain_match_id
          );
          console.log("  - calldata:", calldata);

          // Encode threadId in transaction ID for later retrieval
          const txId = `claim-tx-${match.on_chain_match_id}-${userId.slice(
            0,
            8
          )}-${threadId || "none"}`;
          console.log("  - txId:", txId);

          const contractAddress = contractService.getContractAddress();
          console.log("  - contract address:", contractAddress);

          console.log("📤 [CLAIM-CONFIRM] Sending transaction request...");
          console.log("  - Using threading opts:", opts);

          try {
            // Send transaction request to user
            await handler.sendInteractionRequest(
              channelId,
              {
                case: "transaction",
                value: {
                  id: txId,
                  title: `Claim Winnings: ${match.home_team} vs ${match.away_team}`,
                  content: {
                    case: "evm",
                    value: {
                      chainId: "8453", // Base mainnet
                      to: contractAddress,
                      value: "0", // No ETH sent for claims
                      data: calldata,
                    },
                  },
                },
              } as any,
              hexToBytes(userId as `0x${string}`),
              opts // Use threading options
            );

            console.log(
              "✅ [CLAIM-CONFIRM] Transaction request sent successfully"
            );

            await handler.sendMessage(
              channelId,
              "✅ **Transaction Request Sent!**\n\nPlease sign the transaction in your wallet to claim your winnings.\n\n_I'll confirm once the transaction is mined._",
              opts
            );

            console.log("✅ [CLAIM-CONFIRM] Confirmation message sent");
          } catch (error) {
            console.error(
              "❌ [CLAIM-CONFIRM] Error sending transaction request:",
              error
            );
            console.error("  - Error details:", JSON.stringify(error, null, 2));

            await handler.sendMessage(
              channelId,
              "❌ Failed to send transaction request. Please try again or contact support.",
              opts
            );
          }

          return;
        }

        // Handle claim cancel button
        if (component.id === "claim-cancel") {
          await handler.sendMessage(channelId, "✅ Claim cancelled.", opts);
          return;
        }

        // Handle refund confirm button
        if (component.id === "refund-confirm") {
          // Parse match ID from interaction ID (format: claim_refund-{matchId}-{userIdPrefix}-{threadId})
          const parts = requestId.split("-");
          if (
            parts.length < 3 ||
            parts[0] !== "claim" ||
            parts[1] !== "refund"
          ) {
            await handler.sendMessage(
              channelId,
              "❌ Invalid refund request. Please try again with `/claim_refund`.",
              opts
            );
            return;
          }

          const matchId = parseInt(parts[2]);
          const match = db.getMatchById(matchId);

          if (!match) {
            await handler.sendMessage(
              channelId,
              "❌ Match no longer available.",
              opts
            );
            return;
          }

          if (!match.on_chain_match_id) {
            await handler.sendMessage(
              channelId,
              "❌ Match not found on-chain.",
              opts
            );
            return;
          }

          // Get wallet address for eligibility check
          const walletAddress = await getSmartAccountFromUserId(bot, {
            userId: userId as `0x${string}`,
          });

          if (!walletAddress) {
            await handler.sendMessage(
              channelId,
              "❌ Couldn't retrieve your wallet address. Please try again.",
              opts
            );
            return;
          }

          // Verify user is still eligible for refund
          const eligibility = await contractService.isRefundEligible(
            match.on_chain_match_id,
            walletAddress
          );

          if (!eligibility.eligible) {
            await handler.sendMessage(
              channelId,
              `❌ You're no longer eligible for a refund. ${
                eligibility.reason || ""
              }`,
              opts
            );
            return;
          }

          // Generate transaction for user to sign
          const calldata = contractService.encodeClaimRefund(
            match.on_chain_match_id
          );

          // Encode threadId in transaction ID for later retrieval
          const txId = `refund-tx-${match.on_chain_match_id}-${userId.slice(
            0,
            8
          )}-${threadId || "none"}`;

          // Send transaction request to user
          await handler.sendInteractionRequest(
            channelId,
            {
              case: "transaction",
              value: {
                id: txId,
                title: `Claim Refund: ${match.home_team} vs ${match.away_team}`,
                content: {
                  case: "evm",
                  value: {
                    chainId: "8453", // Base mainnet
                    to: contractService.getContractAddress(),
                    value: "0", // No ETH sent for refunds
                    data: calldata,
                  },
                },
              },
            } as any,
            hexToBytes(userId as `0x${string}`),
            opts
          );

          await handler.sendMessage(
            channelId,
            "✅ **Transaction Request Sent!**\n\nPlease sign the transaction in your wallet to claim your refund.\n\n_I'll confirm once the transaction is mined._",
            opts
          );

          return;
        }

        // Handle refund cancel button
        if (component.id === "refund-cancel") {
          await handler.sendMessage(
            channelId,
            "✅ Refund claim cancelled.",
            opts
          );
          return;
        }
      }
    }
  }

  // Handle transaction responses
  if (response.payload.content?.case === "transaction") {
    const txResponse = response.payload.content.value;

    // Parse threadId from transaction ID for threading
    // Transaction ID formats: "tx-{matchId}-{userIdPrefix}-{threadId}", "claim-tx-{matchId}-{userIdPrefix}-{threadId}", "refund-tx-{matchId}-{userIdPrefix}-{threadId}"
    let threadId: string | undefined;
    const txId = txResponse.requestId || "";
    const parts = txId.split("-");
    if (parts.length >= 4) {
      const lastPart = parts[parts.length - 1];
      if (lastPart && lastPart !== "none") {
        threadId = lastPart;
      }
    }
    const opts = threadId ? { threadId } : undefined;

    if (txResponse.txHash) {
      const txHash = txResponse.txHash;

      // Send immediate confirmation
      await handler.sendMessage(
        channelId,
        `⏳ **Transaction Submitted!**

Waiting for confirmation on Base...

🔗 [View on Basescan](https://basescan.org/tx/${txHash})`,
        opts
      );

      // Wait for transaction to be mined
      try {
        const receipt = await contractService[
          "publicClient"
        ].waitForTransactionReceipt({
          hash: txHash as `0x${string}`,
          confirmations: 1,
        });

        if (receipt.status === "success") {
          // Check if this is a claim transaction (ID format: claim-tx-{onChainMatchId}-{userId}-{timestamp})
          const txId = txResponse.requestId || "";
          const isClaimTx = txId.startsWith("claim-tx-");

          if (isClaimTx) {
            // Handle claim transaction
            const parts = txId.split("-");
            if (parts.length >= 3) {
              const onChainMatchId = parseInt(parts[2]);

              // Find the match by on-chain ID
              const match = db.getMatchByOnChainId(onChainMatchId);

              if (match) {
                // Get user's bet to calculate winnings
                const userBet = db.getUserBetForMatch(userId, match.id);

                if (userBet) {
                  // Get wallet address to check actual payout
                  const walletAddress = await getSmartAccountFromUserId(bot, {
                    userId: userId as `0x${string}`,
                  });

                  if (walletAddress) {
                    try {
                      // Parse WinningsClaimed event from transaction logs to get actual payout
                      const { decodeEventLog } = await import("viem");

                      let winnings: bigint | null = null;
                      let profit: bigint = 0n;

                      // Find and decode WinningsClaimed event from logs
                      for (const log of receipt.logs) {
                        try {
                          const decoded = decodeEventLog({
                            abi: CONTRACT_ABI,
                            data: log.data,
                            topics: log.topics,
                          });

                          if (decoded.eventName === "WinningsClaimed") {
                            winnings = decoded.args.amount as bigint;
                            profit = decoded.args.profit as bigint;
                            break;
                          }
                        } catch (e) {
                          // Skip logs that don't match our ABI
                          continue;
                        }
                      }

                      // Fallback: if event parsing failed, use bet amount as minimum
                      if (winnings === null) {
                        const betAmount = parseEth(userBet.amount);
                        winnings = betAmount; // At minimum, user got their stake back
                        profit = 0n;
                        console.warn(
                          `Could not parse WinningsClaimed event for match ${onChainMatchId}, using bet amount as fallback`
                        );
                      }

                      // Update database
                      db.updateBetClaimed(userId, match.id);

                      // Record win in user stats
                      if (winnings) {
                        db.recordWin(
                          userId,
                          formatEth(winnings),
                          formatEth(profit)
                        );
                      }

                      // Send success message
                      await handler.sendMessage(
                        channelId,
                        `💰 **Winnings Claimed!**

<@${userId}> your winnings have been claimed successfully!

**Match:** ${match.home_team} vs ${match.away_team}
**Payout:** ${winnings ? formatEth(winnings) : "Unknown"} ETH
**Profit:** ${formatEth(profit)} ETH

🔗 [Transaction](https://basescan.org/tx/${txHash})`,
                        {
                          mentions: [
                            { userId, displayName: userId.slice(0, 8) },
                          ],
                          ...(threadId && { threadId }),
                        }
                      );

                      console.log(
                        `✅ Claim confirmed for ${userId}: ${txHash}, profit: ${formatEth(
                          profit
                        )} ETH`
                      );
                    } catch (error) {
                      console.error(
                        "Error processing claim confirmation:",
                        error
                      );
                      await handler.sendMessage(
                        channelId,
                        `✅ **Claim Transaction Confirmed!**

Your winnings have been claimed. Check your wallet to see the payout.

🔗 [Transaction](https://basescan.org/tx/${txHash})`
                      );
                    }
                  } else {
                    // Fallback if wallet address not found
                    db.updateBetClaimed(userId, match.id);

                    await handler.sendMessage(
                      channelId,
                      `✅ **Claim Confirmed!**

Your claim transaction was successful!

**Match:** ${match.home_team} vs ${match.away_team}

🔗 [Transaction](https://basescan.org/tx/${txHash})`
                    );
                  }
                } else {
                  // No bet found in DB, but transaction succeeded
                  await handler.sendMessage(
                    channelId,
                    `✅ **Claim Transaction Confirmed!**

Your winnings have been claimed successfully!

🔗 [Transaction](https://basescan.org/tx/${txHash})`
                  );
                }
              } else {
                // Match not found, but transaction succeeded
                await handler.sendMessage(
                  channelId,
                  `✅ **Claim Transaction Confirmed!**

Your claim was successful! Check your wallet.

🔗 [Transaction](https://basescan.org/tx/${txHash})`
                );
              }
            }
          }

          // Check if this is a refund transaction (ID format: refund-tx-{onChainMatchId}-{userId}-{timestamp})
          const isRefundTx = txId.startsWith("refund-tx-");

          if (isRefundTx) {
            // Handle refund transaction
            const parts = txId.split("-");
            if (parts.length >= 3) {
              const onChainMatchId = parseInt(parts[2]);

              // Find the match by on-chain ID
              const match = db.getMatchByOnChainId(onChainMatchId);

              if (match) {
                // Get user's bet
                const userBet = db.getUserBetForMatch(userId, match.id);

                if (userBet) {
                  // Calculate refund amount (bet amount is stored as string in DB)
                  const refundAmount = parseEth(userBet.amount);

                  // Update database
                  db.updateBetClaimed(userId, match.id);

                  // Send success message
                  await handler.sendMessage(
                    channelId,
                    `💸 **Refund Claimed!**

<@${userId}> your refund has been processed successfully!

**Match:** ${match.home_team} vs ${match.away_team}
**Status:** CANCELLED ❌
**Refund Amount:** ${formatEth(refundAmount)} ETH

🔗 [Transaction](https://basescan.org/tx/${txHash})`,
                    {
                      mentions: [{ userId, displayName: userId.slice(0, 8) }],
                      ...(threadId && { threadId }),
                    }
                  );

                  console.log(
                    `✅ Refund confirmed for ${userId}: ${txHash}, amount: ${formatEth(
                      refundAmount
                    )} ETH`
                  );
                } else {
                  // No bet found in DB, but transaction succeeded
                  await handler.sendMessage(
                    channelId,
                    `✅ **Refund Transaction Confirmed!**

Your refund has been processed successfully!

🔗 [Transaction](https://basescan.org/tx/${txHash})`
                  );
                }
              } else {
                // Match not found, but transaction succeeded
                await handler.sendMessage(
                  channelId,
                  `✅ **Refund Transaction Confirmed!**

Your refund was successful! Check your wallet.

🔗 [Transaction](https://basescan.org/tx/${txHash})`
                );
              }
            }
          }

          if (!isClaimTx && !isRefundTx) {
            // Handle bet transaction (existing logic)
            const pendingBet = db.getPendingBet(userId);
            let matchInfo = "";

            if (pendingBet) {
              const match = db.getMatchById(pendingBet.match_id);
              if (match) {
                const predictionDisplay = formatOutcome(pendingBet.prediction);
                matchInfo = `\n\n**Match:** ${match.home_team} vs ${match.away_team}\n**Your Prediction:** ${predictionDisplay}\n**Stake:** ${pendingBet.amount} ETH`;

                // Record the bet in user stats
                db.recordBet(userId, pendingBet.amount);

                // Record the bet in bets table
                // Determine which wallet placed the bet by checking on-chain
                if (
                  match.on_chain_match_id &&
                  contractService.isContractAvailable()
                ) {
                  try {
                    const linkedWallets = await getLinkedWallets(
                      bot,
                      userId as `0x${string}`
                    );
                    let bettorWallet: string | null = null;

                    for (const wallet of linkedWallets) {
                      const onChainBet = await contractService.getUserBet(
                        match.on_chain_match_id,
                        wallet
                      );
                      if (onChainBet && onChainBet.amount > 0n) {
                        bettorWallet = wallet;
                        break;
                      }
                    }

                    if (bettorWallet) {
                      // Record bet in database
                      // Convert decimal string to wei string for consistent storage
                      const amountWeiString = parseEth(
                        pendingBet.amount
                      ).toString();

                      db.createBet(
                        userId,
                        bettorWallet,
                        pendingBet.match_id,
                        match.on_chain_match_id,
                        pendingBet.prediction,
                        amountWeiString,
                        txHash
                      );
                      console.log(
                        `💾 Bet recorded in DB: ${userId} -> ${truncateAddress(
                          bettorWallet
                        )}`
                      );
                    }
                  } catch (error) {
                    console.error("Failed to record bet in DB:", error);
                  }
                }

                // Clear the pending bet now that it's confirmed
                db.clearPendingBet(userId);
              }
            }

            await handler.sendMessage(
              channelId,
              `🎯 **Bet Confirmed!**

<@${userId}> your bet has been placed successfully!${matchInfo}

🔗 [Transaction](https://basescan.org/tx/${txHash})`,
              {
                mentions: [{ userId, displayName: userId.slice(0, 8) }],
                ...(threadId && { threadId }),
              }
            );

            console.log(`✅ Bet confirmed for ${userId}: ${txHash}`);
          }
        } else {
          await handler.sendMessage(
            channelId,
            `❌ **Transaction Failed**

Your bet was not placed. The transaction was reverted.

🔗 [View on Basescan](https://basescan.org/tx/${txHash})`
          );

          console.log(`❌ Bet transaction failed for ${userId}: ${txHash}`);
        }
      } catch (error) {
        console.error("Failed to wait for transaction:", error);
        await handler.sendMessage(
          channelId,
          `⚠️ **Unable to Confirm**

I couldn't verify your transaction status. Please check Basescan:

🔗 [View Transaction](https://basescan.org/tx/${txHash})

Use \`/mybets\` to verify your bet was placed.`
        );
      }
    }
  }
});

// ==================== MESSAGE HANDLERS ====================

// Handle general messages (mentions, etc.)
bot.onMessage(async (handler, { message, channelId, isMentioned }) => {
  // Only respond to mentions
  if (!isMentioned) return;

  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("hello") || lowerMessage.includes("hi")) {
    await handler.sendMessage(
      channelId,
      "Hey! 👋 Ready to bet on some football? Use `/matches` to see today's games!"
    );
    return;
  }

  if (lowerMessage.includes("help")) {
    await handler.sendMessage(
      channelId,
      "Use `/help` to see all available commands!"
    );
    return;
  }

  if (
    lowerMessage.includes("channel id") ||
    lowerMessage.includes("channelid")
  ) {
    await handler.sendMessage(
      channelId,
      `📍 **Channel ID:**\n\`\`\`\n${channelId}\n\`\`\`\n\nAdd this to your \`.env\` file as:\n\`DEFAULT_CHANNEL_ID=${channelId}\``
    );
    return;
  }

  // Default response
  await handler.sendMessage(
    channelId,
    "Hey! Use `/help` to see what I can do. 🎯⚽"
  );
});

// ==================== HELPER FUNCTIONS ====================

/*//////////////////////////////////////////////////////////////
                         DEBUG SLASH COMMANDS
    //////////////////////////////////////////////////////////////*/

// /contractinfo - Show contract version and config
bot.onSlashCommand("contractinfo", async (handler, { channelId }) => {
  try {
    const [
      version,
      owner,
      nextMatchId,
      stakeLimits,
      platformFee,
      accumulatedFees,
    ] = await Promise.all([
      contractService.getVersion(),
      contractService.getOwner(),
      contractService.getNextMatchId(),
      contractService.getStakeLimits(),
      contractService.getPlatformFeeBps(),
      contractService.getAccumulatedFees(),
    ]);

    const message = `📋 **Contract Information**

**Contract Address:**
\`${contractService.getContractAddress()}\`

**Version:**
${version || "❌ Failed to read"}

**Owner:**
\`${owner || "❌ Failed to read"}\`

**Configuration:**
• Next Match ID: ${nextMatchId}
• Min Stake: ${formatEth(stakeLimits.min)} ETH
• Max Stake: ${formatEth(stakeLimits.max)} ETH
• Platform Fee: ${platformFee ? Number(platformFee) / 100 : "?"}%
• Accumulated Fees: ${accumulatedFees ? formatEth(accumulatedFees) : "?"} ETH

**View on BaseScan:**
https://basescan.org/address/${contractService.getContractAddress()}`;

    await handler.sendMessage(channelId, message);
  } catch (error) {
    console.error("Contract info error:", error);
    await handler.sendMessage(
      channelId,
      `❌ Failed to fetch contract info: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
});

// /botinfo - Show bot wallet info
bot.onSlashCommand("botinfo", async (handler, { channelId, userId }) => {
  try {
    // Get user's smart account address
    const userSmartAccount = await getSmartAccountFromUserId(bot, {
      userId: userId as `0x${string}`,
    });
    // Check if user is admin (by EOA or smart account)
    const isAdminByEOA =
      userId.toLowerCase() === config.admin.userId.toLowerCase();
    const isAdminBySmartAccount = userSmartAccount
      ? userSmartAccount.toLowerCase() === config.admin.userId.toLowerCase()
      : false;

    if (!isAdminByEOA && !isAdminBySmartAccount) {
      await handler.sendMessage(
        channelId,
        "❌ **Access Denied**\n\nThis command is only available to the bot administrator."
      );
      return;
    }
    const balance = await contractService.getBotBalance();
    const signerAddress = contractService.getBotAddress();
    const treasuryAddress = contractService.getBotTreasuryAddress();

    const message = `🤖 **Bot Wallet Information**

**Signer Address (EOA):**
\`${signerAddress}\`
• This address signs transactions
• View: https://basescan.org/address/${signerAddress}

**Treasury Address (Smart Account):**
\`${treasuryAddress}\`
• This address executes transactions and holds funds
• Balance: ${formatEth(balance)} ETH
• View: https://basescan.org/address/${treasuryAddress}

${
  balance < BigInt(10 ** 15)
    ? "\n⚠️ **WARNING:** Low balance! Fund the treasury address to enable contract interactions."
    : ""
}`;

    await handler.sendMessage(channelId, message);
  } catch (error) {
    console.error("Bot info error:", error);
    await handler.sendMessage(
      channelId,
      `❌ Failed to fetch bot info: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
});

// /userHasBet - Test if user has bet on a match
bot.onSlashCommand("userHasBet", async (handler, { channelId, args }) => {
  try {
    // Validate arguments
    if (!args || args.length < 2) {
      await handler.sendMessage(
        channelId,
        `❌ **Missing Arguments**

**Usage:** \`/userHasBet <match#> <userAddress>\`

**Example:** \`/userHasBet 1 0x742d35Cc6634C0532925a3b844Bc3e7d02d20b02\`

**Parameters:**
• \`match#\` - The daily match number from \`/matches\` (e.g., 1, 2, 3)
• \`userAddress\` - The user's Ethereum address (0x...)`
      );
      return;
    }

    const matchNumStr = args[0].trim();
    const userAddress = args[1].trim();

    // Validate match number
    if (!/^\d+$/.test(matchNumStr)) {
      await handler.sendMessage(
        channelId,
        `❌ **Invalid Match Number**
"\`${matchNumStr}\`" is not a valid number.`
      );
      return;
    }

    const matchNum = parseInt(matchNumStr);

    // Validate user address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
      await handler.sendMessage(
        channelId,
        `❌ **Invalid User Address**
"\`${userAddress}\`" is not a valid Ethereum address.
Expected format: \`0x...\` (42 characters)`
      );
      return;
    }

    // Get match by daily ID
    const match = db.getMatchByDailyId(matchNum);
    if (!match) {
      await handler.sendMessage(
        channelId,
        `❌ **Match Not Found**
Match #${matchNum} not found for today. Use \`/matches\` to see available matches.`
      );
      return;
    }

    // Check if match is on-chain
    if (!match.on_chain_match_id) {
      await handler.sendMessage(
        channelId,
        `❌ **Match Not On-Chain**
Match #${matchNum} (${match.home_team} vs ${match.away_team}) hasn't been created on-chain yet.
No bets can exist for this match.`
      );
      return;
    }

    // Try to get smart account address (in case they provided EOA)
    let addressToCheck = userAddress as `0x${string}`;
    try {
      const smartAccount = await getSmartAccountFromUserId(bot, {
        userId: userAddress as `0x${string}`,
      });
      if (smartAccount) {
        addressToCheck = smartAccount;
        console.log(
          `[/userHasBet] Converted EOA ${userAddress} to smart account ${addressToCheck}`
        );
      }
    } catch (error) {
      // If it fails, assume they provided the smart account directly
      console.log(`[/userHasBet] Using address as provided: ${userAddress}`);
    }

    const hasBet = await contractService.hasUserBet(
      match.on_chain_match_id,
      addressToCheck
    );
    await handler.sendMessage(
      channelId,
      `🔍 **Bet Check Result**

**Match #${matchNum}:** ${match.home_team} vs ${match.away_team}
**On-Chain Match ID:** ${match.on_chain_match_id}
**User Address:** \`${truncateAddress(userAddress)}\`
${
  addressToCheck !== userAddress
    ? `**Smart Account:** \`${truncateAddress(addressToCheck)}\`\n`
    : ""
}
**Has Bet:** ${hasBet ? "✅ YES" : "❌ NO"}`
    );
  } catch (error) {
    console.error("User has bet error:", error);
    await handler.sendMessage(
      channelId,
      `❌ **User Has Bet Test Failed**

**Error:** ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
});

// /resolve - Admin-only manual match resolution
bot.onSlashCommand("resolve", async (handler, { channelId, userId, args }) => {
  try {
    // Get user's smart account address
    const userSmartAccount = await getSmartAccountFromUserId(bot, {
      userId: userId as `0x${string}`,
    });

    // Debug logging for authorization check
    console.log("═══════════════════════════════════════════════════════════");
    console.log("🔐 /RESOLVE AUTHORIZATION CHECK");
    console.log("═══════════════════════════════════════════════════════════");
    console.log("  📅 Timestamp:", new Date().toISOString());
    console.log("  👤 userId (EOA):", userId);
    console.log("  🏦 Smart Account:", userSmartAccount || "null");
    console.log("  🔑 config.admin.userId:", config.admin.userId);
    console.log("  ─────────────────────────────────────────────────────────");
    console.log(
      "  ✓ EOA matches config:",
      userId.toLowerCase() === config.admin.userId.toLowerCase()
    );
    console.log(
      "  ✓ Smart Account matches config:",
      userSmartAccount
        ? userSmartAccount.toLowerCase() === config.admin.userId.toLowerCase()
        : false
    );
    console.log("═══════════════════════════════════════════════════════════");

    // Check if user is admin (by EOA or smart account)
    const isAdminByEOA =
      userId.toLowerCase() === config.admin.userId.toLowerCase();
    const isAdminBySmartAccount = userSmartAccount
      ? userSmartAccount.toLowerCase() === config.admin.userId.toLowerCase()
      : false;

    if (!isAdminByEOA && !isAdminBySmartAccount) {
      await handler.sendMessage(
        channelId,
        "❌ **Access Denied**\n\nThis command is only available to the bot administrator."
      );
      return;
    }

    // Validate arguments
    if (args.length !== 1) {
      await handler.sendMessage(
        channelId,
        `❌ **Invalid Usage**

**Usage:** \`/resolve <match#|match_code>\`

**Examples:**
  \`/resolve 1\` (today's match #1)
  \`/resolve 20260111-2\` (specific match by code)

Use \`/matches\` to see today's match numbers.`
      );
      return;
    }

    const input = args[0];
    let match: DBMatch | undefined;

    // Check if input is a match code (contains dash) or just a number
    if (input.includes("-")) {
      // Full match code provided (e.g., 20260111-2)
      match = db.getMatchByMatchCode(input);

      if (!match) {
        await handler.sendMessage(
          channelId,
          `❌ Match \`${input}\` not found. Use \`/matches\` to see available matches.`
        );
        return;
      }
    } else {
      // Just a number - try as today's match
      const matchNum = parseInt(input);

      if (isNaN(matchNum) || matchNum < 1) {
        await handler.sendMessage(
          channelId,
          "❌ Invalid match number. Use `/matches` to see available matches."
        );
        return;
      }

      // Try to find today's match with this daily_id
      match = db.getMatchByDailyId(matchNum);

      if (!match) {
        // Generate today's match code hint
        const today = new Date();
        const year = today.getUTCFullYear();
        const month = String(today.getUTCMonth() + 1).padStart(2, "0");
        const day = String(today.getUTCDate()).padStart(2, "0");
        const todayCode = `${year}${month}${day}-${matchNum}`;

        await handler.sendMessage(
          channelId,
          `❌ Match #${matchNum} not found for today.

**Looking for an older match?**
Try: \`/resolve ${todayCode}\` for match #${matchNum} from another day

Use \`/matches\` to see today's matches.`
        );
        return;
      }
    }

    // Check if match has on-chain ID
    if (!match.on_chain_match_id) {
      const matchDisplay = match.match_code || `#${match.daily_id || match.id}`;
      await handler.sendMessage(
        channelId,
        `❌ **Cannot Resolve Match**

**Match ${matchDisplay}:** ${match.home_team} vs ${match.away_team}

This match hasn't been created on-chain yet (no bets placed).`
      );
      return;
    }

    // Check if already resolved
    if (match.status === "FINISHED" && match.result !== null) {
      const matchDisplay = match.match_code || `#${match.daily_id || match.id}`;
      await handler.sendMessage(
        channelId,
        `ℹ️ **Match Already Resolved**

**Match ${matchDisplay}:** ${match.home_team} vs ${match.away_team}
**Score:** ${match.home_score} - ${match.away_score}
**Result:** ${formatOutcome(match.result)}`
      );
      return;
    }

    // Fetch latest match data from API
    await handler.sendMessage(
      channelId,
      `🔍 Fetching latest match data for **${match.home_team} vs ${match.away_team}**...`
    );

    const apiMatch = await footballApi.getMatch(match.api_match_id);

    // Check if match is finished
    if (!FootballAPIService.isFinished(apiMatch.status)) {
      const matchDisplay = match.match_code || `#${match.daily_id || match.id}`;
      await handler.sendMessage(
        channelId,
        `❌ **Match Not Finished**

**Match ${matchDisplay}:** ${match.home_team} vs ${match.away_team}
**Status:** ${apiMatch.status}

Cannot resolve a match that hasn't finished yet.`
      );
      return;
    }

    // Get scores
    const homeScore = apiMatch.score.fullTime.home;
    const awayScore = apiMatch.score.fullTime.away;

    if (homeScore === null || awayScore === null) {
      await handler.sendMessage(
        channelId,
        `❌ **No Score Available**

Match is marked as finished but scores are not available yet. Please try again later.`
      );
      return;
    }

    // Determine outcome
    const outcome = FootballAPIService.determineOutcome(homeScore, awayScore);

    if (outcome === null) {
      await handler.sendMessage(
        channelId,
        `❌ **Error Determining Outcome**

Could not determine match outcome from scores: ${homeScore} - ${awayScore}`
      );
      return;
    }

    // Update local database
    db.updateMatchResult(match.id, homeScore, awayScore, outcome);

    // Resolve on-chain
    await handler.sendMessage(
      channelId,
      `⏳ Resolving match on-chain...\n\n**${
        match.home_team
      } ${homeScore} - ${awayScore} ${
        match.away_team
      }**\n**Result:** ${formatOutcome(outcome)}`
    );

    const result = await contractService.resolveMatch(
      match.on_chain_match_id,
      outcome
    );

    if (!result) {
      await handler.sendMessage(
        channelId,
        `❌ **On-Chain Resolution Failed**

The match result was saved locally but the on-chain transaction failed. Check logs for details.`
      );
      return;
    }

    // Get pool info
    const pools = await contractService.getPools(match.on_chain_match_id);
    const totalPool = pools ? formatEth(pools.total) : "?";

    // Success message
    const matchCode = match.match_code || `${match.daily_id}`;
    await handler.sendMessage(
      channelId,
      `✅ **Match Resolved Successfully**

🏁 **${match.home_team} ${homeScore} - ${awayScore} ${match.away_team}**

**Result:** ${formatOutcome(outcome)}
💰 **Total Pool:** ${totalPool} ETH
🔗 **Transaction:** \`${result.txHash}\`

Winners can now claim their winnings using \`/claim ${matchCode}\``
    );
  } catch (error) {
    console.error("Error in /resolve command:", error);
    await handler.sendMessage(
      channelId,
      `❌ **Resolution Failed**

**Error:** ${error instanceof Error ? error.message : "Unknown error"}

Please check the logs for more details.`
    );
  }
});

/*//////////////////////////////////////////////////////////////
                         START BOT
    //////////////////////////////////////////////////////////////*/

const app = bot.start();

// Add webhook debugging middleware (logs ALL incoming webhooks before SDK processes them)
app.use("/webhook", async (c, next) => {
  const clonedReq = c.req.raw.clone();
  try {
    const body = await clonedReq.json();
    console.log("🔔 WEBHOOK RECEIVED:", {
      method: c.req.method,
      path: c.req.path,
      timestamp: new Date().toISOString(),
      body: JSON.stringify(body, null, 2),
    });
  } catch (e) {
    console.log("🔔 WEBHOOK RECEIVED (non-JSON):", {
      method: c.req.method,
      path: c.req.path,
      timestamp: new Date().toISOString(),
    });
  }
  return next();
});

// Add discovery endpoint for bot directories
app.get("/.well-known/agent-metadata.json", async (c) => {
  return c.json(await bot.getIdentityMetadata());
});

// Health check endpoint for monitoring
app.get("/health", async (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ============ REST API Endpoints ============

/**
 * GET /api/claimable/:userAddress
 * Get user's claimable matches (winnings + refunds)
 */
app.get("/api/claimable/:userAddress", async (c) => {
  try {
    const userAddress = c.req.param("userAddress");

    // Validate address format
    if (!userAddress || !/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
      return c.json({ error: "Invalid Ethereum address" }, 400);
    }

    const result = await subgraphService.getUserClaimable(userAddress);

    return c.json({
      data: result.data,
      source: result.source,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("Error fetching claimable matches:", error);
    return c.json({ error: "Failed to fetch claimable matches" }, 500);
  }
});

/**
 * GET /api/stats/:userAddress
 * Get user's betting statistics
 */
app.get("/api/stats/:userAddress", async (c) => {
  try {
    const userAddress = c.req.param("userAddress");

    // Validate address format
    if (!userAddress || !/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
      return c.json({ error: "Invalid Ethereum address" }, 400);
    }

    const result = await subgraphService.getUserStats(userAddress);

    if (!result.data) {
      return c.json({ error: "User not found" }, 404);
    }

    return c.json({
      data: result.data,
      source: result.source,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("Error fetching user stats:", error);
    return c.json({ error: "Failed to fetch user stats" }, 500);
  }
});

/**
 * GET /api/leaderboard?limit=10
 * Get top users by profit
 */
app.get("/api/leaderboard", async (c) => {
  try {
    const limitParam = c.req.query("limit");
    const limit = limitParam ? parseInt(limitParam) : 10;

    // Validate limit
    if (isNaN(limit) || limit < 1 || limit > 100) {
      return c.json({ error: "Invalid limit (must be 1-100)" }, 400);
    }

    const result = await subgraphService.getLeaderboard(limit);

    return c.json({
      data: result.data,
      source: result.source,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    return c.json({ error: "Failed to fetch leaderboard" }, 500);
  }
});

// Start the scheduler for automated tasks
startScheduler(bot, contractService);

console.log("🎯 MatchDay Bet Bot started!");
console.log(`📝 Contract: ${config.contract.address}`);

export default app;
