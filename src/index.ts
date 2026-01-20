import { makeTownsBot, getSmartAccountFromUserId } from "@towns-protocol/bot";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import commands from "./commands";
import { db } from "./db";
import { ContractService, CONTRACT_ABI } from "./services/contract";
import { footballApi, FootballAPIService } from "./services/footballApi";
import { subgraphService } from "./services/subgraph";
import { MatchOperationsService } from "./services/matchOperations";
import { matchLookup } from "./services/matchLookup";
import { interactionService, InteractionType } from "./services/interactions";
import {
  formatEth,
  parseEth,
  truncateAddress,
  formatOutcome,
} from "./utils/format";
import { config } from "./config";
import { startScheduler } from "./scheduler";
import {
  getLinkedWallets,
  getLinkedWalletsExcludingSmartAccount,
} from "./utils/wallet";
import {
  handleHelp,
  createBetHandler,
  handlePending,
  handleCancel,
  handleMatches,
  handleActive,
  createOddsHandler,
  createMyBetsHandler,
  createWinnersHandler,
  createClaimHandler,
  createClaimableHandler,
  createClaimAllHandler,
  createStatsHandler,
  createFetchHandler,
  createPostHandler,
  handleLeaderboard,
  createDBCheckHandler,
  createMigrateHandler,
  createBotInfoHandler,
  createVerifyHandler,
  createClaimRefundHandler,
  createContractInfoHandler,
  createUserHasBetHandler,
  createResolveHandler,
  createSyncMatchesHandler,
  handleConfirmButton,
  handleClaimCancelButton,
  handleClaimAllCancelButton,
  handleRefundCancelButton,
  handleClaimConfirmButton,
  handleClaimAllConfirmButton,
  handleRefundConfirmButton,
  type HandlerContext,
} from "./handlers";

const bot = await makeTownsBot(
  process.env.APP_PRIVATE_DATA!,
  process.env.JWT_SECRET!,
  {
    commands,
  },
);

// Log SDK version info for debugging
console.log("📦 SDK Information:");
console.log("  - @towns-protocol/bot: 0.0.453");
console.log("  - viem:", "2.29.3");
console.log("  - Bot initialized successfully");

// Create public client for reading blockchain data (balance checks, etc.)
const publicClient = createPublicClient({
  chain: base,
  transport: http(config.chain.rpcUrl),
});

// Initialize services with bot instance
const contractService = new ContractService(bot);
const matchOps = new MatchOperationsService(contractService);

// Create handler context for dependency injection
const handlerContext: HandlerContext = {
  bot,
  contractService,
  matchOps,
  subgraphService,
  publicClient,
};

// ==================== BOT HANDLERS ====================

// /help - Show available commands
bot.onSlashCommand("help", handleHelp);

// /matches - Show today's matches
bot.onSlashCommand("matches", handleMatches);

// /odds - Show odds for a match
bot.onSlashCommand("odds", createOddsHandler(handlerContext));

// /active - Show matches with active betting pools
bot.onSlashCommand("active", handleActive);

// /bet - Place a bet (step 1: create pending bet)
bot.onSlashCommand("bet", createBetHandler(handlerContext));

// /pending - Check pending bet status
bot.onSlashCommand("pending", handlePending);

// /cancel - Cancel pending bet
bot.onSlashCommand("cancel", handleCancel);

// /mybets - Show user's bets
bot.onSlashCommand("mybets", createMyBetsHandler(handlerContext));

// /verify - Verify and sync bets with on-chain state
bot.onSlashCommand("verify", createVerifyHandler(handlerContext));

// /claim_refund - Claim refund from a cancelled match
bot.onSlashCommand("claim_refund", createClaimRefundHandler(handlerContext));

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
bot.onSlashCommand("winners", createWinnersHandler(handlerContext));

// /fetch - Admin command to manually fetch matches
bot.onSlashCommand("fetch", createFetchHandler(handlerContext));

// /post - Admin command to manually post announcements
bot.onSlashCommand("post", createPostHandler(handlerContext));

// /dbcheck - Admin command to check database connectivity
bot.onSlashCommand("dbcheck", createDBCheckHandler(handlerContext));

// /migrate - Temporary command to migrate existing on-chain bets to DB
bot.onSlashCommand("migrate", createMigrateHandler(handlerContext));

// ==================== INTERACTION HANDLERS ====================

