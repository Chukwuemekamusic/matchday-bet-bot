/**
 * Refund cancel button handler
 * Handles the "Cancel" button click for refund interactions
 */

import type { ButtonHandler } from "../types";

export const handleRefundCancelButton: ButtonHandler = async (
  handler,
  event,
  context,
) => {
  const { channelId, threadId } = event;
  const opts = threadId ? { threadId } : undefined;

  await handler.sendMessage(channelId, "✅ Refund claim cancelled.", opts);
};
