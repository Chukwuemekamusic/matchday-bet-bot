import { makeTownsBot, getSmartAccountFromUserId } from "@towns-protocol/bot";
import { hexToBytes } from "viem";
import commands from "./commands";
import { db } from "./db";
import { ContractService } from "./services/contract";
import { footballApi, FootballAPIService } from "./services/footballApi";
import {
  formatEth,
  parseEth,
  formatTime,
  formatOdds,
  formatOutcome,
  parseOutcome,
  truncateAddress,
  timeUntilKickoff,
  isBettingOpen,
  formatMatchDisplay,
} from "./utils/format";
import { Outcome, DBMatch } from "./types";
import { config } from "./config";
import { startScheduler } from "./scheduler";
import { getLinkedWallets } from "./utils/wallet";

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

// Initialize contract service with bot instance
const contractService = new ContractService(bot);

// /help - Show available commands
bot.onSlashCommand("help", async (handler, { channelId }) => {
  const message = `🎯 **MatchDay Bet Bot - Commands**

**Viewing Matches:**
• \`/matches\` - Show today's matches
• \`/odds <match#>\` - Show current odds for a match

**Betting:**
• \`/bet <match#> <home|draw|away> <amount>\` - Place a bet
  Example: \`/bet 1 home 0.01\`
  (You'll get a confirmation button to sign the transaction)
• \`/pending\` - Check your pending bet status
• \`/cancel\` - Cancel your pending bet

**Your Bets:**
• \`/mybets\` - Show your active bets
• \`/claim <match#>\` - Claim winnings for a match

**Stats:**
• \`/stats\` - Show your betting stats
• \`/leaderboard\` - Show top bettors

**Debug Commands:**
• \`/debug\` - Show comprehensive debug info
• \`/checkmanager\` - Check if bot is match manager
• \`/contractinfo\` - Show contract details
• \`/botinfo\` - Show bot wallet info
• \`/testread\` - Test reading from contract
• \`/testcreate\` - Test creating a match (requires manager)

💰 Stakes: ${config.betting.minStake} - ${config.betting.maxStake} ETH`;

  await handler.sendMessage(channelId, message);
});

// /matches - Show today's matches
bot.onSlashCommand("matches", async (handler, { channelId, args }) => {
  const leagueFilter = args[0]?.toUpperCase();

  let matches = db.getTodaysMatches();

  if (matches.length === 0) {
    await handler.sendMessage(
      channelId,
      "📅 No matches scheduled for today. Check back tomorrow!"
    );
    return;
  }

  // Filter by league if specified
  if (leagueFilter) {
    const codeMap: Record<string, string> = {
      PL: "PL",
      PREMIER: "PL",
      LALIGA: "PD",
      LA: "PD",
      BUNDESLIGA: "BL1",
      BL: "BL1",
      SERIEA: "SA",
      SA: "SA",
      LIGUE1: "FL1",
      FL1: "FL1",
      UCL: "CL",
      CL: "CL",
      CHAMPIONS: "CL",
    };
    const code = codeMap[leagueFilter];
    if (code) {
      matches = matches.filter((m) => m.competition_code === code);
    }
  }

  if (matches.length === 0) {
    await handler.sendMessage(
      channelId,
      `📅 No ${leagueFilter || ""} matches scheduled for today.`
    );
    return;
  }

  // Group matches by competition
  const grouped = new Map<string, DBMatch[]>();
  for (const match of matches) {
    if (!grouped.has(match.competition)) {
      grouped.set(match.competition, []);
    }
    grouped.get(match.competition)!.push(match);
  }

  let message = "⚽ **Today's Matches**\n\n";

  for (const [competition, compMatches] of grouped) {
    const emoji = getCompetitionEmoji(compMatches[0].competition_code);
    message += `${emoji} **${competition}**\n\n`;

    for (const match of compMatches) {
      message += formatMatchDisplay(match);
    }
  }

  message += "Use `/bet <#> <home|draw|away> <amount>` to place a bet!";

  await handler.sendMessage(channelId, message);
});