// Handle button clicks and form submissions
bot.onInteractionResponse(async (handler, event) => {
  const { response, channelId, userId } = event;

  console.log("🔔 [INTERACTION] Received interaction response");
  console.log("  - userId:", userId);
  console.log("  - channelId:", channelId);
  console.log(
    "  - response.payload.content?.case:",
    response.payload.content?.case,
  );

  // Handle form interactions (buttons)
  if (response.payload.content?.case === "form") {
    const form = response.payload.content.value;
    const requestId = form.requestId;

    console.log("📋 [INTERACTION] Form interaction detected");
    console.log("  - requestId:", requestId);
    console.log("  - form.components.length:", form.components.length);

    // Use interaction service to check if this is a claim interaction
    const isClaimInteraction = interactionService.isClaimInteraction(requestId);

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
      // For claim/claim_refund interactions, parse threadId from requestId using service
      const metadata = interactionService.parseInteractionId(requestId);
      if (metadata) {
        threadId = metadata.threadId;
      }
    }

    // Create threading opts (BEFORE any sendMessage calls)
    const opts = threadId ? { threadId } : undefined;

    // Now check if pending bet exists (for non-claim interactions)
    if (!isClaimInteraction && !pendingBet) {
      await handler.sendMessage(
        channelId,
        "❌ Bet expired or already processed. Please place a new bet with `/bet`.",
        opts,
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
          // Delegate to separate confirm button handler
          await handleConfirmButton(
            handler,
            {
              response: response,
              channelId,
              userId,
              requestId,
              components: form.components,
              threadId,
            },
            handlerContext,
          );
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
              : "NONE FOUND",
          );

          db.clearPendingBet(userId);

          // Verify it's actually cleared
          const checkCleared = db.getPendingBet(userId);
          console.log(
            "  - Pending bet after clear:",
            checkCleared ? "❌ STILL EXISTS!" : "✅ Successfully cleared",
          );

          await handler.sendMessage(channelId, "✅ Bet cancelled.", opts);

          console.log(
            "  - Cancel complete, user should be able to place new bet",
          );
          return;
        }

        // Handle claim confirm button
        if (component.id === "claim-confirm") {
          await handleClaimConfirmButton(
            handler,
            {
              response: response,
              channelId,
              userId,
              requestId,
              components: form.components,
              threadId,
            },
            handlerContext,
          );
          return;
        }

        // Handle claim cancel button
        if (component.id === "claim-cancel") {
          await handleClaimCancelButton(
            handler,
            {
              response: response,
              channelId,
              userId,
              requestId,
              components: form.components,
              threadId,
            },
            handlerContext,
          );
          return;
        }

        // Handle claim-all confirm button
        if (component.id === "claim-all-confirm") {
          await handleClaimAllConfirmButton(
            handler,
            {
              response: response,
              channelId,
              userId,
              requestId,
              components: form.components,
              threadId,
            },
            handlerContext,
          );
          return;
        }

        // Handle claim-all cancel button
        if (component.id === "claim-all-cancel") {
          await handleClaimAllCancelButton(
            handler,
            {
              response: response,
              channelId,
              userId,
              requestId,
              components: form.components,
              threadId,
            },
            handlerContext,
          );
          return;
        }

        // Handle refund confirm button
        if (component.id === "refund-confirm") {
          await handleRefundConfirmButton(
            handler,
            {
              response: response,
              channelId,
              userId,
              requestId,
              components: form.components,
              threadId,
            },
            handlerContext,
          );
          return;
        }

        // Handle refund cancel button
        if (component.id === "refund-cancel") {
          await handleRefundCancelButton(
            handler,
            {
              response: response,
              channelId,
              userId,
              requestId,
              components: form.components,
              threadId,
            },
            handlerContext,
          );
          return;
        }
      }
    }
  }

  // Handle transaction responses
  if (response.payload.content?.case === "transaction") {
    const txResponse = response.payload.content.value;

    console.log("💳 [TRANSACTION] Received transaction response");
    console.log("  - userId:", userId);
    console.log("  - requestId:", txResponse.requestId);
    console.log("  - txHash:", txResponse.txHash || "NONE");

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
      console.log("✅ [TRANSACTION] Transaction hash received:", txHash);

      // Send immediate confirmation
      await handler.sendMessage(
        channelId,
        `⏳ **Transaction Submitted!**

Waiting for confirmation on Base...

🔗 [View on Basescan](https://basescan.org/tx/${txHash})`,
        opts,
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
                          `Could not parse WinningsClaimed event for match ${onChainMatchId}, using bet amount as fallback`,
                        );
                      }

                      // Update database
                      db.updateBetClaimed(userId, match.id);

                      // Record win in user stats
                      if (winnings) {
                        db.recordWin(
                          userId,
                          formatEth(winnings),
                          formatEth(profit),
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
                        },
                      );

                      console.log(
                        `✅ Claim confirmed for ${userId}: ${txHash}, profit: ${formatEth(
                          profit,
                        )} ETH`,
                      );
                    } catch (error) {
                      console.error(
                        "Error processing claim confirmation:",
                        error,
                      );
                      await handler.sendMessage(
                        channelId,
                        `✅ **Claim Transaction Confirmed!**

Your winnings have been claimed. Check your wallet to see the payout.

🔗 [Transaction](https://basescan.org/tx/${txHash})`,
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

🔗 [Transaction](https://basescan.org/tx/${txHash})`,
                    );
                  }
                } else {
                  // No bet found in DB, but transaction succeeded
                  await handler.sendMessage(
                    channelId,
                    `✅ **Claim Transaction Confirmed!**

Your winnings have been claimed successfully!

🔗 [Transaction](https://basescan.org/tx/${txHash})`,
                  );
                }
              } else {
                // Match not found, but transaction succeeded
                await handler.sendMessage(
                  channelId,
                  `✅ **Claim Transaction Confirmed!**

Your claim was successful! Check your wallet.

🔗 [Transaction](https://basescan.org/tx/${txHash})`,
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
                    },
                  );

                  console.log(
                    `✅ Refund confirmed for ${userId}: ${txHash}, amount: ${formatEth(
                      refundAmount,
                    )} ETH`,
                  );
                } else {
                  // No bet found in DB, but transaction succeeded
                  await handler.sendMessage(
                    channelId,
                    `✅ **Refund Transaction Confirmed!**

Your refund has been processed successfully!

🔗 [Transaction](https://basescan.org/tx/${txHash})`,
                  );
                }
              } else {
                // Match not found, but transaction succeeded
                await handler.sendMessage(
                  channelId,
                  `✅ **Refund Transaction Confirmed!**

Your refund was successful! Check your wallet.

🔗 [Transaction](https://basescan.org/tx/${txHash})`,
                );
              }
            }
          }

          if (!isClaimTx && !isRefundTx) {
            // Handle bet transaction (existing logic)
            console.log("🎯 [BET TX] Processing bet transaction confirmation");
            const pendingBet = db.getPendingBet(userId);
            console.log("  - pendingBet found:", !!pendingBet);

            let matchInfo = "";

            if (pendingBet) {
              const match = db.getMatchById(pendingBet.match_id);
              console.log("  - match found:", !!match);

              if (match) {
                console.log("  - match.id:", match.id);
                console.log(
                  "  - match.on_chain_match_id:",
                  match.on_chain_match_id,
                );
                console.log("  - pendingBet.amount:", pendingBet.amount);

                const predictionDisplay = formatOutcome(pendingBet.prediction);
                matchInfo = `\n\n**Match:** ${match.home_team} vs ${match.away_team}\n**Your Prediction:** ${predictionDisplay}\n**Stake:** ${pendingBet.amount} ETH`;

                // Record the bet in user stats
                db.recordBet(userId, pendingBet.amount);
                console.log("✅ [BET TX] Recorded bet in user stats");

                // Record the bet in bets table
                // Determine which wallet placed the bet by checking on-chain
                if (
                  match.on_chain_match_id &&
                  contractService.isContractAvailable()
                ) {
                  try {
                    console.log("🔍 [BET TX] Looking up linked wallets...");
                    const linkedWallets = await getLinkedWallets(
                      bot,
                      userId as `0x${string}`,
                    );
                    console.log(
                      "  - linkedWallets found:",
                      linkedWallets.length,
                    );
                    console.log("  - wallets:", linkedWallets);

                    let bettorWallet: string | null = null;

                    for (const wallet of linkedWallets) {
                      console.log("  - Checking wallet:", wallet);
                      const onChainBet = await contractService.getUserBet(
                        match.on_chain_match_id,
                        wallet,
                      );
                      console.log(
                        "    - onChainBet amount:",
                        onChainBet?.amount || "0",
                      );
                      if (onChainBet && onChainBet.amount > 0n) {
                        bettorWallet = wallet;
                        console.log("  ✅ Found bettor wallet:", wallet);
                        break;
                      }
                    }

                    if (bettorWallet) {
                      // Record bet in database
                      // Convert decimal string to wei string for consistent storage
                      const amountWeiString = parseEth(
                        pendingBet.amount,
                      ).toString();

                      db.createBet(
                        userId,
                        bettorWallet,
                        pendingBet.match_id,
                        match.on_chain_match_id,
                        pendingBet.prediction,
                        amountWeiString,
                        txHash,
                      );
                      console.log(
                        `💾 [BET TX] Bet recorded in DB: ${userId} -> ${truncateAddress(
                          bettorWallet,
                        )}`,
                      );
                    } else {
                      console.warn("⚠️ [BET TX] No bettor wallet found!");
                      console.warn(
                        "  - Bet was placed on-chain but could not determine which wallet",
                      );
                      console.warn(
                        "  - Transaction confirmed but NOT recorded in database",
                      );
                      console.warn(
                        "  - User can run /verify to recover this bet",
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
              },
            );

            console.log(`✅ Bet confirmed for ${userId}: ${txHash}`);
          }
        } else {
          // Transaction failed - provide context-specific error message
          const txId = txResponse.requestId || "";
          const isClaimTx =
            txId.startsWith("claim-tx-") || txId.startsWith("claim-all-");
          const isRefundTx = txId.startsWith("refund-tx-");

          let errorMessage = `❌ **Transaction Failed**\n\n`;

          if (isClaimTx) {
            errorMessage += `Your claim was not processed. The transaction was reverted.\n\n`;
            errorMessage += `💡 **Possible reasons:**\n`;
            errorMessage += `• You may have signed with the wrong wallet\n`;
            errorMessage += `• The bet was already claimed\n`;
            errorMessage += `• The match is not yet resolved\n\n`;
            errorMessage += `Try running \`/claimable\` to see which wallet was used for each bet.`;
          } else if (isRefundTx) {
            errorMessage += `Your refund was not processed. The transaction was reverted.\n\n`;
            errorMessage += `💡 **Possible reasons:**\n`;
            errorMessage += `• You may have signed with the wrong wallet\n`;
            errorMessage += `• The refund was already claimed\n`;
            errorMessage += `• The match is not eligible for refunds\n\n`;
            errorMessage += `Try running \`/claimable\` to see which wallet was used for each bet.`;
          } else {
            errorMessage += `Your bet was not placed. The transaction was reverted.`;

            // Clear pending bet for failed bet transactions so user can retry
            console.log(
              "🧹 [BET TX] Clearing pending bet due to failed transaction",
            );
            db.clearPendingBet(userId);
            errorMessage += `\n\n_Your pending bet has been cleared. You can place a new bet with \`/bet\`._`;
          }

          errorMessage += `\n\n🔗 [View on Basescan](https://basescan.org/tx/${txHash})`;

          await handler.sendMessage(channelId, errorMessage, {
            ...(threadId && { threadId }),
          });

          const txType = isClaimTx ? "Claim" : isRefundTx ? "Refund" : "Bet";
          console.log(
            `❌ ${txType} transaction failed for ${userId}: ${txHash}`,
          );
        }
      } catch (error) {
        console.error("Failed to wait for transaction:", error);
        await handler.sendMessage(
          channelId,
          `⚠️ **Unable to Confirm**

I couldn't verify your transaction status. Please check Basescan:

🔗 [View Transaction](https://basescan.org/tx/${txHash})

Use \`/mybets\` to verify your bet was placed.`,
        );
      }
    }
  }
});

