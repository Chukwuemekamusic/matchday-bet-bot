/**
 * /pending command handler
 * Check pending bet status
 */

import type { CommandHandler, BaseCommandEvent } from "../types";
import { db } from "../../db";
import { getThreadMessageOpts } from "../../utils/threadRouter";
import { formatOutcome } from "../../utils/format";

export const handlePending: CommandHandler<BaseCommandEvent> = async (
  handler,
  { channelId, userId, eventId, threadId }
) => {
  const opts = getThreadMessageOpts(threadId, eventId);
  const pending = db.getPendingBet(userId);

  if (!pending) {
    await handler.sendMessage(
      channelId,
      "ℹ️ You don't have any pending bets.\n\nUse `/bet` to place a new bet!",
      opts
    );
    return;
  }

  const match = db.getMatchById(pending.match_id);
  if (!match) {
    await handler.sendMessage(
      channelId,
      "❌ Your pending bet references a match that no longer exists.",
      opts
    );
    db.clearPendingBet(userId);
    return;
  }

  const predictionDisplay = formatOutcome(pending.prediction);
  const expiresIn = Math.max(
    0,
    pending.expires_at - Math.floor(Date.now() / 1000)
  );
  const expiresMinutes = Math.floor(expiresIn / 60);
  const expiresSeconds = expiresIn % 60;

  const message = `⏳ **Your Pending Bet**

**Match:** ${match.home_team} vs ${match.away_team}
**Your Pick:** ${predictionDisplay}
**Stake:** ${pending.amount} ETH

**Expires in:** ${expiresMinutes}m ${expiresSeconds}s

To complete your bet, click the "Confirm & Sign" button in the message above.
To cancel, use \`/cancel\`.`;

  await handler.sendMessage(channelId, message, opts);
};

