/**
 * Balance Validator Utility
 * Pre-validates user wallet balances before bet placement
 */

import { formatEther } from "viem";
import { getLinkedWalletsExcludingSmartAccount } from "./wallet";
import { getSmartAccountFromUserId } from "@towns-protocol/bot";

export interface WalletBalance {
  address: string;
  balance: bigint;
  hasSufficientFunds: boolean;
}

/**
 * Get balances for all user wallets (smart account + linked wallets)
 */
export async function getUserWalletBalances(
  bot: any,
  userId: string,
  publicClient: any,
): Promise<WalletBalance[]> {
  const wallets: string[] = [];

  // Get smart account
  const smartAccount = await getSmartAccountFromUserId(bot, {
    userId: userId as `0x${string}`,
  });
  if (smartAccount) wallets.push(smartAccount);

  // Get linked wallets
  const linked = await getLinkedWalletsExcludingSmartAccount(
    bot,
    userId as `0x${string}`,
  );
  wallets.push(...linked);

  // Get balance for each wallet
  const balances = await Promise.all(
    wallets.map(async (address) => {
      const balance = await publicClient.getBalance({ address });
      return { address, balance };
    }),
  );

  return balances.map(({ address, balance }) => ({
    address,
    balance,
    hasSufficientFunds: false, // Will be set by validateBetBalance
  }));
}

/**
 * Find wallet(s) with sufficient balance for bet + gas
 */
export function validateBetBalance(
  walletBalances: WalletBalance[],
  betAmount: bigint,
  estimatedGas: bigint = 2500000000000n, // 0.00025 ETH buffer for gas
): {
  hasValid: boolean;
  validWallets: WalletBalance[];
  insufficientWallets: WalletBalance[];
  requiredAmount: bigint;
} {
  const requiredAmount = betAmount + estimatedGas;

  const validWallets: WalletBalance[] = [];
  const insufficientWallets: WalletBalance[] = [];

  for (const wallet of walletBalances) {
    if (wallet.balance >= requiredAmount) {
      validWallets.push({ ...wallet, hasSufficientFunds: true });
    } else {
      insufficientWallets.push({ ...wallet, hasSufficientFunds: false });
    }
  }

  return {
    hasValid: validWallets.length > 0,
    validWallets,
    insufficientWallets,
    requiredAmount,
  };
}

/**
 * Format balance validation message for user
 */
export function formatBalanceMessage(
  validation: ReturnType<typeof validateBetBalance>,
  betAmount: bigint,
): string {
  const betEth = formatEther(betAmount);
  const requiredEth = formatEther(validation.requiredAmount);
  const gasEth = formatEther(validation.requiredAmount - betAmount);

  if (validation.hasValid) {
    const wallet = validation.validWallets[0];
    const truncated = `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`;
    return `✅ Using wallet: **${truncated}**\nBalance: ${formatEther(wallet.balance)} ETH`;
  } else {
    let msg = `❌ **Insufficient Balance**\n\n`;
    msg += `**Required:** ${requiredEth} ETH\n`;
    msg += `• Bet: ${betEth} ETH\n`;
    msg += `• Gas (estimate): ~${gasEth} ETH\n\n`;
    msg += `**Your wallets:**\n\n`;

    validation.insufficientWallets.forEach((wallet) => {
      const truncated = `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`;
      msg += `• ${truncated}: ${formatEther(wallet.balance)} ETH ❌\n\n`;
    });

    msg += `\n**What to do:**\nAdd funds to one of your wallets and click "Confirm & Sign" again.`;
    return msg;
  }
}