// /odds - Show odds for a match
bot.onSlashCommand("odds", async (handler, { channelId, args }) => {
  if (args.length < 1) {
    await handler.sendMessage(
      channelId,
      "❌ Usage: `/odds <match #>`\nExample: `/odds 1`"
    );
    return;
  }

  const matchNum = parseInt(args[0]);
  if (isNaN(matchNum) || matchNum < 1) {
    await handler.sendMessage(
      channelId,
      "❌ Invalid match number. Use `/matches` to see available matches."
    );
    return;
  }

  const match = db.getMatchByDailyId(matchNum);
  if (!match) {
    await handler.sendMessage(
      channelId,
      `❌ Match #${matchNum} not found for today. Use \`/matches\` to see available matches.`
    );
    return;
  }

  // If match hasn't been created on-chain yet OR contract not deployed
  if (!match.on_chain_match_id || !contractService.isContractAvailable()) {
    const message = `⚽ **${match.home_team} vs ${match.away_team}**
${match.competition}

⏰ Kickoff: ${formatTime(match.kickoff_time)}

${
  contractService.isContractAvailable()
    ? "📊 No bets placed yet - be the first!\n\nOdds will update as bets come in."
    : "📊 Betting odds will be available once the smart contract is deployed!\n\nStay tuned for live betting action. ⚡"
}`;
    await handler.sendMessage(channelId, message);
    return;
  }

  // Get pools and odds from contract
  const pools = await contractService.getPools(match.on_chain_match_id);
  const odds = await contractService.getOdds(match.on_chain_match_id);

  if (!pools || !odds) {
    await handler.sendMessage(
      channelId,
      "❌ Failed to fetch odds. Please try again."
    );
    return;
  }

  const status = isBettingOpen(match.kickoff_time)
    ? "🟢 Betting Open"
    : "🔴 Betting Closed";

  const message = `⚽ **${match.home_team} vs ${match.away_team}**
${match.competition} | ${status}

⏰ Kickoff: ${formatTime(match.kickoff_time)} (${timeUntilKickoff(
    match.kickoff_time
  )})

📊 **Current Odds:** \n\n
• Home (${match.home_team}): ${formatOdds(odds.home)} — Pool: ${formatEth(
    pools.home
  )} ETH \n\n
• Draw: ${formatOdds(odds.draw)} — Pool: ${formatEth(pools.draw)} ETH \n\n
• Away (${match.away_team}): ${formatOdds(odds.away)} — Pool: ${formatEth(
    pools.away
  )} ETH \n\n

💰 **Total Pool:** ${formatEth(pools.total)} ETH

${
  isBettingOpen(match.kickoff_time)
    ? `Use \`/bet ${matchNum} <home|draw|away> <amount>\` to place your bet!`
    : ""
}`;

  await handler.sendMessage(channelId, message);
});

// /bet - Place a bet (step 1: create pending bet)
bot.onSlashCommand("bet", async (handler, { channelId, args, userId }) => {
  try {
    console.log("═══════════════════════════════════════════════════════");
    console.log("🎯 /BET COMMAND HANDLER INVOKED");
    console.log("═══════════════════════════════════════════════════════");
    console.log("  📅 Timestamp:", new Date().toISOString());
    console.log("  👤 userId:", userId);
    console.log("  📝 args:", args);
    console.log("  📍 channelId:", channelId);

    // Check if user already has a pending bet
    const existingPending = db.getPendingBet(userId);
    console.log(
      "  💾 Existing pending bet:",
      existingPending
        ? `YES - match ${existingPending.match_id}, ${
            existingPending.amount
          } ETH, expires ${new Date(
            existingPending.expires_at * 1000
          ).toISOString()}`
        : "NO"
    );

    console.log("═══════════════════════════════════════════════════════");

    if (args.length < 3) {
      console.log("❌ Invalid args length:", args.length);
      await handler.sendMessage(
        channelId,
        `❌ Usage: \`/bet <match #> <home|draw|away> <amount>\`
Example: \`/bet 1 home 0.01\``
      );
      return;
    }

    const matchNum = parseInt(args[0]);
    const predictionStr = args[1];
    const amountStr = args[2];

    console.log("📝 Parsed args:", { matchNum, predictionStr, amountStr });

    // Validate match number
    if (isNaN(matchNum) || matchNum < 1) {
      console.log("❌ Invalid match number");
      await handler.sendMessage(
        channelId,
        "❌ Invalid match number. Use `/matches` to see available matches."
      );
      return;
    }

    // Get match by daily ID
    const match = db.getMatchByDailyId(matchNum);
    console.log(
      "📊 Match lookup:",
      match ? `${match.home_team} vs ${match.away_team}` : "NOT FOUND"
    );

    if (!match) {
      await handler.sendMessage(
        channelId,
        `❌ Match #${matchNum} not found for today. Use \`/matches\` to see available matches.`
      );
      return;
    }

    // Check if betting is still open
    const bettingOpen = isBettingOpen(match.kickoff_time);
    console.log(
      "⏰ Betting open?",
      bettingOpen,
      "Kickoff:",
      new Date(match.kickoff_time * 1000)
    );

    if (!bettingOpen) {
      await handler.sendMessage(
        channelId,
        "❌ Betting is closed for this match. Kickoff has passed."
      );
      return;
    }

    // Parse prediction
    const prediction = parseOutcome(predictionStr);
    console.log("🎲 Prediction parsed:", prediction, "from", predictionStr);

    if (prediction === null) {
      await handler.sendMessage(
        channelId,
        "❌ Invalid prediction. Use: home, draw, or away"
      );
      return;
    }

    // Parse and validate amount
    let amount: bigint;
    try {
      amount = parseEth(amountStr);
      console.log("💰 Amount parsed:", formatEth(amount), "ETH");
    } catch (error) {
      console.log("❌ Failed to parse amount:", error);
      await handler.sendMessage(
        channelId,
        "❌ Invalid amount. Enter a number like 0.01"
      );
      return;
    }

    const minStake = parseEth(config.betting.minStake);
    const maxStake = parseEth(config.betting.maxStake);

    if (amount < minStake) {
      await handler.sendMessage(
        channelId,
        `❌ Minimum bet is ${config.betting.minStake} ETH`
      );
      return;
    }

    if (amount > maxStake) {
      await handler.sendMessage(
        channelId,
        `❌ Maximum bet is ${config.betting.maxStake} ETH`
      );
      return;
    }

    // Check if user already bet on this match (DB check)
    const existingBet = db.getUserBetOnMatch(userId, match.id);
    if (existingBet) {
      await handler.sendMessage(
        channelId,
        `❌ You've already placed a bet on this match with wallet ${truncateAddress(
          existingBet.wallet_address
        )}
        \n\nNote: You can only bet once per match. Use "/mybets" to view your active bets.`
      );
      return;
    }

    // Create pending bet
    db.createPendingBet(userId, match.id, prediction, amountStr);

    const predictionDisplay =
      prediction === Outcome.HOME
        ? `${match.home_team} Win (Home)`
        : prediction === Outcome.DRAW
        ? "Draw"
        : `${match.away_team} Win (Away)`;

    // Calculate potential winnings if match is on-chain and contract available
    let potentialWinnings = "";
    if (match.on_chain_match_id && contractService.isContractAvailable()) {
      const potential = await contractService.calculatePotentialWinnings(
        match.on_chain_match_id,
        prediction,
        amount
      );
      if (potential) {
        potentialWinnings = `\n💸 Potential Payout: ~${formatEth(
          potential
        )} ETH`;
      }
    }

    const interactionId = `bet-${match.id}-${userId}-${Date.now()}`;

    // Store interaction ID with pending bet
    db.updatePendingBetInteractionId(userId, interactionId);
    console.log("💾 Pending bet saved with interaction ID:", interactionId);

    const message = `⚽ **Confirm Your Bet**

**Match:** ${match.home_team} vs ${match.away_team}
**Your Pick:** ${predictionDisplay}
**Stake:** ${amountStr} ETH
${potentialWinnings}

⚠️ This will transfer ${amountStr} ETH from your wallet.

_This pending bet expires in 5 minutes._`;

    // Send interactive message with buttons
    try {
      console.log("📤 Attempting to send interaction request...");
      console.log("  - channelId:", channelId);
      console.log("  - interactionId:", interactionId);
      console.log("  - userId:", userId);

      await handler.sendInteractionRequest(
        channelId,
        {
          case: "form",
          value: {
            id: interactionId,
            title: "Confirm Bet",
            content: message,
            components: [
              {
                id: "confirm",
                component: {
                  case: "button",
                  value: {
                    label: "Confirm & Sign",
                    style: 1, // PRIMARY style
                  },
                },
              },
              {
                id: "cancel",
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
        } as any, // Type assertion for complex protobuf types
        hexToBytes(userId as `0x${string}`) // recipient
      );

      console.log("✅ Interaction request sent successfully");
    } catch (error) {
      console.error("❌ Failed to send interaction request:", error);
      console.error("Error details:", JSON.stringify(error, null, 2));

      // Fallback: send simple message
      await handler.sendMessage(
        channelId,
        `⚽ **Bet Saved!**

**Match:** ${match.home_team} vs ${match.away_team}
**Your Pick:** ${predictionDisplay}
**Stake:** ${amountStr} ETH

❌ Interactive buttons are not working. Please check the error logs or try again later.

_This pending bet expires in 5 minutes._`
      );
    }
  } catch (error) {
    console.error("❌ FATAL ERROR in /bet handler:", error);
    console.error("Stack trace:", error);

    try {
      await handler.sendMessage(
        channelId,
        "❌ An unexpected error occurred. Please try again or contact support."
      );
    } catch (msgError) {
      console.error("❌ Failed to send error message:", msgError);
    }
  }
});

