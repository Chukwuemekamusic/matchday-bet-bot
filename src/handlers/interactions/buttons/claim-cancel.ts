/**
 * Claim cancel button handler
 * Handles the "Cancel" button click for claim interactions
 */

import type { ButtonHandler } from "../types";

export const handleClaimCancelButton: ButtonHandler = async (
  handler,
  event,
  context,
) => {
  const { channelId, threadId } = event;
  const opts = threadId ? { threadId } : undefined;

  await handler.sendMessage(channelId, "✅ Claim cancelled.", opts);
};
