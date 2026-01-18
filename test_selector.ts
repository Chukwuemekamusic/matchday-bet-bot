import { encodeFunctionData } from "viem";

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

// Test encoding
const winningsCalldata = encodeFunctionData({
  abi: CONTRACT_ABI,
  functionName: "batchClaimWinnings",
  args: [[BigInt(1)]],
});

const refundsCalldata = encodeFunctionData({
  abi: CONTRACT_ABI,
  functionName: "batchClaimRefunds",
  args: [[BigInt(1)]],
});

console.log("batchClaimWinnings selector:", winningsCalldata.slice(0, 10));
console.log("Expected:                    0x8ccaa04e");
console.log("");
console.log("batchClaimRefunds selector: ", refundsCalldata.slice(0, 10));
console.log("Expected:                    0xe993a3ae");
