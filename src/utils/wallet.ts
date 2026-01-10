import { readContract } from "viem/actions";
import walletLinkAbi from "@towns-protocol/generated/dev/abis/WalletLink.abi";

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
