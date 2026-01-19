/**
 * Confirm button handler (bet confirmation)
 * Handles the "Confirm & Sign" button click for placing bets
 */

import { formatEther } from "viem";
import { parseEth, isBettingOpen } from "../../../utils/format";
import { db } from "../../../db";
import { interactionService } from "../../../services/interactions";
import {
  getUserWalletBalances,
  validateBetBalance,
  formatBalanceMessage,
} from "../../../utils/balanceValidator";
import type { ButtonHandler } from "../types";

export const handleConfirmButton: ButtonHandler = async (
  handler,
  event,
  context,
) => {
  const { channelId, userId, requestId, threadId } = event;
  let opts = threadId ? { threadId } : undefined;

  console.log("✅ [INTERACTION] 'confirm' button clicked (bet confirmation)");

  // Get pending bet
  const pendingBet = db.getPendingBetByInteractionId(requestId);
  if (!pendingBet) {
    await handler.sendMessage(
      channelId,
      "❌ Bet expired or already processed. Please place a new bet with `/bet`.",
      opts,
    );
    return;
  }

  // Use the thread_id from pending bet (saved when /bet was called)
  // This ensures we send messages to the same thread where the bet was initiated
  if (pendingBet.thread_id) {
    opts = { threadId: pendingBet.thread_id };
  }

  // Get the match
  const match = db.getMatchById(pendingBet.match_id);
  if (!match) {
    db.clearPendingBet(userId);
    await handler.sendMessage(channelId, "❌ Match no longer available.", opts);
    return;
  }

  // Check if betting is still open
  if (!isBettingOpen(match.kickoff_time)) {
    db.clearPendingBet(userId);
    await handler.sendMessage(
      channelId,
      "❌ Betting is now closed for this match.",
      opts,
    );
    return;
  }

  // Check if contract is available
  if (!context.contractService.isContractAvailable()) {
    db.clearPendingBet(userId);
    await handler.sendMessage(
      channelId,
      "❌ Smart contract is not yet deployed. Please try again once the contract is live.",
      opts,
    );
    return;
  }

  // Check user balance before proceeding with match creation
  console.log("💰 [BET CONFIRM] Checking wallet balances...");

  const walletBalances = await getUserWalletBalances(
    context.bot,
    userId,
    context.publicClient,
  );

  const amount = parseEth(pendingBet.amount);
  const validation = validateBetBalance(walletBalances, amount);

  if (!validation.hasValid) {
    console.log("❌ [BET CONFIRM] Insufficient balance in all wallets");

    const balanceMessage = formatBalanceMessage(validation, amount);
    await handler.sendMessage(
      channelId,
      `${balanceMessage}\n\n_Your pending bet is saved. Use \`/cancel\` to cancel._`,
      opts,
    );
    return; // Don't create match or proceed
  }

  // Select wallet with sufficient balance
  const selectedWallet = validation.validWallets[0];
  console.log(
    `✅ [BET CONFIRM] Selected wallet: ${selectedWallet.address} (balance: ${formatEther(selectedWallet.balance)} ETH)`,
  );

  // Create match on-chain if not exists
  let onChainMatchId: number = match.on_chain_match_id ?? 0;
  if (!match.on_chain_match_id) {
    console.log(
      `📝 Match not yet on-chain. Creating match: ${match.home_team} vs ${match.away_team}`,
    );

    const result = await context.contractService.createMatch(
      match.home_team,
      match.away_team,
      match.competition,
      match.kickoff_time,
    );

    // Handle errors with specific messages
    if ("error" in result && result.error) {
      const errorType = result.errorType;
      const errorMsg = result.error;

      console.error(`❌ Match creation failed: ${errorType} - ${errorMsg}`);

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

    // Success - we have a match ID (result.matchId is guaranteed to be a number here)
    onChainMatchId = result.matchId;
    db.setOnChainMatchId(match.id, onChainMatchId);
    console.log(
      `✅ Match ${match.id} created on-chain with ID ${onChainMatchId}, tx: ${result.txHash}`,
    );

    // Notify user that match was created
    await handler.sendMessage(
      channelId,
      `✅ Match created on-chain! Now sending your bet transaction...`,
      opts,
    );
  }

  // At this point, onChainMatchId must be set
  if (!onChainMatchId) {
    await handler.sendMessage(
      channelId,
      "❌ Match ID not available. Please try again.",
      opts,
    );
    return;
  }

  // Generate transaction for user to sign
  const calldata = context.contractService.encodePlaceBet(
    onChainMatchId,
    pendingBet.prediction,
  );

  // TODO: CHECK if this need uncommenting
  // const amount = parseEth(pendingBet.amount);

  // Generate transaction ID
  const txId = `tx-${onChainMatchId}-${userId.slice(0, 8)}-${
    opts?.threadId || "none"
  }`;

  // Send transaction request to user
  await interactionService.sendTransactionInteraction(
    handler,
    channelId,
    userId,
    {
      id: txId,
      title: `Bet on ${match.home_team} vs ${match.away_team}`,
      chainId: "8453", // Base mainnet
      to: context.contractService.getContractAddress(),
      value: amount.toString(),
      data: calldata,
      signerWallet: selectedWallet.address, // Pre-select wallet with sufficient balance
    },
    opts?.threadId,
  );

  await handler.sendMessage(
    channelId,
    "✅ **Transaction Request Sent!**\n\nPlease sign the transaction in your wallet.\n\n_I'll confirm once the transaction is mined._",
    opts,
  );
};
