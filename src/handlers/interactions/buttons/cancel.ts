/**
 * Cancel button handler (bet cancellation)
 * Handles the "Cancel" button click for canceling pending bets
 */

import { db } from "../../../db";
import type { ButtonHandler } from "../types";

export const handleCancelButton: ButtonHandler = async (handler, event, context) => {
  const { channelId, userId, requestId, threadId } = event;
  const opts = threadId ? { threadId } : undefined;

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
  console.log("  - Pending bet after clear:", checkCleared ? "STILL EXISTS" : "CLEARED");

  await handler.sendMessage(
    channelId,
    "❌ Bet cancelled. Use `/bet` to place a new bet.",
    opts
  );
};

