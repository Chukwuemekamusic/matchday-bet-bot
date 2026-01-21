import type {
  CommandHandler,
  CommandEventWithArgs,
  HandlerContext,
} from "../types";
import { db } from "../../db";
import { isUserAdmin } from "../../utils/wallet";
import { AnnouncementService } from "../../services/announcements";
import { getThreadMessageOpts } from "../../utils/threadRouter";

export const createPostHandler = (
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

      // Check if default channel is configured
      const defaultChannelId = process.env.DEFAULT_CHANNEL_ID || null;
      if (!defaultChannelId) {
        await handler.sendMessage(
          channelId,
          "❌ **Announcement Service Not Available**\n\nNo default channel configured in DEFAULT_CHANNEL_ID.",
          opts,
        );
        return;
      }

      // Create announcement service instance
      const announcementService = new AnnouncementService(
        context.bot,
        context.contractService,
        db,
        defaultChannelId,
      );

      // Parse time slot argument (default to 'noon')
      const timeSlot = args.length > 0 ? args[0].toLowerCase() : "noon";

      // Validate time slot
      if (timeSlot !== "morning" && timeSlot !== "noon") {
        await handler.sendMessage(
          channelId,
          "❌ **Invalid Time Slot**\n\nUse 'morning' or 'noon'. Example: `/post noon`",
          opts,
        );
        return;
      }

      // Get today's date
      const today = new Date();
      const matchDate = today.toISOString().split("T")[0];

      // Get today's matches to show count
      const matches = db.getTodaysMatches();

      if (matches.length === 0) {
        await handler.sendMessage(
          channelId,
          `📅 **No Matches Today**\n\nNo matches found for ${matchDate}.`,
          opts,
        );
        return;
      }

      // Post the announcement (manual posting bypasses time-window check)
      await announcementService.postDailyMatchListings(timeSlot, true);

      await handler.sendMessage(
        channelId,
        `✅ **Announcement Posted**\n\nPosted ${timeSlot} match listings for ${matchDate} (${matches.length} matches).`,
        opts,
      );
    } catch (error) {
      console.error("❌ Error in /post command:", error);
      await handler.sendMessage(
        channelId,
        "❌ **Failed to Post Announcement**\n\nCheck the bot logs for details.",
        opts,
      );
    }
  };
};