// /pending - Check pending bet status
bot.onSlashCommand("pending", async (handler, { channelId, userId }) => {
  const pending = db.getPendingBet(userId);

  if (!pending) {
    await handler.sendMessage(
      channelId,
      "ℹ️ You don't have any pending bets.\n\nUse `/bet` to place a new bet!"
    );
    return;
  }

  const match = db.getMatchById(pending.match_id);
  if (!match) {
    await handler.sendMessage(
      channelId,
      "❌ Your pending bet references a match that no longer exists."
    );
    db.clearPendingBet(userId);
    return;
  }

  const predictionDisplay = formatOutcome(pending.prediction);
  const expiresIn = Math.max(
    0,
    pending.expires_at - Math.floor(Date.now() / 1000)
  );
  const expiresMinutes = Math.floor(expiresIn / 60);
  const expiresSeconds = expiresIn % 60;

  const message = `⏳ **Your Pending Bet**

**Match:** ${match.home_team} vs ${match.away_team}
**Your Pick:** ${predictionDisplay}
**Stake:** ${pending.amount} ETH

**Expires in:** ${expiresMinutes}m ${expiresSeconds}s

To complete your bet, click the "Confirm & Sign" button in the message above.
To cancel, use \`/cancel\`.`;

  await handler.sendMessage(channelId, message);
});

// /cancel - Cancel pending bet
bot.onSlashCommand("cancel", async (handler, { channelId, userId }) => {
  const pending = db.getPendingBet(userId);

  if (!pending) {
    await handler.sendMessage(channelId, "❌ No pending bet to cancel.");
    return;
  }

  db.clearPendingBet(userId);
  await handler.sendMessage(channelId, "✅ Pending bet cancelled.");
});

// /mybets - Show user's bets
bot.onSlashCommand("mybets", async (handler, { channelId, userId }) => {
  console.log(`[/mybets] Fetching bets for user ${userId}`);

  // Get all user's bets from DB
  const userBets = db.getUserBets(userId);

  if (userBets.length === 0) {
    await handler.sendMessage(
      channelId,
      "📋 **My Bets**\n\nYou don't have any active bets.\n\nUse `/matches` to browse available matches and place a bet!"
    );
    return;
  }

  // Group bets by wallet address
  const betsByWallet = new Map<string, typeof userBets>();
  for (const bet of userBets) {
    if (!betsByWallet.has(bet.wallet_address)) {
      betsByWallet.set(bet.wallet_address, []);
    }
    betsByWallet.get(bet.wallet_address)!.push(bet);
  }

  console.log(
    `[/mybets] Found ${userBets.length} bets across ${betsByWallet.size} wallet(s)`
  );

  let message = "📋 **Your Active Bets**\n\n";
  let totalBets = 0;

  // Display bets grouped by wallet
  for (const [walletAddress, bets] of betsByWallet) {
    // Determine wallet label (primary vs linked)
    let walletLabel = "🔗 Linked Wallet";
    try {
      const smartAccount = await getSmartAccountFromUserId(bot, {
        userId,
      });
      if (
        smartAccount &&
        smartAccount.toLowerCase() === walletAddress.toLowerCase()
      ) {
        walletLabel = "🔑 Primary Wallet";
      }
    } catch (error) {
      // If we can't determine, just show as a wallet
      walletLabel = "💼 Wallet";
    }

    message += `**${walletLabel}** (${truncateAddress(walletAddress)}):\n\n`;

    for (const bet of bets) {
      const match = db.getMatchById(bet.match_id);
      if (!match) continue;

      const prediction = formatOutcome(bet.prediction);
      const amount = formatEth(bet.amount);
      const status =
        match.status === "FINISHED"
          ? bet.prediction === match.result
            ? "🎉 WON"
            : "❌ LOST"
          : "⏳ Pending";

      // Show match code in parentheses
      const matchCode = match.match_code || `#${match.daily_id || match.id}`;
      message += `• **${match.home_team} vs ${match.away_team}** (${matchCode})\n`;
      message += `  Pick: ${prediction} | Stake: ${amount} ETH | ${status}`;

      if (
        match.status === "FINISHED" &&
        bet.prediction === match.result &&
        !bet.claimed
      ) {
        message += ` — Use \`/claim ${matchCode}\` to collect!`;
      }
      message += "\n\n";
      totalBets++;
    }
  }

  message += `━━━━━━━━━━━━━━━━━\n`;
  message += `**Total:** ${totalBets} bet${totalBets !== 1 ? "s" : ""} across ${
    betsByWallet.size
  } wallet${betsByWallet.size !== 1 ? "s" : ""}`;

  await handler.sendMessage(channelId, message);
});

