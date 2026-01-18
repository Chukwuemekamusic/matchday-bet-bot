import { encodeFunctionData, decodeFunctionData } from "viem";

const CONTRACT_ABI = [
  {
    type: "function",
    name: "batchClaimWinnings",
    stateMutability: "nonpayable",
    inputs: [{ name: "matchIds", type: "uint256[]" }],
    outputs: [{ name: "totalPayout", type: "uint256" }],
  },
  {
    type: "function",
    name: "batchClaimRefunds",
    stateMutability: "nonpayable",
    inputs: [{ name: "matchIds", type: "uint256[]" }],
    outputs: [{ name: "totalRefund", type: "uint256" }],
  },
] as const;

// Test with actual match IDs
const testMatchIds = [1, 2, 3];

const calldata = encodeFunctionData({
  abi: CONTRACT_ABI,
  functionName: "batchClaimRefunds",
  args: [testMatchIds.map((id) => BigInt(id))],
});

console.log("Generated calldata:", calldata);
console.log("Function selector:", calldata.slice(0, 10));

// Decode it back to verify
const decoded = decodeFunctionData({
  abi: CONTRACT_ABI,
  data: calldata,
});

console.log("\nDecoded:");
console.log("  functionName:", decoded.functionName);
console.log("  args:", decoded.args);
console.log("  matchIds:", (decoded.args as any)[0].map((id: bigint) => Number(id)));
