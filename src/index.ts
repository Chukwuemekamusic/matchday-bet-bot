import { makeTownsBot } from "@towns-protocol/bot";
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
• \`/confirm\` - Confirm your pending bet
• \`/cancel\` - Cancel your pending bet

**Your Bets:**
• \`/mybets\` - Show your active bets
• \`/claim <match#>\` - Claim winnings for a match

**Stats:**
• \`/stats\` - Show your betting stats
• \`/leaderboard\` - Show top bettors

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
  let displayId = 1;

  for (const [competition, compMatches] of grouped) {
    const emoji = getCompetitionEmoji(compMatches[0].competition_code);
    message += `${emoji} **${competition}**\n`;

    for (const match of compMatches) {
      const time = formatTime(match.kickoff_time);
      const countdown = timeUntilKickoff(match.kickoff_time);
      const pool = match.on_chain_match_id ? formatEth(match.total_pool) : "0";
      const status = isBettingOpen(match.kickoff_time) ? "🟢" : "🔴";

      message += `${status} #${displayId} ${match.home_team} vs ${match.away_team}\n`;
      message += `   ⏰ ${time} (${countdown}) | 💰 ${pool} ETH\n`;
      displayId++;
    }
    message += "\n";
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

  const matches = db.getTodaysMatches();
  if (matchNum > matches.length) {
    await handler.sendMessage(
      channelId,
      `❌ Match #${matchNum} not found. Use \`/matches\` to see available matches.`
    );
    return;
  }

  const match = matches[matchNum - 1];

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

📊 **Current Odds:**
• Home (${match.home_team}): ${formatOdds(odds.home)} — Pool: ${formatEth(
    pools.home
  )} ETH
• Draw: ${formatOdds(odds.draw)} — Pool: ${formatEth(pools.draw)} ETH
• Away (${match.away_team}): ${formatOdds(odds.away)} — Pool: ${formatEth(
    pools.away
  )} ETH

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
  if (args.length < 3) {
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

  // Validate match number
  if (isNaN(matchNum) || matchNum < 1) {
    await handler.sendMessage(
      channelId,
      "❌ Invalid match number. Use `/matches` to see available matches."
    );
    return;
  }

  // Get match
  const matches = db.getTodaysMatches();
  if (matchNum > matches.length) {
    await handler.sendMessage(
      channelId,
      `❌ Match #${matchNum} not found. Use \`/matches\` to see available matches.`
    );
    return;
  }

  const match = matches[matchNum - 1];

  // Check if betting is still open
  if (!isBettingOpen(match.kickoff_time)) {
    await handler.sendMessage(
      channelId,
      "❌ Betting is closed for this match. Kickoff has passed."
    );
    return;
  }

  // Parse prediction
  const prediction = parseOutcome(predictionStr);
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
  } catch {
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
      potentialWinnings = `\n💸 Potential Payout: ~${formatEth(potential)} ETH`;
    }
  }

  const message = `⚽ **Bet Confirmation Required**

**Match:** ${match.home_team} vs ${match.away_team}
**Your Pick:** ${predictionDisplay}
**Stake:** ${amountStr} ETH
${potentialWinnings}

⚠️ This will transfer ${amountStr} ETH from your wallet.

Reply \`/confirm\` to place this bet
Reply \`/cancel\` to cancel

_This pending bet expires in 5 minutes._`;

  await handler.sendMessage(channelId, message);
});