// /claim - Claim winnings
bot.onSlashCommand("claim", async (handler, { channelId, args, userId }) => {
  try {
    // Check if contract is available
    if (!contractService.isContractAvailable()) {
      await handler.sendMessage(
        channelId,
        "❌ Smart contract is not yet deployed. Please contact the admin."
      );
      return;
    }

    // Validate args
    if (args.length < 1) {
      await handler.sendMessage(
        channelId,
        `❌ Usage: \`/claim <match #>\`

Example: \`/claim 1\`

Use \`/claimable\` to see all your unclaimed winnings.`
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
          `❌ Match \`${input}\` not found.

Use \`/claimable\` to see all claimable matches.`
        );
        return;
      }
    } else {
      // Just a number - try as today's match
      const matchNum = parseInt(input);

      if (isNaN(matchNum) || matchNum < 1) {
        await handler.sendMessage(
          channelId,
          "❌ Invalid match number. Use `/claimable` to see available matches."
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
Try: \`/claim ${todayCode}\` for match #${matchNum} from another day

Or run \`/claimable\` to see all your claimable matches.`
        );
        return;
      }
    }

    // Check if match is on-chain
    if (!match.on_chain_match_id) {
      await handler.sendMessage(
        channelId,
        `❌ This match hasn't been created on-chain yet. No bets have been placed.`
      );
      return;
    }

    // Check if match is resolved
    if (match.result === null || match.result === undefined) {
      await handler.sendMessage(
        channelId,
        `⏳ Match hasn't been resolved yet.

**${match.home_team} vs ${match.away_team}**
Status: ${match.status}

You can claim once the match is finished and resolved.`
      );
      return;
    }

    // Get user's bet on this match
    const userBet = db.getUserBetForMatch(userId, match.id);

    if (!userBet) {
      await handler.sendMessage(
        channelId,
        `❌ You didn't place a bet on this match.

**${match.home_team} vs ${match.away_team}**

Use \`/claimable\` to see matches you can claim from.`
      );
      return;
    }

    // Check if user's prediction was correct
    if (userBet.prediction !== match.result) {
      const userPrediction = formatOutcome(userBet.prediction);
      const actualResult = formatOutcome(match.result);

      await handler.sendMessage(
        channelId,
        `😔 Your bet didn't win.

**${match.home_team} vs ${match.away_team}**
Your Prediction: ${userPrediction}
Result: ${actualResult}

Better luck next time!`
      );
      return;
    }

    // Check if already claimed
    if (userBet.claimed === 1) {
      await handler.sendMessage(
        channelId,
        `✅ You've already claimed winnings for this match.

**${match.home_team} vs ${match.away_team}**

Use \`/stats\` to see your total winnings.`
      );
      return;
    }

    // Get on-chain bet to calculate winnings
    const walletAddress = await getSmartAccountFromUserId(bot, {
      userId: userId as `0x${string}`,
    });

    if (!walletAddress) {
      await handler.sendMessage(
        channelId,
        `❌ Couldn't retrieve your wallet address. Please try again or contact support.`
      );
      return;
    }

    const onChainBet = await contractService.getUserBet(
      match.on_chain_match_id,
      walletAddress
    );

    if (!onChainBet || onChainBet.amount === 0n) {
      await handler.sendMessage(
        channelId,
        `❌ Couldn't find your bet on-chain. Please contact support.

Wallet: ${truncateAddress(walletAddress)}`
      );
      return;
    }

    // Check if already claimed on-chain
    if (onChainBet.claimed) {
      // Update DB to match on-chain state
      db.updateBetClaimed(userId, match.id);

      await handler.sendMessage(
        channelId,
        `✅ You've already claimed winnings for this match on-chain.

**${match.home_team} vs ${match.away_team}**

Use \`/stats\` to see your total winnings.`
      );
      return;
    }

    // Calculate potential winnings
    const potentialWinnings = await contractService.calculatePotentialWinnings(
      match.on_chain_match_id,
      userBet.prediction,
      BigInt(onChainBet.amount)
    );

    if (!potentialWinnings || potentialWinnings === 0n) {
      await handler.sendMessage(
        channelId,
        `⚠️ Winnings calculation returned 0 ETH. This might be a pool issue. Please contact support.

**${match.home_team} vs ${match.away_team}**`
      );
      return;
    }

    // Create interaction for claiming
    const interactionId = `claim-${match.id}-${userId}-${Date.now()}`;
    const profit = potentialWinnings - BigInt(onChainBet.amount);

    const message = `💰 **Claim Your Winnings**

**Match:** ${match.home_team} vs ${match.away_team}
**Your Prediction:** ${formatOutcome(userBet.prediction)} ✅
**Stake:** ${formatEth(BigInt(onChainBet.amount))} ETH
**Payout:** ${formatEth(potentialWinnings)} ETH
**Profit:** ${formatEth(profit)} ETH

Ready to claim your winnings?`;

    // Send interactive message with buttons
    await handler.sendInteractionRequest(
      channelId,
      {
        case: "form",
        value: {
          id: interactionId,
          title: "Claim Winnings",
          content: message,
          components: [
            {
              id: "claim-confirm",
              component: {
                case: "button",
                value: {
                  label: "Claim Winnings",
                  style: 1, // PRIMARY style
                },
              },
            },
            {
              id: "claim-cancel",
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
      hexToBytes(userId as `0x${string}`)
    );

    // Store claim context in a temporary table/map
    // For now, we'll track it by storing matchId in the interaction ID
    // The onInteractionResponse handler will parse it
  } catch (error) {
    console.error("Error in /claim command:", error);
    await handler.sendMessage(
      channelId,
      "❌ An error occurred while processing your claim. Please try again or contact support."
    );
  }
});

// /claim_refund - Claim refund from a cancelled match
bot.onSlashCommand(
  "claim_refund",
  async (handler, { channelId, args, userId }) => {
    try {
      // Check if contract is available
      if (!contractService.isContractAvailable()) {
        await handler.sendMessage(
          channelId,
          "❌ Smart contract is not yet deployed. Please contact the admin."
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

Use \`/matches\` to see today's match numbers or \`/mybets\` to see match codes.`
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
            `❌ Match \`${input}\` not found.\n\nUse \`/matches\` to see available matches.`
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
            `❌ Match #${matchNum} not found for today.\n\n**Looking for an older match?**\nTry: \`/claim_refund ${todayCode}\` for match #${matchNum} from another day\n\nOr use \`/mybets\` to see your bets with match codes.`
          );
          return;
        }
      }

      // Check if match is on-chain
      if (!match.on_chain_match_id) {
        await handler.sendMessage(
          channelId,
          `❌ This match hasn't been created on-chain yet. No bets have been placed.`
        );
        return;
      }

      // Get wallet address first (needed for eligibility check)
      const walletAddress = await getSmartAccountFromUserId(bot, {
        userId: userId as `0x${string}`,
      });

      if (!walletAddress) {
        await handler.sendMessage(
          channelId,
          `❌ Couldn't retrieve your wallet address. Please try again or contact support.`
        );
        return;
      }

      // Check refund eligibility on-chain
      const eligibility = await contractService.isRefundEligible(
        match.on_chain_match_id,
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
          if (
            eligibility.reason.includes("Use /claim to get your stake back")
          ) {
            message += `${eligibility.reason}`;
          } else if (eligibility.reason === "Already claimed") {
            message += `You've already claimed your refund for this match.`;
          } else if (eligibility.reason === "No bet found") {
            message += `You didn't place a bet on this match.`;
          } else if (eligibility.reason === "Match resolved - you lost") {
            message += `This match has been resolved and you didn't win. Only cancelled matches or matches with no winners are eligible for refunds.`;
          } else {
            message += `Reason: ${eligibility.reason}`;
          }
        }

        await handler.sendMessage(channelId, message);
        return;
      }

      // Get on-chain bet for amount
      const onChainBet = await contractService.getUserBet(
        match.on_chain_match_id,
        walletAddress
      );

      if (!onChainBet || onChainBet.amount === 0n) {
        await handler.sendMessage(
          channelId,
          `❌ Couldn't find your bet on-chain. Please contact support.

Wallet: ${truncateAddress(walletAddress)}`
        );
        return;
      }

      // Create interaction for claiming refund
      const interactionId = `claim_refund-${match.id}-${userId}-${Date.now()}`;
      const refundAmount = BigInt(onChainBet.amount);

      // Determine status display and reason
      let statusDisplay = match.status;
      let reasonText = "You can claim a full refund of your stake.";

      if (eligibility.reason === "Match cancelled") {
        statusDisplay = "CANCELLED ❌";
        reasonText =
          "This match was cancelled. You can claim a full refund of your stake.";
      } else if (eligibility.reason === "No winners - everyone gets refund") {
        statusDisplay = "RESOLVED (No Winners) 🔄";
        reasonText =
          "No one predicted the correct outcome. Everyone gets a full refund.";
      }

      const message = `💸 **Claim Your Refund**

**Match:** ${match.home_team} vs ${match.away_team}
**Status:** ${statusDisplay}
**Your Stake:** ${formatEth(refundAmount)} ETH
**Refund Amount:** ${formatEth(refundAmount)} ETH

${reasonText}

Ready to claim your refund?`;

      // Send interactive message with buttons
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
        hexToBytes(userId as `0x${string}`)
      );
    } catch (error) {
      console.error("Error in /claim_refund command:", error);
      await handler.sendMessage(
        channelId,
        "❌ An error occurred while processing your refund claim. Please try again or contact support."
      );
    }
  }
);

