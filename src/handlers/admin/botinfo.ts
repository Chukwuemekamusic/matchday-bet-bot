import type {
  CommandHandler,
  CommandEventWithArgs,
  HandlerContext,
} from "../types";
import { getThreadMessageOpts } from "../../utils/threadRouter";
import { isUserAdmin } from "../../utils/wallet";
import { db } from "../../db";
import { formatEth } from "../../utils/format";

export const createBotInfoHandler = (
  context: HandlerContext
): CommandHandler<CommandEventWithArgs> => {
  return async (handler, { channelId, args, eventId, threadId, userId }) => {
    const opts = getThreadMessageOpts(threadId, eventId);

    try {
      // Check if user is admin
      if (!(await isUserAdmin(context.bot, userId as `0x${string}`))) {
        await handler.sendMessage(
          channelId,
          "❌ **Access Denied**\n\nThis command is only available to the bot administrator."
        );
        return;
      }
      const balance = await context.contractService.getBotBalance();
      const signerAddress = context.contractService.getBotAddress();
      const treasuryAddress = context.contractService.getBotTreasuryAddress();

      const message = `🤖 **Bot Wallet Information**

**Signer Address (EOA):**
\`${signerAddress}\`
• This address signs transactions
• View: https://basescan.org/address/${signerAddress}

**Treasury Address (Smart Account):**
\`${treasuryAddress}\`
• This address executes transactions and holds funds
• Balance: ${formatEth(balance)} ETH
• View: https://basescan.org/address/${treasuryAddress}

${
  balance < BigInt(10 ** 15)
    ? "\n⚠️ **WARNING:** Low balance! Fund the treasury address to enable contract interactions."
    : ""
}`;

      await handler.sendMessage(channelId, message, opts);
    } catch (error) {
      console.error("Bot info error:", error);
      await handler.sendMessage(
        channelId,
        `❌ Failed to fetch bot info: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        opts
      );
    }
  };
};
