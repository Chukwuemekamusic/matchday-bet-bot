/**
 * /contractinfo command handler
 * Display contract version and configuration
 */

import type {
  CommandHandler,
  BaseCommandEvent,
  HandlerContext,
} from "../types";
import { getThreadMessageOpts } from "../../utils/threadRouter";
import { formatEth } from "../../utils/format";

export const createContractInfoHandler = (
  context: HandlerContext
): CommandHandler<BaseCommandEvent> => {
  return async (handler, { channelId, userId, eventId, threadId }) => {
    const opts = getThreadMessageOpts(threadId, eventId);

    try {
      // Check if contract is available
      if (!context.contractService.isContractAvailable()) {
        await handler.sendMessage(
          channelId,
          "❌ Smart contract is not yet deployed. Please contact the admin.",
          opts
        );
        return;
      }

      // Fetch contract information
      const [
        version,
        stakeLimits,
        platformFeeBps,
        accumulatedFees,
        owner,
        isBotMatchManager,
      ] = await Promise.all([
        context.contractService.getVersion(),
        context.contractService.getStakeLimits(),
        context.contractService.getPlatformFeeBps(),
        context.contractService.getAccumulatedFees(),
        context.contractService.getOwner(),
        context.contractService.isBotMatchManager(),
      ]);

      const contractAddress = context.contractService.getContractAddress();

      // Calculate platform fee percentage
      const platformFeePercent =
        platformFeeBps !== null ? Number(platformFeeBps) / 100 : null;

      const message = `🔧 **Contract Information**

**Contract Address:**
\`${contractAddress}\`
• View: https://basescan.org/address/${contractAddress}

**Version:** ${version || "N/A"}

**Stake Limits:**
• Minimum: ${formatEth(stakeLimits.min)} ETH
• Maximum: ${formatEth(stakeLimits.max)} ETH

**Platform Fee:** ${platformFeePercent !== null ? platformFeePercent.toFixed(2) + "%" : "N/A"}

**Accumulated Fees:** ${accumulatedFees !== null ? formatEth(accumulatedFees) + " ETH" : "N/A"}

**Owner:** ${owner ? `\`${owner}\`` : "N/A"}

**Bot Match Manager:** ${isBotMatchManager ? "✅ Yes" : "❌ No"}`;

      await handler.sendMessage(channelId, message, opts);
    } catch (error) {
      console.error("Contract info error:", error);
      await handler.sendMessage(
        channelId,
        `❌ Failed to fetch contract info: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        opts
      );
    }
  };
};
