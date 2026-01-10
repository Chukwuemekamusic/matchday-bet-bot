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

    // Check if user already bet on this match (if on-chain and contract available)
    if (match.on_chain_match_id && contractService.isContractAvailable()) {
      const hasBet = await contractService.hasUserBet(
        match.on_chain_match_id,
        userId
      );
      if (hasBet) {
        await handler.sendMessage(
          channelId,
          "❌ You've already placed a bet on this match."
        );
        return;
      }
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
  // Check if contract is available
  if (!contractService.isContractAvailable()) {
    await handler.sendMessage(
      channelId,
      `📋 **My Bets**

Your bet history will be available once the smart contract is deployed.

In the meantime:
• Use \`/matches\` to browse upcoming matches
• Use \`/bet\` to practice the betting flow
• Use \`/stats\` to track your activity

Stay tuned for the contract launch! 🚀`
    );
    return;
  }

  console.log(`[/mybets] Fetching bets for user ${userId}`);

  // Get user's smart account address (bets are recorded under smart account, not EOA)
  let userSmartAccount: `0x${string}`;
  try {
    const smartAccountResult = await getSmartAccountFromUserId(bot, { userId });
    if (!smartAccountResult) {
      console.error(`[/mybets] Smart account not found for ${userId}`);
      await handler.sendMessage(
        channelId,
        "❌ Failed to retrieve your wallet information. Please try again."
      );
      return;
    }
    userSmartAccount = smartAccountResult;
    console.log(`[/mybets] User EOA: ${userId}`);
    console.log(`[/mybets] User Smart Account: ${userSmartAccount}`);
  } catch (error) {
    console.error(
      `[/mybets] Failed to get smart account for ${userId}:`,
      error
    );
    await handler.sendMessage(
      channelId,
      "❌ Failed to retrieve your wallet information. Please try again."
    );
    return;
  }

  const matches = db.getTodaysMatches();
  console.log(`[/mybets] Found ${matches.length} matches today`);

  const bets: { match: DBMatch; bet: any }[] = [];

  for (const match of matches) {
    if (match.on_chain_match_id) {
      try {
        const bet = await contractService.getUserBet(
          match.on_chain_match_id,
          userSmartAccount // Use smart account address instead of EOA
        );
        console.log(
          `[/mybets] Match ${match.on_chain_match_id} (${match.home_team} vs ${
            match.away_team
          }): ${bet ? `bet found (${bet.amount})` : "no bet"}`
        );
        if (bet && bet.amount > 0n) {
          bets.push({ match, bet });
        }
      } catch (error) {
        console.error(
          `[/mybets] Failed to get bet for match ${match.on_chain_match_id}:`,
          error
        );
        // Continue checking other matches rather than failing completely
      }
    }
  }

  console.log(`[/mybets] Displaying ${bets.length} bets for user ${userId}`);

  if (bets.length === 0) {
    await handler.sendMessage(
      channelId,
      "📋 **My Bets**\n\nYou don't have any active bets on today's matches.\n\nUse `/matches` to browse available matches and place a bet!"
    );
    return;
  }

  let message = "📋 **Your Active Bets**\n\n";

  for (const { match, bet } of bets) {
    const prediction = formatOutcome(bet.prediction);
    const amount = formatEth(bet.amount);
    const status =
      match.status === "FINISHED"
        ? bet.prediction === match.result
          ? "🎉 WON"
          : "❌ LOST"
        : "⏳ Pending";

    message += `**${match.home_team} vs ${match.away_team}**\n`;
    message += `• Pick: ${prediction} | Stake: ${amount} ETH\n`;
    message += `• Status: ${status}`;

    if (
      match.status === "FINISHED" &&
      bet.prediction === match.result &&
      !bet.claimed
    ) {
      message += " — Use `/claim` to collect!";
    }
    message += "\n\n";
  }

  await handler.sendMessage(channelId, message);
});

// /claim - Claim winnings
bot.onSlashCommand("claim", async (handler, { channelId }) => {
  const message = `💰 **Claiming Winnings**

To claim your winnings, you'll need to call the \`claimWinnings\` function on the contract.

Contract: \`${contractService.getContractAddress()}\`

Use your wallet to interact with the contract directly, or wait for wallet integration in a future update.`;

  await handler.sendMessage(channelId, message);
});

// /stats - Show user stats
bot.onSlashCommand("stats", async (handler, { channelId, userId }) => {
  const stats = db.getUserStats(userId);

  if (!stats || stats.total_bets === 0) {
    await handler.sendMessage(
      channelId,
      `📊 **Your Stats**

You haven't placed any bets yet!

Use \`/matches\` to see today's matches and start betting.`
    );
    return;
  }

  const winRate =
    stats.total_bets > 0
      ? ((stats.total_wins / stats.total_bets) * 100).toFixed(1)
      : "0";

  const profitNum = parseFloat(stats.profit);
  const profitEmoji = profitNum >= 0 ? "📈" : "📉";

  const message = `📊 **Your Stats** — ${truncateAddress(userId)}

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

  // Handle form interactions (buttons)
  if (response.payload.content?.case === "form") {
    const form = response.payload.content.value;
    const requestId = form.requestId;

    // Find the pending bet for this interaction
    const pendingBet = db.getPendingBetByInteractionId(requestId);

    if (!pendingBet) {
      await handler.sendMessage(
        channelId,
        "❌ Bet expired or already processed. Please place a new bet with `/bet`."
      );
      return;
    }

    // Find which button was clicked
    for (const component of form.components) {
      if (component.component.case === "button") {
        // Handle confirm button
        if (component.id === "confirm") {
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
          // Get match info from the pending bet (if still available)
          const pendingBet = db.getPendingBet(userId);
          let matchInfo = "";

          if (pendingBet) {
            const match = db.getMatchById(pendingBet.match_id);
            if (match) {
              const predictionDisplay = formatOutcome(pendingBet.prediction);
              matchInfo = `\n\n**Match:** ${match.home_team} vs ${match.away_team}\n**Your Prediction:** ${predictionDisplay}\n**Stake:** ${pendingBet.amount} ETH`;

              // Record the bet in user stats
              db.recordBet(userId, pendingBet.amount);

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
