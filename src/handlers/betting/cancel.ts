/**
 * /cancel command handler
 * Cancel pending bet
 */

import type { CommandHandler, BaseCommandEvent } from "../types";
import { db } from "../../db";
import { getThreadMessageOpts } from "../../utils/threadRouter";

export const handleCancel: CommandHandler<BaseCommandEvent> = async (
  handler,
  { channelId, userId, eventId, threadId }
) => {
  const opts = getThreadMessageOpts(threadId, eventId);
  const pending = db.getPendingBet(userId);

  if (!pending) {
    await handler.sendMessage(
      channelId,
      "❌ No pending bet to cancel.",
      opts
    );
    return;
  }

  db.clearPendingBet(userId);
  await handler.sendMessage(channelId, "✅ Pending bet cancelled.", opts);
};

