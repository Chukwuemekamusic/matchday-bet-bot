import type {
  CommandHandler,
  CommandEventWithArgs,
  HandlerContext,
} from "../types";
import { db } from "../../db";
import { isUserAdmin } from "../../utils/wallet";
import { getThreadMessageOpts } from "../../utils/threadRouter";

export const createClearPostedHandler = (
  context: HandlerContext,
): CommandHandler<CommandEventWithArgs> => {
  return async (handler, { channelId, args, userId, eventId, threadId }) => {
    const opts = getThreadMessageOpts(threadId, eventId);
    try {
      // Check if user is admin
      if (!(await isUserAdmin(context.bot, userId as `0x${string}`))) {
        await handler.sendMessage(
          channelId,
          "❌ **Access Denied**\n\nThis command is only available to the bot administrator.",
          opts,
        );
        return;
      }

      // Parse date argument (default to today)
      const targetDate =
        args.length > 0 ? args[0] : new Date().toISOString().split("T")[0];

      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
        await handler.sendMessage(
          channelId,
          "❌ **Invalid Date Format**\n\nUse YYYY-MM-DD format. Example: `/clearposted 2026-01-21`",
          opts,
        );
        return;
      }

      // Check if there are any records to delete
      const morningPosted = db.hasBeenPosted(targetDate, "morning");
      const noonPosted = db.hasBeenPosted(targetDate, "noon");

      if (!morningPosted && !noonPosted) {
        await handler.sendMessage(
          channelId,
          `ℹ️ **No Records Found**\n\nNo posted announcements found for ${targetDate}.`,
          opts,
        );
        return;
      }

      // Delete records for this date
      // We need to access the database directly since db doesn't have a delete method
      const deleteStmt = (db as any).db.prepare(
        "DELETE FROM posted_messages WHERE match_date = ?",
      );
      const result = deleteStmt.run(targetDate);

      const records = [];
      if (morningPosted) records.push("morning");
      if (noonPosted) records.push("noon");

      await handler.sendMessage(
        channelId,
        `✅ **Cleared Posted Records**\n\nDeleted ${result.changes} record(s) for ${targetDate}:\n${records.map((r) => `  - ${r}`).join("\n")}\n\nYou can now use \`/post morning\` or \`/post noon\` to post announcements for this date.`,
        opts,
      );
    } catch (error) {
      console.error("❌ Error in /clearposted command:", error);
      await handler.sendMessage(
        channelId,
        "❌ **Failed to Clear Records**\n\nCheck the bot logs for details.",
        opts,
      );
    }
  };
};
