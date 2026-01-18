/**
 * /claim_all command handler
 * Guides user through claiming all eligible matches (wallet by wallet)
 */

import { getSmartAccountFromUserId } from "@towns-protocol/bot";
import type {
  CommandHandler,
  BaseCommandEvent,
  HandlerContext,
} from "../types";
import { getThreadMessageOpts } from "../../utils/threadRouter";
import { getLinkedWalletsExcludingSmartAccount } from "../../utils/wallet";
import { interactionService } from "../../services/interactions";

export const createClaimAllHandler = (
  context: HandlerContext
): CommandHandler<BaseCommandEvent> => {
  return async (handler, { channelId, userId, eventId, threadId }) => {
    const opts = getThreadMessageOpts(threadId, eventId);

    try {
      if (!context.contractService.isContractAvailable()) {
        await handler.sendMessage(
          channelId,
          "❌ Smart contract is not available.",
          opts
        );
        return;
      }

      // Collect wallets
      const wallets: string[] = [];

      const smartWallet = await getSmartAccountFromUserId(context.bot, {
        userId: userId as `0x${string}`,
      });

      if (smartWallet) wallets.push(smartWallet);

      const linkedWallets = await getLinkedWalletsExcludingSmartAccount(
        context.bot,
        userId as `0x${string}`
      );

      wallets.push(...linkedWallets);

      // Fetch claimables
      const walletClaims = [];

      for (const wallet of wallets) {
        const res = await context.subgraphService.getUserClaimable(wallet);

        if (res.data.winnings.length === 0 && res.data.refunds.length === 0) {
          continue;
        }

        walletClaims.push({
          wallet,
          winnings: res.data.winnings,
          refunds: res.data.refunds,
        });
      }

      if (walletClaims.length === 0) {
        await handler.sendMessage(
          channelId,
          `📭 You have no claimable matches across your wallets.`,
          opts
        );
        return;
      }

      // Build summary
      let message = `💰 **Claim All – Wallet Summary**\n\n`;
      message += `You have claimable matches across **${walletClaims.length} wallet(s)**.\n\n`;

      for (const wc of walletClaims) {
        message += `🔗 \`${wc.wallet.slice(0, 6)}...${wc.wallet.slice(-4)}\`\n`;
        message += `• Winnings: ${wc.winnings.length}\n`;
        message += `• Refunds: ${wc.refunds.length}\n\n`;
      }

      message += `⚠️ Claims must be signed **per wallet**.\n`;
      message += `You'll be prompted to confirm each wallet separately.\n\n`;
      message += `Ready to proceed?`;

      // Interaction instead of auto-claim
      await interactionService.sendFormInteraction(
        handler,
        channelId,
        userId,
        {
          id: `claim-all-${userId}`,
          title: "Claim All",
          content: message,
          buttons: [
            { id: "claim-all-confirm", label: "Proceed", style: 1 },
            { id: "claim-all-cancel", label: "Cancel", style: 2 },
          ],
        },
        opts?.threadId
      );
    } catch (err) {
      console.error("Error in /claim_all:", err);
      await handler.sendMessage(
        channelId,
        "❌ Failed to prepare claim-all. Please try again.",
        opts
      );
    }
  };
};
