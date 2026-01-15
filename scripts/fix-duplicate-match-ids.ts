#!/usr/bin/env bun
/**
 * Script to fix duplicate on-chain match IDs in the database
 *
 * This script:
 * 1. Finds all matches with duplicate on-chain IDs
 * 2. For each duplicate, verifies which match actually exists on-chain
 * 3. Clears the on-chain ID from matches that don't exist on-chain
 * 4. Updates the database to match the on-chain state
 */

import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { db } from "../src/db";
import { config } from "../src/config";

const CONTRACT_ADDRESS = config.contract.address as `0x${string}`;

const client = createPublicClient({
  chain: base,
  transport: http(config.chain.rpcUrl),
});

const GET_MATCH_ABI = [
  {
    type: "function",
    name: "getMatch",
    stateMutability: "view",
    inputs: [{ name: "matchId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "matchId", type: "uint256" },
          { name: "kickoffTime", type: "uint256" },
          { name: "totalPool", type: "uint256" },
          { name: "homePool", type: "uint256" },
          { name: "drawPool", type: "uint256" },
          { name: "awayPool", type: "uint256" },
          { name: "homeBetCount", type: "uint256" },
          { name: "drawBetCount", type: "uint256" },
          { name: "awayBetCount", type: "uint256" },
          { name: "platformFeeAmount", type: "uint256" },
          { name: "result", type: "uint8" },
          { name: "status", type: "uint8" },
          { name: "homeTeam", type: "string" },
          { name: "awayTeam", type: "string" },
          { name: "competition", type: "string" },
        ],
      },
    ],
  },
] as const;

interface DBMatch {
  id: number;
  api_match_id: number;
  on_chain_match_id: number | null;
  match_code: string | null;
  home_team: string;
  away_team: string;
  kickoff_time: number;
  status: string;
}

async function getOnChainMatch(matchId: number) {
  try {
    const result = await client.readContract({
      address: CONTRACT_ADDRESS,
      abi: GET_MATCH_ABI,
      functionName: "getMatch",
      args: [BigInt(matchId)],
    });

    return {
      homeTeam: result[0],
      awayTeam: result[1],
      kickoffTime: Number(result[2]),
      status: result[3],
      result: result[4],
    };
  } catch (error) {
    return null;
  }
}

async function main() {
  console.log("🔍 Finding duplicate on-chain match IDs...\n");

  // Find all duplicate on-chain match IDs
  const duplicates = db.db
    .prepare(
      `
    SELECT on_chain_match_id, COUNT(*) as count
    FROM matches
    WHERE on_chain_match_id IS NOT NULL
    GROUP BY on_chain_match_id
    HAVING COUNT(*) > 1
  `
    )
    .all() as { on_chain_match_id: number; count: number }[];

  if (duplicates.length === 0) {
    console.log("✅ No duplicate on-chain match IDs found!");
    return;
  }

  console.log(`Found ${duplicates.length} duplicate on-chain match IDs:\n`);

  for (const dup of duplicates) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(
      `On-Chain Match ID: ${dup.on_chain_match_id} (${dup.count} duplicates)`
    );
    console.log(`${"=".repeat(60)}\n`);

    // Get all matches with this on-chain ID
    const matches = db.db
      .prepare(
        `
      SELECT id, api_match_id, on_chain_match_id, match_code, home_team, away_team, 
             kickoff_time, status
      FROM matches
      WHERE on_chain_match_id = ?
      ORDER BY kickoff_time
    `
      )
      .all(dup.on_chain_match_id) as DBMatch[];

    // Get the on-chain match data
    const onChainMatch = await getOnChainMatch(dup.on_chain_match_id);

    if (!onChainMatch) {
      console.log(
        `⚠️  On-chain match ${dup.on_chain_match_id} not found! Clearing all references...`
      );
      for (const match of matches) {
        db.db
          .prepare(`UPDATE matches SET on_chain_match_id = NULL WHERE id = ?`)
          .run(match.id);
        console.log(
          `   Cleared on-chain ID from match ${match.id} (${match.home_team} vs ${match.away_team})`
        );
      }
      continue;
    }

    console.log(`On-chain match data:`);
    console.log(`  ${onChainMatch.homeTeam} vs ${onChainMatch.awayTeam}`);
    console.log(
      `  Kickoff: ${new Date(onChainMatch.kickoffTime * 1000).toISOString()}`
    );
    console.log(`  Status: ${onChainMatch.status}\n`);

    // Find which database match matches the on-chain data
    let correctMatch: DBMatch | null = null;
    for (const match of matches) {
      const homeMatch =
        match.home_team.toLowerCase() === onChainMatch.homeTeam.toLowerCase();
      const awayMatch =
        match.away_team.toLowerCase() === onChainMatch.awayTeam.toLowerCase();
      const kickoffMatch =
        Math.abs(match.kickoff_time - onChainMatch.kickoffTime) < 3600; // Within 1 hour

      console.log(
        `DB Match ${match.id}: ${match.home_team} vs ${match.away_team}`
      );
      console.log(`  Match code: ${match.match_code}`);
      console.log(
        `  Kickoff: ${new Date(match.kickoff_time * 1000).toISOString()}`
      );
      console.log(`  Status: ${match.status}`);
      console.log(
        `  Teams match: ${
          homeMatch && awayMatch
        }, Kickoff match: ${kickoffMatch}`
      );

      if (homeMatch && awayMatch && kickoffMatch) {
        correctMatch = match;
        console.log(`  ✅ This is the correct match!\n`);
      } else {
        console.log(`  ❌ This is NOT the correct match\n`);
      }
    }

    // Fix the database
    if (correctMatch) {
      for (const match of matches) {
        if (match.id !== correctMatch.id) {
          db.db
            .prepare(`UPDATE matches SET on_chain_match_id = NULL WHERE id = ?`)
            .run(match.id);
          console.log(`🔧 Cleared on-chain ID from match ${match.id}`);
        }
      }
      console.log(
        `✅ Fixed! On-chain ID ${dup.on_chain_match_id} now only assigned to match ${correctMatch.id}`
      );
    } else {
      console.log(
        `⚠️  Could not find matching database entry. Manual intervention required.`
      );
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("✅ Duplicate fix complete!");
  console.log(`${"=".repeat(60)}\n`);
}

main().catch(console.error);
