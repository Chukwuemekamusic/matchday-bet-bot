import type {
  CommandHandler,
  CommandEventWithArgs,
  HandlerContext,
} from "../types";
import { getThreadMessageOpts } from "../../utils/threadRouter";
import { isUserAdmin } from "../../utils/wallet";
import { db } from "../../db";

// get the database match id and on-chain match id from the match code
export const createMatchIdHandler = (
  context: HandlerContext,
): CommandHandler<CommandEventWithArgs> => {
  return async (handler, { channelId, args, eventId, threadId, userId }) => {
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

      // Parse arguments
      if (args.length !== 1) {
        await handler.sendMessage(
          channelId,
          `❌ **Invalid Usage**

**Usage:** \`/matchid <match_code>\`

**Example:** \`/matchid 20260111-2\``,
          opts,
        );
        return;
      }

      const [matchCode] = args;

      const match = db.getMatchByMatchCode(matchCode);

      if (!match) {
        await handler.sendMessage(
          channelId,
          `❌ **Match Not Found**

**Match Code:** \`${matchCode}\`

**Error:** Match not found in database.`,
          opts,
        );
        return;
      }

      await handler.sendMessage(
        channelId,
        `**Match ID:** ${match.id} | **On-Chain ID:** ${match.on_chain_match_id}`,
        opts,
      );
    } catch (error) {
      console.error("Error in /matchid command:", error);
      await handler.sendMessage(
        channelId,
        "❌ **An error occurred**\n\nPlease try again or contact support.",
        opts,
      );
    }
  };
};
