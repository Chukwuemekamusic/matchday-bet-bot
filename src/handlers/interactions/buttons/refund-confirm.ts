/**
 * Refund confirm button handler
 * Handles the "Confirm" button click for claiming refunds
 */

import { getSmartAccountFromUserId } from "@towns-protocol/bot";
import { db } from "../../../db";
import { interactionService } from "../../../services/interactions";
import type { ButtonHandler } from "../types";

export const handleRefundConfirmButton: ButtonHandler = async (
  handler,
  event,
  context,
) => {
  const { channelId, userId, requestId, threadId } = event;
  const opts = threadId ? { threadId } : undefined;

  // Parse match ID from interaction ID (format: claim-refund-{matchId}-{userIdPrefix}-{threadId})
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
  const walletAddress = await getSmartAccountFromUserId(context.bot, {
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
  const eligibility = await context.contractService.isRefundEligible(
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
  const calldata = context.contractService.encodeClaimRefund(
    match.on_chain_match_id
  );

  // Encode threadId in transaction ID for later retrieval
  const txId = `refund-tx-${match.on_chain_match_id}-${userId.slice(
    0,
    8
  )}-${opts?.threadId || "none"}`;

  // Send transaction request to user using service
  await interactionService.sendTransactionInteraction(
    handler,
    channelId,
    userId,
    {
      id: txId,
      title: `Claim Refund: ${match.home_team} vs ${match.away_team}`,
      chainId: "8453", // Base mainnet
      to: context.contractService.getContractAddress(),
      value: "0", // No ETH sent for refunds
      data: calldata,
    },
    opts?.threadId
  );

  await handler.sendMessage(
    channelId,
    "✅ **Transaction Request Sent!**\n\nPlease sign the transaction in your wallet to claim your refund.\n\n_I'll confirm once the transaction is mined._",
    opts
  );
};