// /confirm - Confirm pending bet (step 2)
bot.onSlashCommand("confirm", async (handler, { channelId, userId }) => {
  const pending = db.getPendingBet(userId);

  if (!pending) {
    await handler.sendMessage(
      channelId,
      "❌ No pending bet found. Use `/bet` to place a new bet."
    );
    return;
  }

  const match = db.getMatchById(pending.match_id);
  if (!match) {
    db.clearPendingBet(userId);
    await handler.sendMessage(channelId, "❌ Match no longer available.");
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
    // Clear pending bet
    db.clearPendingBet(userId);

    const predictionDisplay = formatOutcome(pending.prediction);

    const message = `⏳ **Bet Pending Contract Deployment**

**Match:** ${match.home_team} vs ${match.away_team}
**Your Pick:** ${predictionDisplay}
**Stake:** ${pending.amount} ETH

The betting smart contract is not yet deployed to Base mainnet.

🚀 **What's Next:**
• Your bet selection has been noted
• Once the contract is live, you'll be able to place bets
• We'll announce when betting goes live!

Stay tuned! In the meantime, you can:
• Browse upcoming matches with \`/matches\`
• Check your stats with \`/stats\`
• View the leaderboard with \`/leaderboard\`

_Thank you for your patience as we prepare for launch! ⚡_`;

    await handler.sendMessage(channelId, message);
    return;
  }

  // Create match on-chain if not exists
  let onChainMatchId = match.on_chain_match_id;
  if (!onChainMatchId) {
    const result = await contractService.createMatch(
      match.home_team,
      match.away_team,
      match.competition,
      match.kickoff_time
    );

    if (!result) {
      await handler.sendMessage(
        channelId,
        "❌ Failed to create match on-chain. Please try again."
      );
      return;
    }

    onChainMatchId = result.matchId;
    db.setOnChainMatchId(match.id, onChainMatchId);
    console.log(`Match ${match.id} created on-chain with ID ${onChainMatchId}`);
  }

  // Clear pending bet
  db.clearPendingBet(userId);

  const predictionDisplay = formatOutcome(pending.prediction);

  const message = `✅ **Bet Ready to Submit!**

**Match:** ${match.home_team} vs ${match.away_team}
**Your Pick:** ${predictionDisplay}
**Stake:** ${pending.amount} ETH

📝 **Transaction Details:**
• Contract: \`${contractService.getContractAddress()}\`
• Match ID: ${onChainMatchId}
• Value: ${pending.amount} ETH

Please sign the transaction in your wallet to complete the bet.

_Note: The bot will detect your transaction and confirm once processed._`;

  await handler.sendMessage(channelId, message);

  // Record the bet attempt in stats
  db.recordBet(userId, pending.amount);
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

  const matches = db.getTodaysMatches();
  const bets: { match: DBMatch; bet: any }[] = [];

  for (const match of matches) {
    if (match.on_chain_match_id) {
      const bet = await contractService.getUserBet(
        match.on_chain_match_id,
        userId
      );
      if (bet && bet.amount > 0n) {
        bets.push({ match, bet });
      }
    }
  }

  if (bets.length === 0) {
    await handler.sendMessage(
      channelId,
      "📋 You haven't placed any bets today.\n\nUse `/matches` to see available matches!"
    );
    return;
  }

  let message = "📋 **Your Bets Today**\n\n";

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
    for (const match of matches) {
      const dbMatch = FootballAPIService.toDBMatch(match);
      const existing = db.getMatchByApiId(match.id);

      db.upsertMatch({
        ...dbMatch,
        on_chain_match_id: null,
        result: null,
        total_pool: "0",
        resolved_at: null,
        posted_to_towns: false,
      });

      if (!existing) newCount++;
    }

    await handler.sendMessage(
      channelId,
      `✅ Fetched ${matches.length} matches (${newCount} new)`
    );
  } catch (error) {
    await handler.sendMessage(
      channelId,
      "❌ Failed to fetch matches. Check API configuration."
    );
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

const app = bot.start();

// Add discovery endpoint for bot directories
app.get("/.well-known/agent-metadata.json", async (c) => {
  return c.json(await bot.getIdentityMetadata());
});

// Start the scheduler for automated tasks
startScheduler(bot, contractService);

console.log("🎯 MatchDay Bet Bot started!");
console.log(`📝 Contract: ${config.contract.address}`);

export default app;
