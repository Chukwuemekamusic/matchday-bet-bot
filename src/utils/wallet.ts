import { getSmartAccountFromUserId } from "@towns-protocol/bot";
import { readContract } from "viem/actions";
import walletLinkAbi from "@towns-protocol/generated/dev/abis/WalletLink.abi";
import { config } from "../config";

/**
 * Get all linked wallets for a user from the WalletLink contract
 * @param bot - Towns bot instance
 * @param userId - User ID (root key)
 * @returns Array of linked wallet addresses
 */
export async function getLinkedWallets(
  bot: any,
  userId: `0x${string}`
): Promise<`0x${string}`[]> {
  try {
    const walletLinkAddress =
      bot.client.config.base.chainConfig.addresses.spaceFactory;

    const linkedWallets = (await readContract(bot.viem, {
      address: walletLinkAddress as `0x${string}`,
      abi: walletLinkAbi,
      functionName: "getWalletsByRootKey",
      args: [userId],
    })) as `0x${string}`[];

    return linkedWallets || [];
  } catch (error) {
    console.error("Error fetching linked wallets:", error);
    return [];
  }
}

/**
 * Get all linked wallets for a user from the WalletLink contract apart from the smart account towns address
 * @param bot - Towns bot instance
 * @param userId - User ID (root key)
 * @returns Array of linked wallet addresses
 */
export async function getLinkedWalletsExcludingSmartAccount(
  bot: any,
  userId: `0x${string}`
): Promise<`0x${string}`[]> {
  try {
    const linkedWallets = await getLinkedWallets(bot, userId);
    const smartAccount = await getSmartAccountFromUserId(bot, {
      userId: userId,
    });

    return linkedWallets.filter(
      (wallet) => wallet.toLowerCase() !== smartAccount?.toLowerCase()
    );
  } catch (error) {
    console.error(
      "Error fetching linked wallets apart from smart account:",
      error
    );
    return [];
  }
}

export async function getSmartAccountWallet(bot: any, userId: `0x${string}`) {
  try {
    return await getSmartAccountFromUserId(bot, {
      userId: userId,
    });
  } catch (error) {
    console.error("Error fetching smart account:", error);
    return null;
  }
}

export async function isUserAdmin(
  bot: any,
  userId: `0x${string}`
): Promise<boolean> {
  try {
    const smartAccount = await getSmartAccountFromUserId(bot, {
      userId: userId,
    });

    // Check if user is admin (by EOA or smart account)
    const isAdminByEOA =
      userId.toLowerCase() === config.admin.userId.toLowerCase();
    const isAdminBySmartAccount = smartAccount
      ? smartAccount.toLowerCase() === config.admin.userId.toLowerCase()
      : false;

    return isAdminByEOA || isAdminBySmartAccount;
  } catch (error) {
    console.error("Error checking if user is admin:", error);
    return false;
  }
}
