/**
 * Claim-all cancel button handler
 * Handles the "Cancel" button click for claim-all interactions
 */

import type { ButtonHandler } from "../types";

export const handleClaimAllCancelButton: ButtonHandler = async (
  handler,
  event,
  context,
) => {
  const { channelId, threadId } = event;
  const opts = threadId ? { threadId } : undefined;

  await handler.sendMessage(channelId, "✅ Claim-all cancelled.", opts);
};
