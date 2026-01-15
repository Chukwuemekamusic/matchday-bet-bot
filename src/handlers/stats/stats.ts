/**
 * /stats command handler
 * Show user betting statistics
 */

import { getSmartAccountFromUserId } from "@towns-protocol/bot";
import { formatEther } from "viem";
import type { CommandHandler, BaseCommandEvent, HandlerContext } from "../types";
import { getThreadMessageOpts } from "../../utils/threadRouter";
import { truncateAddress } from "../../utils/format";
import { subgraphService } from "../../services/subgraph";

export const createStatsHandler = (
  context: HandlerContext
): CommandHandler<BaseCommandEvent> => {
  return async (handler, { channelId, userId, eventId, threadId }) => {
    const opts = getThreadMessageOpts(threadId, eventId);

    try {
      // Get wallet address
      const walletAddress = await getSmartAccountFromUserId(context.bot, {
        userId: userId as `0x${string}`,
      });

      if (!walletAddress) {
        await handler.sendMessage(
          channelId,
          "❌ Couldn't retrieve your wallet address. Please try again.",
          opts
        );
        return;
      }

      // Get stats from subgraph (with database fallback)
      const result = await subgraphService.getUserStats(walletAddress);

      if (!result.data || result.data.totalBets === "0") {
        await handler.sendMessage(
          channelId,
          `📊 **Your Stats**

You haven't placed any bets yet!

Use \`/matches\` to see today's matches and start betting.`,
          opts
        );
        return;
      }

      const stats = result.data;
      const totalBets = parseInt(stats.totalBets);
      const winCount = parseInt(stats.winCount);
      const lossCount = parseInt(stats.lossCount);
      const refundCount = parseInt(stats.refundCount);

      const winRate =
        totalBets > 0 ? ((winCount / totalBets) * 100).toFixed(1) : "0";

      const profitNum = parseFloat(formatEther(BigInt(stats.totalProfit)));
      const profitEmoji = profitNum >= 0 ? "📈" : "📉";

      let message = `📊 **Your Stats** — ${truncateAddress(userId)}\n\n`;

      // Add data source indicator (for debugging)
      if (result.source === "fallback") {
        message += `⚠️ _Using fallback data source_\n\n`;
      }

      message += `🎯 **Performance:**
• Total Bets: ${totalBets}
• Wins: ${winCount}
• Losses: ${lossCount}
• Refunds: ${refundCount}
• Win Rate: ${winRate}%

💰 **Financials:**
• Total Wagered: ${formatEther(BigInt(stats.totalWagered))} ETH
• Total Won: ${formatEther(BigInt(stats.totalWon))} ETH
• Total Claimed: ${formatEther(BigInt(stats.totalClaimed))} ETH
• ${profitEmoji} Profit: ${profitNum.toFixed(4)} ETH`;

      await handler.sendMessage(channelId, message, opts);
    } catch (error) {
      console.error("Error in /stats command:", error);
      await handler.sendMessage(
        channelId,
        "❌ An error occurred while fetching your stats. Please try again or contact support.",
        opts
      );
    }
  };
};

