/**
 * Claim confirm button handler
 * Handles the "Confirm" button click for claiming winnings
 */

import { db } from "../../../db";
import { interactionService } from "../../../services/interactions";
import type { ButtonHandler } from "../types";

export const handleClaimConfirmButton: ButtonHandler = async (
  handler,
  event,
  context,
) => {
  const { channelId, userId, requestId, threadId } = event;
  const opts = threadId ? { threadId } : undefined;

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
  const calldata = context.contractService.encodeClaimWinnings(
    match.on_chain_match_id
  );
  console.log("  - calldata:", calldata);

  // Encode threadId in transaction ID for later retrieval
  const txId = `claim-tx-${match.on_chain_match_id}-${userId.slice(
    0,
    8
  )}-${threadId || "none"}`;
  console.log("  - txId:", txId);

  const contractAddress = context.contractService.getContractAddress();
  console.log("  - contract address:", contractAddress);

  console.log("📤 [CLAIM-CONFIRM] Sending transaction request...");
  console.log("  - Using threading opts:", opts);

  try {
    // Send transaction request to user using service
    await interactionService.sendTransactionInteraction(
      handler,
      channelId,
      userId,
      {
        id: txId,
        title: `Claim Winnings: ${match.home_team} vs ${match.away_team}`,
        chainId: "8453", // Base mainnet
        to: contractAddress,
        value: "0", // No ETH sent for claims
        data: calldata,
        signerWallet: userBet.wallet_address, // Pre-select wallet that placed the bet
      },
      opts?.threadId
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
};