// /claimable - List all unclaimed winnings
bot.onSlashCommand("claimable", async (handler, { channelId, userId }) => {
  try {
    // Check if contract is available
    if (!contractService.isContractAvailable()) {
      await handler.sendMessage(
        channelId,
        "❌ Smart contract is not yet deployed. Please contact the admin."
      );
      return;
    }

    // Get all claimable bets for the user
    const claimableBets = db.getClaimableBets(userId);

    if (claimableBets.length === 0) {
      await handler.sendMessage(
        channelId,
        `📭 **No Unclaimed Winnings**

You don't have any unclaimed winnings at the moment.

Use \`/matches\` to see today's matches and place new bets!`
      );
      return;
    }

    // Get wallet address for calculating winnings
    const walletAddress = await getSmartAccountFromUserId(bot, {
      userId: userId as `0x${string}`,
    });

    if (!walletAddress) {
      await handler.sendMessage(
        channelId,
        "❌ Couldn't retrieve your wallet address. Please try again."
      );
      return;
    }

    let totalClaimable = 0n;
    let message = `💰 **Your Unclaimed Winnings**\n\n`;

    for (const bet of claimableBets) {
      try {
        // Get bet amount from contract
        const onChainBet = await contractService.getUserBet(
          bet.on_chain_match_id,
          walletAddress
        );

        if (onChainBet && onChainBet.amount > 0n && !onChainBet.claimed) {
          // Calculate potential winnings
          const winnings = await contractService.calculatePotentialWinnings(
            bet.on_chain_match_id,
            bet.prediction,
            onChainBet.amount
          );

          if (winnings && winnings > 0n) {
            const profit = winnings - onChainBet.amount;
            totalClaimable += winnings;

            const matchCode =
              bet.match_code || `#${bet.daily_id || bet.match_id}`;
            message += `**${bet.home_team} vs ${bet.away_team}** (${matchCode})\n`;
            message += `├ Competition: ${bet.competition}\n`;
            message += `├ Your Pick: ${formatOutcome(bet.prediction)} ✅\n`;
            message += `├ Stake: ${formatEth(onChainBet.amount)} ETH\n`;
            message += `├ Payout: ${formatEth(winnings)} ETH\n`;
            message += `└ Profit: ${formatEth(profit)} ETH\n\n`;
          }
        }
      } catch (error) {
        console.error(
          `Error calculating winnings for match ${bet.match_id}:`,
          error
        );
        // Continue with other matches even if one fails
      }
    }

    if (totalClaimable === 0n) {
      await handler.sendMessage(
        channelId,
        `📭 **No Unclaimed Winnings**

Your winning bets may have already been claimed or there was an issue calculating payouts.

Use \`/stats\` to see your betting history.`
      );
      return;
    }

    message += `━━━━━━━━━━━━━━━━━\n`;
    message += `**Total Claimable:** ${formatEth(totalClaimable)} ETH\n\n`;

    // Show first match code as example
    const firstMatch = claimableBets[0];
    const exampleCode =
      firstMatch.match_code || `${firstMatch.daily_id || firstMatch.match_id}`;
    message += `Use \`/claim ${exampleCode}\` to claim winnings from a specific match.`;

    await handler.sendMessage(channelId, message);
  } catch (error) {
    console.error("Error in /claimable command:", error);
    await handler.sendMessage(
      channelId,
      "❌ An error occurred while fetching your claimable winnings. Please try again or contact support."
    );
  }
});

// /claim_all - Claim all unclaimed winnings (sends individual transactions for each match)
bot.onSlashCommand("claim_all", async (handler, { channelId, userId }) => {
  try {
    // Check if contract is available
    if (!contractService.isContractAvailable()) {
      await handler.sendMessage(
        channelId,
        "❌ Smart contract is not yet deployed. Please contact the admin."
      );
      return;
    }

    // Get all claimable bets for the user
    const claimableBets = db.getClaimableBets(userId);

    if (claimableBets.length === 0) {
      await handler.sendMessage(
        channelId,
        `📭 **No Unclaimed Winnings**

You don't have any unclaimed winnings at the moment.

Use \`/matches\` to see today's matches and place new bets!`
      );
      return;
    }

    // Get wallet address
    const walletAddress = await getSmartAccountFromUserId(bot, {
      userId: userId as `0x${string}`,
    });

    if (!walletAddress) {
      await handler.sendMessage(
        channelId,
        "❌ Couldn't retrieve your wallet address. Please try again."
      );
      return;
    }

    // Filter for actual claimable bets and collect match IDs
    const claimableMatches: Array<{
      matchId: number;
      onChainMatchId: number;
      homeTeam: string;
      awayTeam: string;
    }> = [];

    for (const bet of claimableBets) {
      try {
        const onChainBet = await contractService.getUserBet(
          bet.on_chain_match_id,
          walletAddress
        );

        if (onChainBet && onChainBet.amount > 0n && !onChainBet.claimed) {
          claimableMatches.push({
            matchId: bet.match_id,
            onChainMatchId: bet.on_chain_match_id,
            homeTeam: bet.home_team,
            awayTeam: bet.away_team,
          });
        }
      } catch (error) {
        console.error(
          `Error checking claim status for match ${bet.match_id}:`,
          error
        );
      }
    }

    if (claimableMatches.length === 0) {
      await handler.sendMessage(
        channelId,
        `📭 **No Claimable Matches**

All your winnings may have already been claimed.

Use \`/stats\` to see your betting history.`
      );
      return;
    }

    // For now, inform user about individual claims
    // Future enhancement: batch claims in one transaction
    let message = `💰 **Claim All Winnings**\n\n`;
    message += `You have **${claimableMatches.length}** match${
      claimableMatches.length !== 1 ? "es" : ""
    } with unclaimed winnings:\n\n`;

    for (let i = 0; i < claimableMatches.length; i++) {
      const match = claimableMatches[i];
      message += `${i + 1}. ${match.homeTeam} vs ${match.awayTeam}\n`;
    }

    message += `\n⚠️ **Note:** You'll need to sign ${
      claimableMatches.length
    } separate transaction${claimableMatches.length !== 1 ? "s" : ""}.\n\n`;
    message += `**Options:**\n`;
    message += `• Use \`/claim <match #>\` to claim from specific matches\n`;
    message += `• React with 👍 below to proceed with claiming all\n\n`;
    message += `_Batch claiming in a single transaction is coming soon!_`;

    await handler.sendMessage(channelId, message);

    // Note: Full implementation would listen for reaction and send all transactions
    // For now, user should use /claim individually or we can add confirmation flow
  } catch (error) {
    console.error("Error in /claim_all command:", error);
    await handler.sendMessage(
      channelId,
      "❌ An error occurred while processing your claim request. Please try again or contact support."
    );
  }
});

