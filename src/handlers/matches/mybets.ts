/**
 * /mybets command handler
 * Show user's bets
 */

import { getSmartAccountFromUserId } from "@towns-protocol/bot";
import type {
  CommandHandler,
  BaseCommandEvent,
  HandlerContext,
} from "../types";
import { db } from "../../db";
import { getThreadMessageOpts } from "../../utils/threadRouter";
import {
  formatEth,
  formatOutcome,
  formatDateTime,
  truncateAddress,
} from "../../utils/format";

export const createMyBetsHandler = (
  context: HandlerContext
): CommandHandler<BaseCommandEvent> => {
  return async (handler, { channelId, userId, eventId, threadId }) => {
    const opts = getThreadMessageOpts(threadId, eventId);
    console.log(`[/mybets] Fetching bets for user ${userId}`);

    // Get all user's bets from DB
    const userBets = db.getUserBets(userId);

    if (userBets.length === 0) {
      await handler.sendMessage(
        channelId,
        "📋 **My Bets**\n\nYou don't have any active bets.\n\nUse `/matches` to browse available matches and place a bet!",
        opts
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
        const smartAccount = await getSmartAccountFromUserId(context.bot, {
          userId: userId as `0x${string}`,
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

      // Categorize bets by match status
      const liveBets: typeof bets = [];
      const pendingBets: typeof bets = [];
      const finishedBets: typeof bets = [];

      for (const bet of bets) {
        const match = db.getMatchById(bet.match_id);
        if (!match) continue;

        // Categorize based on match status
        const matchStatus = match.status.toUpperCase();
        if (
          matchStatus === "IN_PLAY" ||
          matchStatus === "PAUSED" ||
          matchStatus === "HALFTIME"
        ) {
          liveBets.push(bet);
        } else if (
          matchStatus === "FINISHED" ||
          matchStatus === "POSTPONED" ||
          matchStatus === "CANCELLED"
        ) {
          finishedBets.push(bet);
        } else {
          // SCHEDULED, TIMED, etc.
          pendingBets.push(bet);
        }
      }

      // Display Live Matches
      if (liveBets.length > 0) {
        message += "🔴 **Live Matches**\n\n";
        for (const bet of liveBets) {
          const match = db.getMatchById(bet.match_id);
          if (!match) continue;

          const prediction = formatOutcome(bet.prediction);
          const amount = formatEth(bet.amount);
          const matchCode =
            match.match_code || `#${match.daily_id || match.id}`;

          // Format: "Inter 1-1 Napoli (20260111-8) 🔴 LIVE"
          const score =
            match.home_score !== null && match.away_score !== null
              ? `${match.home_score}-${match.away_score}`
              : "vs";
          message += `• **${match.home_team} ${score} ${match.away_team}** (${matchCode}) 🔴 LIVE\n`;
          message += `  Pick: ${prediction} | Stake: ${amount} ETH | ⏳ In Progress\n\n`;
          totalBets++;
        }
      }

      // Display Pending Matches
      if (pendingBets.length > 0) {
        message += "⏳ **Pending Matches**\n\n";
        for (const bet of pendingBets) {
          const match = db.getMatchById(bet.match_id);
          if (!match) continue;

          const prediction = formatOutcome(bet.prediction);
          const amount = formatEth(bet.amount);
          const matchCode =
            match.match_code || `#${match.daily_id || match.id}`;
          const kickoffFormatted = formatDateTime(match.kickoff_time);

          message += `• **${match.home_team} vs ${match.away_team}** (${matchCode})\n`;
          message += `  Kickoff: ${kickoffFormatted} | Pick: ${prediction} | Stake: ${amount} ETH\n\n`;
          totalBets++;
        }
      }

      // Display Finished Matches
      if (finishedBets.length > 0) {
        message += "✅ **Finished Matches**\n\n";
        for (const bet of finishedBets) {
          const match = db.getMatchById(bet.match_id);
          if (!match) continue;

          const prediction = formatOutcome(bet.prediction);
          const amount = formatEth(bet.amount);
          const matchCode =
            match.match_code || `#${match.daily_id || match.id}`;
          const status =
            match.status === "FINISHED"
              ? bet.prediction === match.result
                ? "🎉 WON"
                : "❌ LOST"
              : match.status === "POSTPONED"
              ? "⚠️ POSTPONED"
              : "❌ CANCELLED";

          // Format: "Juventus 3-1 Cremonese (20260112-2)"
          const score =
            match.home_score !== null && match.away_score !== null
              ? `${match.home_score}-${match.away_score}`
              : "vs";
          message += `• **${match.home_team} ${score} ${match.away_team}** (${matchCode})\n`;
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
    }

    message += `━━━━━━━━━━━━━━━━━\n`;
    message += `**Total:** ${totalBets} bet${
      totalBets !== 1 ? "s" : ""
    } across ${betsByWallet.size} wallet${betsByWallet.size !== 1 ? "s" : ""}`;

    await handler.sendMessage(channelId, message, opts);
  };
};
