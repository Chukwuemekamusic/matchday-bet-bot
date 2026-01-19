/**
 * Claim-all confirm button handler
 * Handles the "Confirm" button click for batch claiming all winnings/refunds
 */

import { getSmartAccountFromUserId } from "@towns-protocol/bot";
import { interactionService } from "../../../services/interactions";
import {
  getLinkedWalletsExcludingSmartAccount,
} from "../../../utils/wallet";
import { truncateAddress } from "../../../utils/format";
import type { ButtonHandler } from "../types";

export const handleClaimAllConfirmButton: ButtonHandler = async (
  handler,
  event,
  context,
) => {
  const { channelId, userId, threadId } = event;
  const opts = threadId ? { threadId } : undefined;

  console.log("🔍 [CLAIM-ALL-CONFIRM] Button clicked");

  try {
    // Collect all user wallets
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

    // Fetch claimable matches for each wallet
    const walletClaims: Array<{
      wallet: string;
      winningMatchIds: number[];
      refundMatchIds: number[];
    }> = [];

    for (const wallet of wallets) {
      const res = await context.subgraphService.getUserClaimable(wallet);

      const winningMatchIds = res.data.winnings.map((w: any) => w.matchId);
      const refundMatchIds = res.data.refunds.map((r: any) => r.matchId);

      if (winningMatchIds.length === 0 && refundMatchIds.length === 0) {
        continue;
      }

      walletClaims.push({
        wallet,
        winningMatchIds,
        refundMatchIds,
      });
    }

    if (walletClaims.length === 0) {
      await handler.sendMessage(
        channelId,
        "📭 No claimable matches found.",
        opts
      );
      return;
    }

    // Process each wallet and send transaction requests
    let transactionsSent = 0;

    for (const claim of walletClaims) {
      const walletDisplay = truncateAddress(claim.wallet);

      // Send winnings claim if any
      if (claim.winningMatchIds.length > 0) {
        const calldata = context.contractService.encodeBatchClaimWinningsCall(
          claim.winningMatchIds
        );

        const txId = `claim-all-win-${userId.slice(
          0,
          8
        )}-${Date.now()}`;

        await interactionService.sendTransactionInteraction(
          handler,
          channelId,
          userId,
          {
            id: txId,
            title: `Claim ${claim.winningMatchIds.length} Winning(s) - ${walletDisplay}`,
            chainId: "8453",
            to: context.contractService.getContractAddress(),
            value: "0",
            data: calldata,
            signerWallet: claim.wallet, // Pre-select the wallet
          },
          opts?.threadId
        );

        transactionsSent++;
      }

      // Send refunds claim if any
      if (claim.refundMatchIds.length > 0) {
        const calldata = context.contractService.encodeBatchClaimRefundsCall(
          claim.refundMatchIds
        );

        const txId = `claim-all-ref-${userId.slice(
          0,
          8
        )}-${Date.now()}`;

        await interactionService.sendTransactionInteraction(
          handler,
          channelId,
          userId,
          {
            id: txId,
            title: `Claim ${claim.refundMatchIds.length} Refund(s) - ${walletDisplay}`,
            chainId: "8453",
            to: context.contractService.getContractAddress(),
            value: "0",
            data: calldata,
            signerWallet: claim.wallet, // Pre-select the wallet
          },
          opts?.threadId
        );

        transactionsSent++;
      }
    }

    // Send confirmation message
    await handler.sendMessage(
      channelId,
      `✅ **${transactionsSent} Transaction Request(s) Sent!**\n\nPlease sign each transaction with the correct wallet. The wallet will be pre-selected for you.\n\n_I'll confirm once the transactions are mined._`,
      opts
    );

    console.log(
      `✅ [CLAIM-ALL-CONFIRM] Sent ${transactionsSent} transaction requests`
    );
  } catch (error) {
    console.error("[CLAIM-ALL-CONFIRM] Error:", error);
    await handler.sendMessage(
      channelId,
      "❌ Failed to process claim-all. Please try again or use `/claim` for individual matches.",
      opts
    );
  }
};