// /stats - Show user stats
bot.onSlashCommand("stats", async (handler, { channelId, userId }) => {
  const stats = db.getUserStats(userId);
  const userBets = db.getUserBets(userId);

  if (!stats || stats.total_bets === 0) {
    await handler.sendMessage(
      channelId,
      `📊 **Your Stats**

You haven't placed any bets yet!

Use \`/matches\` to see today's matches and start betting.`
    );
    return;
  }

  // Count unique wallets used for betting
  const uniqueWallets = new Set(userBets.map((bet) => bet.wallet_address));
  const walletCount = uniqueWallets.size;
  const walletInfo = walletCount > 1 ? ` (across ${walletCount} wallets)` : "";

  const winRate =
    stats.total_bets > 0
      ? ((stats.total_wins / stats.total_bets) * 100).toFixed(1)
      : "0";

  const profitNum = parseFloat(stats.profit);
  const profitEmoji = profitNum >= 0 ? "📈" : "📉";

  const message = `📊 **Your Stats**${walletInfo} — ${truncateAddress(userId)}

🎯 **Performance:**
• Total Bets: ${stats.total_bets}
• Wins: ${stats.total_wins}
• Win Rate: ${winRate}%

💰 **Financials:**
• Total Wagered: ${formatEth(stats.total_wagered)} ETH
• Total Won: ${formatEth(stats.total_won)} ETH
• ${profitEmoji} Profit: ${formatEth(stats.profit)} ETH`;

  await handler.sendMessage(channelId, message);
});

