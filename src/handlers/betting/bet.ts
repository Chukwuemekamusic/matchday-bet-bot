/**
 * /bet command handler
 * Place a bet (step 1: create pending bet)
 */

import { hexToBytes } from "viem";
import type {
  CommandHandler,
  CommandEventWithArgs,
  HandlerContext,
} from "../types";
import { db } from "../../db";
import { getThreadMessageOpts } from "../../utils/threadRouter";
import { retryWithBackoff } from "../../utils/retry";
import {
  formatEth,
  parseEth,
  parseOutcome,
  truncateAddress,
  isBettingOpen,
} from "../../utils/format";
import { Outcome } from "../../types";
import { config } from "../../config";

export const createBetHandler = (
  context: HandlerContext
): CommandHandler<CommandEventWithArgs> => {
  return async (handler, { channelId, args, userId, eventId, threadId }) => {
    const opts = getThreadMessageOpts(threadId, eventId);

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
Example: \`/bet 1 home 0.01\``,
          opts
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
          "❌ Invalid match number. Use `/matches` to see available matches.",
          opts
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
          `❌ Match #${matchNum} not found for today. Use \`/matches\` to see available matches.`,
          opts
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
          "❌ Betting is closed for this match. Kickoff has passed.",
          opts
        );
        return;
      }

      // Parse prediction
      const prediction = parseOutcome(predictionStr);
      console.log("🎲 Prediction parsed:", prediction, "from", predictionStr);

      if (prediction === null) {
        await handler.sendMessage(
          channelId,
          "❌ Invalid prediction. Use: home, draw, or away",
          opts
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
          "❌ Invalid amount. Enter a number like 0.01",
          opts
        );
        return;
      }

      const minStake = parseEth(config.betting.minStake);
      const maxStake = parseEth(config.betting.maxStake);

      if (amount < minStake) {
        await handler.sendMessage(
          channelId,
          `❌ Minimum bet is ${config.betting.minStake} ETH`,
          opts
        );
        return;
      }

      if (amount > maxStake) {
        await handler.sendMessage(
          channelId,
          `❌ Maximum bet is ${config.betting.maxStake} ETH`,
          opts
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
        \n\nNote: You can only bet once per match. Use "/mybets" to view your active bets.`,
          opts
        );
        return;
      }

      // Create pending bet (store threadId for later use in interaction responses)
      db.createPendingBet(userId, match.id, prediction, amountStr, eventId);

      const predictionDisplay =
        prediction === Outcome.HOME
          ? `${match.home_team} Win (Home)`
          : prediction === Outcome.DRAW
          ? "Draw"
          : `${match.away_team} Win (Away)`;

      // Calculate potential winnings if match is on-chain and contract available
      let potentialWinnings = "";
      if (
        match.on_chain_match_id &&
        context.contractService.isContractAvailable()
      ) {
        const potential =
          await context.contractService.calculatePotentialWinnings(
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

      // Send interactive message with buttons (with retry for network errors)
      try {
        console.log("📤 Attempting to send interaction request...");
        console.log("  - channelId:", channelId);
        console.log("  - interactionId:", interactionId);
        console.log("  - userId:", userId);

        await retryWithBackoff(
          async () => {
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
              hexToBytes(userId as `0x${string}`), // recipient
              opts // threading options
            );
          },
          3, // max retries
          1000 // base delay (1s)
        );

        console.log("✅ Interaction request sent successfully");
      } catch (error) {
        console.error("❌ Failed to send interaction request:", error);
        console.error("Error details:", JSON.stringify(error, null, 2));

        // Check if it's a network error
        const isNetworkError =
          error &&
          typeof error === "object" &&
          "code" in error &&
          (error.code === 9 || error.code === 14 || error.code === 4);

        // Fallback: send simple message
        await handler.sendMessage(
          channelId,
          `⚽ **Bet Saved!**

**Match:** ${match.home_team} vs ${match.away_team}
**Your Pick:** ${predictionDisplay}
**Stake:** ${amountStr} ETH

${
  isNetworkError
    ? "❌ Network error - Towns Protocol nodes are experiencing issues. Your bet is saved and will expire in 5 minutes. Please try again in a few moments."
    : "❌ Interactive buttons are not working. Please check the error logs or try again later."
}

_This pending bet expires in 5 minutes._`,
          opts
        );
      }
    } catch (error) {
      console.error("❌ FATAL ERROR in /bet handler:", error);
      console.error("Stack trace:", error);

      try {
        await handler.sendMessage(
          channelId,
          "❌ An unexpected error occurred. Please try again or contact support.",
          opts
        );
      } catch (msgError) {
        console.error("❌ Failed to send error message:", msgError);
      }
    }
  };
};
