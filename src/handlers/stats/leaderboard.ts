/**
 * /leaderboard command handler
 * Show top bettors by profit
 */

import { formatEther } from "viem";
import type { CommandHandler, BaseCommandEvent } from "../types";
import { subgraphService } from "../../services/subgraph";
import { getSmartThreadOpts } from "../../utils/threadRouter";

export const handleLeaderboard: CommandHandler<BaseCommandEvent> = async (
  handler,
  { channelId, threadId }
) => {
  const opts = getSmartThreadOpts(threadId);
  try {
    // Get leaderboard from subgraph (with database fallback)
    const result = await subgraphService.getLeaderboard(10);

    if (result.data.length === 0) {
      await handler.sendMessage(
        channelId,
        "🏆 No bets placed yet. Be the first on the leaderboard!",
        opts
      );
      return;
    }

    let message = "🏆 **Top Bettors (by Profit)**\n\n";

    // Add data source indicator (for debugging)
    if (result.source === "fallback") {
      message += `⚠️ _Using fallback data source_\n\n`;
    }

    const medals = ["🥇", "🥈", "🥉"];

    for (let i = 0; i < result.data.length; i++) {
      const leader = result.data[i];
      const rank = i < 3 ? medals[i] : `${i + 1}.`;

      // Parse profit from subgraph (BigInt as string)
      const profitBigInt = BigInt(leader.totalProfit);
      const profitEth = formatEther(profitBigInt);
      const profitNum = parseFloat(profitEth);
      const profitSign = profitNum >= 0 ? "+" : "";

      const totalBets = parseInt(leader.totalBets);
      const winCount = parseInt(leader.winCount);

      message += `${rank} ${leader.address}\n`;
      message += `   ${profitSign}${profitEth} ETH | ${winCount}/${totalBets} wins\n\n`;
    }

    await handler.sendMessage(channelId, message, opts);
  } catch (error) {
    console.error("Error in /leaderboard command:", error);
    await handler.sendMessage(
      channelId,
      "❌ An error occurred while fetching the leaderboard. Please try again or contact support.",
      opts
    );
  }
};