// /leaderboard - Show top bettors
bot.onSlashCommand("leaderboard", async (handler, { channelId }) => {
  const leaders = db.getLeaderboard(10);

  if (leaders.length === 0) {
    await handler.sendMessage(
      channelId,
      "🏆 No bets placed yet. Be the first on the leaderboard!"
    );
    return;
  }

  let message = "🏆 **Top Bettors (by Profit)**\n\n";
  const medals = ["🥇", "🥈", "🥉"];

  for (let i = 0; i < leaders.length; i++) {
    const leader = leaders[i];
    const rank = i < 3 ? medals[i] : `${i + 1}.`;
    const profit = formatEth(leader.profit);
    const profitNum = parseFloat(leader.profit);
    const profitSign = profitNum >= 0 ? "+" : "";

    message += `${rank} ${truncateAddress(leader.user_address)}\n`;
    message += `   ${profitSign}${profit} ETH | ${leader.total_wins}/${leader.total_bets} wins\n`;
  }

  await handler.sendMessage(channelId, message);
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

// /migrate_matches - Admin command to regenerate match codes
bot.onSlashCommand(
  "migrate_matches",
  async (handler, { channelId, userId }) => {
    try {
      // Get all matches without match codes
      const allMatches = db.getAllMatches();
      const matchesWithoutCodes = allMatches.filter((m) => !m.match_code);

      if (matchesWithoutCodes.length === 0) {
        await handler.sendMessage(
          channelId,
          `✅ **All matches already have match codes!**

Total matches in database: ${allMatches.length}
Matches with codes: ${allMatches.length}

No migration needed.`
        );
        return;
      }

      await handler.sendMessage(
        channelId,
        `🔄 **Starting Match Code Migration**

Found ${matchesWithoutCodes.length} matches without match codes.
Generating codes now...`
      );

      // Regenerate match codes for all matches
      let successCount = 0;
      let errorCount = 0;

      for (const match of matchesWithoutCodes) {
        try {
          // Use existing daily_id if available, otherwise use match id
          const dailyId = match.daily_id || match.id;
          const matchCode = db.generateMatchCode(match.kickoff_time, dailyId);

          // Update the match with the new code
          const updateStmt = db["db"].prepare(`
          UPDATE matches
          SET match_code = ?
          WHERE id = ?
        `);

          try {
            updateStmt.run(matchCode, match.id);
            successCount++;
          } catch (error) {
            // If match_code collision (unlikely), use match id as fallback
            const fallbackCode = db.generateMatchCode(
              match.kickoff_time,
              match.id
            );
            updateStmt.run(fallbackCode, match.id);
            successCount++;
          }
        } catch (error) {
          console.error(`Error migrating match ${match.id}:`, error);
          errorCount++;
        }
      }

      await handler.sendMessage(
        channelId,
        `✅ **Migration Complete!**

Successfully migrated: ${successCount} matches
Errors: ${errorCount}
Total matches in database: ${allMatches.length}

All matches now have persistent match codes in format: YYYYMMDD-N
Example: 20260112-1 (first match on Jan 12, 2026)`
      );

      console.log(
        `✅ Match code migration completed by ${userId}: ${successCount} success, ${errorCount} errors`
      );
    } catch (error) {
      console.error("Error in /migrate_matches command:", error);
      await handler.sendMessage(
        channelId,
        "❌ Failed to migrate match codes. Check bot logs for details."
      );
    }
  }
);

// ==================== INTERACTION HANDLERS ====================

// Handle button clicks and form submissions
bot.onInteractionResponse(async (handler, event) => {
  const { response, channelId, userId } = event;

  // Handle form interactions (buttons)
  if (response.payload.content?.case === "form") {
    const form = response.payload.content.value;
    const requestId = form.requestId;

    // Check if this is a claim interaction (starts with "claim-")
    // Claim interactions are NOT stored in pending_bets, so skip that check
    const isClaimInteraction = requestId.startsWith("claim-");

    // Only check pending_bets for bet confirmations (not claims)
    let pendingBet = null;
    if (!isClaimInteraction) {
      // Find the pending bet for this interaction
      pendingBet = db.getPendingBetByInteractionId(requestId);

      if (!pendingBet) {
        await handler.sendMessage(
          channelId,
          "❌ Bet expired or already processed. Please place a new bet with `/bet`."
        );
        return;
      }
    }

    // Find which button was clicked
    for (const component of form.components) {
      if (component.component.case === "button") {
        // Handle confirm button
        if (component.id === "confirm") {
          // Confirm button should only be for bet confirmations, not claims
          if (!pendingBet) {
            await handler.sendMessage(
              channelId,
              "❌ Bet expired or already processed. Please place a new bet with `/bet`."
            );
            return;
          }

          // Get the match
          const match = db.getMatchById(pendingBet.match_id);
          if (!match) {
            db.clearPendingBet(userId);
            await handler.sendMessage(
              channelId,
              "❌ Match no longer available."
            );
            return;
          }

          // Check if betting is still open
          if (!isBettingOpen(match.kickoff_time)) {
            db.clearPendingBet(userId);
            await handler.sendMessage(
              channelId,
              "❌ Betting is now closed for this match."
            );
            return;
          }

          // Check if contract is available
          if (!contractService.isContractAvailable()) {
            db.clearPendingBet(userId);
            await handler.sendMessage(
              channelId,
              "❌ Smart contract is not yet deployed. Please try again once the contract is live."
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

              await handler.sendMessage(channelId, userMessage);
              // Don't clear pending bet - user can retry
              return;
            }

            // Success - we have a match ID
            if (!result.matchId) {
              await handler.sendMessage(
                channelId,
                "❌ Match creation succeeded but no match ID returned. Please contact support."
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
              `✅ Match created on-chain! Now sending your bet transaction...`
            );
          }

          // At this point, onChainMatchId must be set
          if (!onChainMatchId) {
            await handler.sendMessage(
              channelId,
              "❌ Match ID not available. Please try again."
            );
            return;
          }

          // Generate transaction for user to sign
          const calldata = contractService.encodePlaceBet(
            onChainMatchId,
            pendingBet.prediction
          );

          const amount = parseEth(pendingBet.amount);

          const txId = `tx-${onChainMatchId}-${userId}-${Date.now()}`;

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
            hexToBytes(userId as `0x${string}`) // recipient
          );

          await handler.sendMessage(
            channelId,
            "✅ **Transaction Request Sent!**\n\nPlease sign the transaction in your wallet.\n\n_I'll confirm once the transaction is mined._"
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

          await handler.sendMessage(channelId, "✅ Bet cancelled.");

          console.log(
            "  - Cancel complete, user should be able to place new bet"
          );
          return;
        }

        // Handle claim confirm button
        if (component.id === "claim-confirm") {
          // Parse match ID from interaction ID (format: claim-{matchId}-{userId}-{timestamp})
          const parts = requestId.split("-");
          if (parts.length < 2 || parts[0] !== "claim") {
            await handler.sendMessage(
              channelId,
              "❌ Invalid claim request. Please try again with `/claim`."
            );
            return;
          }

          const matchId = parseInt(parts[1]);
          const match = db.getMatchById(matchId);

          if (!match) {
            await handler.sendMessage(
              channelId,
              "❌ Match no longer available."
            );
            return;
          }

          if (!match.on_chain_match_id) {
            await handler.sendMessage(
              channelId,
              "❌ Match not found on-chain."
            );
            return;
          }

          // Get user's bet
          const userBet = db.getUserBetForMatch(userId, matchId);

          if (!userBet) {
            await handler.sendMessage(
              channelId,
              "❌ You don't have a bet on this match."
            );
            return;
          }

          // Double-check not already claimed
          if (userBet.claimed === 1) {
            await handler.sendMessage(
              channelId,
              "✅ You've already claimed winnings for this match."
            );
            return;
          }

          // Generate transaction for user to sign
          const calldata = contractService.encodeClaimWinnings(
            match.on_chain_match_id
          );

          const txId = `claim-tx-${
            match.on_chain_match_id
          }-${userId}-${Date.now()}`;

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
                    to: contractService.getContractAddress(),
                    value: "0", // No ETH sent for claims
                    data: calldata,
                  },
                },
              },
            } as any,
            hexToBytes(userId as `0x${string}`)
          );

          await handler.sendMessage(
            channelId,
            "✅ **Transaction Request Sent!**\n\nPlease sign the transaction in your wallet to claim your winnings.\n\n_I'll confirm once the transaction is mined._"
          );

          return;
        }

        // Handle claim cancel button
        if (component.id === "claim-cancel") {
          await handler.sendMessage(channelId, "✅ Claim cancelled.");
          return;
        }

        // Handle refund confirm button
        if (component.id === "refund-confirm") {
          // Parse match ID from interaction ID (format: claim_refund-{matchId}-{userId}-{timestamp})
          const parts = requestId.split("-");
          if (
            parts.length < 3 ||
            parts[0] !== "claim" ||
            parts[1] !== "refund"
          ) {
            await handler.sendMessage(
              channelId,
              "❌ Invalid refund request. Please try again with `/claim_refund`."
            );
            return;
          }

          const matchId = parseInt(parts[2]);
          const match = db.getMatchById(matchId);

          if (!match) {
            await handler.sendMessage(
              channelId,
              "❌ Match no longer available."
            );
            return;
          }

          if (!match.on_chain_match_id) {
            await handler.sendMessage(
              channelId,
              "❌ Match not found on-chain."
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
              "❌ Couldn't retrieve your wallet address. Please try again."
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
              }`
            );
            return;
          }

          // Generate transaction for user to sign
          const calldata = contractService.encodeClaimRefund(
            match.on_chain_match_id
          );

          const txId = `refund-tx-${
            match.on_chain_match_id
          }-${userId}-${Date.now()}`;

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
            hexToBytes(userId as `0x${string}`)
          );

          await handler.sendMessage(
            channelId,
            "✅ **Transaction Request Sent!**\n\nPlease sign the transaction in your wallet to claim your refund.\n\n_I'll confirm once the transaction is mined._"
          );

          return;
        }

        // Handle refund cancel button
        if (component.id === "refund-cancel") {
          await handler.sendMessage(channelId, "✅ Refund claim cancelled.");
          return;
        }
      }
    }
  }

  // Handle transaction responses
  if (response.payload.content?.case === "transaction") {
    const txResponse = response.payload.content.value;

    if (txResponse.txHash) {
      const txHash = txResponse.txHash;

      // Send immediate confirmation
      await handler.sendMessage(
        channelId,
        `⏳ **Transaction Submitted!**

Waiting for confirmation on Base...

🔗 [View on Basescan](https://basescan.org/tx/${txHash})`
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
                      // Calculate winnings (bet amount is stored as string in DB)
                      const betAmount = parseEth(userBet.amount);
                      const winnings =
                        await contractService.calculatePotentialWinnings(
                          onChainMatchId,
                          userBet.prediction,
                          betAmount
                        );

                      const profit =
                        winnings && winnings > betAmount
                          ? winnings - betAmount
                          : 0n;

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
                      db.createBet(
                        userId,
                        bettorWallet,
                        pendingBet.match_id,
                        match.on_chain_match_id,
                        pendingBet.prediction,
                        pendingBet.amount,
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

  // Default response
  await handler.sendMessage(
    channelId,
    "Hey! Use `/help` to see what I can do. 🎯⚽"
  );
});

// ==================== HELPER FUNCTIONS ====================

function getCompetitionEmoji(code: string): string {
  const emojiMap: Record<string, string> = {
    PL: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    PD: "🇪🇸",
    BL1: "🇩🇪",
    SA: "🇮🇹",
    FL1: "🇫🇷",
    CL: "🏆",
  };
  return emojiMap[code] || "⚽";
}

/*//////////////////////////////////////////////////////////////
                         DEBUG SLASH COMMANDS
    //////////////////////////////////////////////////////////////*/

// /debug - Comprehensive debug information
bot.onSlashCommand("debug", async (handler, { channelId }) => {
  try {
    const [
      isManager,
      version,
      owner,
      nextMatchId,
      stakeLimits,
      platformFee,
      accumulatedFees,
      botBalance,
    ] = await Promise.all([
      contractService.isBotMatchManager(),
      contractService.getVersion(),
      contractService.getOwner(),
      contractService.getNextMatchId(),
      contractService.getStakeLimits(),
      contractService.getPlatformFeeBps(),
      contractService.getAccumulatedFees(),
      contractService.getBotBalance(),
    ]);

    const message = `🔧 **Debug Information**

**Bot Addresses:**
• Signer (EOA): \`${contractService.getBotAddress()}\`
• Treasury (Smart Account): \`${contractService.getBotTreasuryAddress()}\`
• Balance: ${formatEth(botBalance)} ETH

**Contract Info:**
• Address: \`${contractService.getContractAddress()}\`
• Version: ${version || "❌ Failed to read"}
• Owner: \`${owner ? truncateAddress(owner) : "❌ Failed to read"}\`

**Bot Status:**
• Is Match Manager: ${isManager ? "✅ Yes" : "❌ No"}
• Can Create Matches: ${isManager ? "✅ Yes" : "❌ No"}

**Contract Config:**
• Next Match ID: ${nextMatchId}
• Min Stake: ${formatEth(stakeLimits.min)} ETH
• Max Stake: ${formatEth(stakeLimits.max)} ETH
• Platform Fee: ${platformFee ? Number(platformFee) / 100 : "?"}%
• Accumulated Fees: ${accumulatedFees ? formatEth(accumulatedFees) : "?"} ETH

**RPC:**
• URL: ${config.chain.rpcUrl}

${
  !isManager
    ? "\n⚠️ **WARNING:** Bot is NOT a match manager! Contract interactions will fail."
    : ""
}`;

    await handler.sendMessage(channelId, message);
  } catch (error) {
    console.error("Debug command error:", error);
    await handler.sendMessage(
      channelId,
      `❌ Failed to fetch debug info: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
});

// /checkmanager - Check if bot is match manager
bot.onSlashCommand("checkmanager", async (handler, { channelId }) => {
  try {
    const isManager = await contractService.isBotMatchManager();
    const botAddress = contractService.getBotTreasuryAddress();

    const message = `🔍 **Match Manager Check**

**Bot Treasury Address:**
\`${botAddress}\`

**Status:**
${
  isManager
    ? "✅ Bot IS registered as a match manager"
    : "❌ Bot is NOT registered as a match manager"
}

${
  !isManager
    ? `\n**To fix this, run:**
\`\`\`bash
cast send ${contractService.getContractAddress()} \\
  "addMatchManager(address)" ${botAddress} \\
  --rpc-url $BASE_RPC_URL \\
  --private-key $OWNER_PRIVATE_KEY
\`\`\``
    : ""
}`;

    await handler.sendMessage(channelId, message);
  } catch (error) {
    console.error("Check manager error:", error);
    await handler.sendMessage(
      channelId,
      `❌ Failed to check manager status: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
});

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
bot.onSlashCommand("botinfo", async (handler, { channelId }) => {
  try {
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

// /testread - Test reading from contract
bot.onSlashCommand("testread", async (handler, { channelId }) => {
  try {
    await handler.sendMessage(channelId, "🔄 Testing contract read...");

    const startTime = Date.now();
    const nextMatchId = await contractService.getNextMatchId();
    const duration = Date.now() - startTime;

    const message = `✅ **Contract Read Test Successful**

**Function:** \`nextMatchId()\`
**Result:** ${nextMatchId}
**Duration:** ${duration}ms
**RPC:** ${config.chain.rpcUrl}

This confirms the bot can read from the contract! 🎉`;

    await handler.sendMessage(channelId, message);
  } catch (error) {
    console.error("Test read error:", error);
    await handler.sendMessage(
      channelId,
      `❌ **Contract Read Test Failed**

**Error:** ${error instanceof Error ? error.message : "Unknown error"}

This means the bot cannot read from the contract. Check:
• Contract address is correct
• RPC URL is accessible
• Contract is deployed at the address`
    );
  }
});

// /testcreate - Test creating a match (requires manager role)
bot.onSlashCommand("testcreate", async (handler, { channelId }) => {
  try {
    // Check if bot is manager first
    const isManager = await contractService.isBotMatchManager();
    if (!isManager) {
      await handler.sendMessage(
        channelId,
        `❌ **Cannot Test Match Creation**

Bot is not registered as a match manager.
Use \`/checkmanager\` for instructions on how to fix this.`
      );
      return;
    }

    await handler.sendMessage(
      channelId,
      "🔄 Testing match creation on-chain...\nThis will create a test match with kickoff in 24 hours."
    );

    const kickoffTime = Math.floor(Date.now() / 1000) + 86400; // 24 hours from now
    const result = await contractService.createMatch(
      "Test Team A",
      "Test Team B",
      "Test League",
      kickoffTime
    );

    if (!result) {
      await handler.sendMessage(
        channelId,
        `❌ **Match Creation Failed**

Check the bot logs for details.
Possible issues:
• Insufficient gas in treasury
• Transaction reverted
• RPC issues`
      );
      return;
    }

    const message = `✅ **Match Creation Test Successful!**

**Match ID:** ${result.matchId}
**Transaction:** \`${result.txHash}\`
**Teams:** Test Team A vs Test Team B
**Kickoff:** ${formatTime(kickoffTime)}

**View on BaseScan:**
https://basescan.org/tx/${result.txHash}

This confirms the bot can write to the contract! 🎉

⚠️ This was a test match. You may want to cancel it using the contract's \`cancelMatch\` function.`;

    await handler.sendMessage(channelId, message);
  } catch (error) {
    console.error("Test create error:", error);
    await handler.sendMessage(
      channelId,
      `❌ **Match Creation Test Failed**

**Error:** ${error instanceof Error ? error.message : "Unknown error"}

Check:
• Bot has match manager role
• Treasury has sufficient ETH for gas
• RPC is working
• Contract is not paused`
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

**Usage:** \`/resolve <match#>\`

**Example:** \`/resolve 1\`

Use \`/matches\` to see today's match numbers.`
      );
      return;
    }

    const matchNum = parseInt(args[0]);

    // Validate match number
    if (isNaN(matchNum) || matchNum < 1) {
      await handler.sendMessage(
        channelId,
        "❌ Invalid match number. Use `/matches` to see available matches."
      );
      return;
    }

    // Get match by daily ID
    const match = db.getMatchByDailyId(matchNum);

    if (!match) {
      await handler.sendMessage(
        channelId,
        `❌ Match #${matchNum} not found for today. Use \`/matches\` to see available matches.`
      );
      return;
    }

    // Check if match has on-chain ID
    if (!match.on_chain_match_id) {
      await handler.sendMessage(
        channelId,
        `❌ **Cannot Resolve Match**

**Match #${matchNum}:** ${match.home_team} vs ${match.away_team}

This match hasn't been created on-chain yet (no bets placed).`
      );
      return;
    }

    // Check if already resolved
    if (match.status === "FINISHED" && match.result !== null) {
      await handler.sendMessage(
        channelId,
        `ℹ️ **Match Already Resolved**

**Match #${matchNum}:** ${match.home_team} vs ${match.away_team}
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
      await handler.sendMessage(
        channelId,
        `❌ **Match Not Finished**

**Match #${matchNum}:** ${match.home_team} vs ${match.away_team}
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
    await handler.sendMessage(
      channelId,
      `✅ **Match Resolved Successfully**

🏁 **${match.home_team} ${homeScore} - ${awayScore} ${match.away_team}**

**Result:** ${formatOutcome(outcome)}
💰 **Total Pool:** ${totalPool} ETH
🔗 **Transaction:** \`${result.txHash}\`

Winners can now claim their winnings using \`/claim ${matchNum}\``
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

// Start the scheduler for automated tasks
startScheduler(bot, contractService);

console.log("🎯 MatchDay Bet Bot started!");
console.log(`📝 Contract: ${config.contract.address}`);

export default app;