// ==================== MESSAGE HANDLERS ====================

// Handle general messages (mentions, etc.)
bot.onMessage(
  async (handler, { message, channelId, isMentioned, threadId }) => {
    // Only respond to mentions
    if (!isMentioned) return;

    // Stay in thread if message was sent in a thread
    const opts = threadId ? { threadId } : undefined;

    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes("hello") || lowerMessage.includes("hi")) {
      await handler.sendMessage(
        channelId,
        "Hey! 👋 Ready to bet on some football? Use `/matches` to see today's games!",
        opts,
      );
      return;
    }

    if (lowerMessage.includes("help")) {
      await handler.sendMessage(
        channelId,
        "Use `/help` to see all available commands!",
        opts,
      );
      return;
    }

    if (
      lowerMessage.includes("channel id") ||
      lowerMessage.includes("channelid")
    ) {
      await handler.sendMessage(
        channelId,
        `📍 **Channel ID:**\n\`\`\`\n${channelId}\n\`\`\`\n\nAdd this to your \`.env\` file as:\n\`DEFAULT_CHANNEL_ID=${channelId}\``,
        opts,
      );
      return;
    }

    // Default response
    await handler.sendMessage(
      channelId,
      "Hey! Use `/help` to see what I can do. 🎯⚽",
      opts,
    );
  },
);

// ==================== HELPER FUNCTIONS ====================

/*//////////////////////////////////////////////////////////////
                         DEBUG SLASH COMMANDS
    //////////////////////////////////////////////////////////////*/

// /contractinfo - Show contract version and config
bot.onSlashCommand("contractinfo", createContractInfoHandler(handlerContext));

// /botinfo - Show bot wallet info
bot.onSlashCommand("botinfo", createBotInfoHandler(handlerContext));

// /userHasBet - Test if user has bet on a match
bot.onSlashCommand("userHasBet", createUserHasBetHandler(handlerContext));

// /resolve - Admin-only manual match resolution
bot.onSlashCommand("resolve", createResolveHandler(handlerContext));

// /syncmatches - Admin-only match sync
bot.onSlashCommand("syncmatches", createSyncMatchesHandler(handlerContext));

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
