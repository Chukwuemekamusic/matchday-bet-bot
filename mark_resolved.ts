import { Database } from 'bun:sqlite';

const db = new Database('./data/matchday.db');

console.log('\n=== Marking unresolved on-chain matches as resolved ===\n');

// Get all unresolved on-chain matches
const matches = db.prepare(`
  SELECT 
    id,
    home_team,
    away_team,
    on_chain_match_id,
    result
  FROM matches
  WHERE on_chain_match_id IS NOT NULL
    AND result IS NOT NULL
    AND on_chain_resolved = 0
  ORDER BY kickoff_time ASC
`).all();

console.log(`Found ${matches.length} matches to update\n`);

if (matches.length === 0) {
  console.log('✅ No matches to update.');
  db.close();
  process.exit(0);
}

// Show matches that will be updated
console.log('Matches to be marked as resolved:');
for (const match of matches as any[]) {
  console.log(`  - ID:${match.id} | On-chain:${match.on_chain_match_id} | ${match.home_team} vs ${match.away_team} | Result:${match.result}`);
}

console.log('\n');

// Update all matches
const updateStmt = db.prepare(`
  UPDATE matches 
  SET on_chain_resolved = 1 
  WHERE on_chain_match_id IS NOT NULL
    AND result IS NOT NULL
    AND on_chain_resolved = 0
`);

const result = updateStmt.run();

console.log(`✅ Successfully updated ${result.changes} matches to on_chain_resolved = 1\n`);

// Verify the update
const remaining = db.prepare(`
  SELECT COUNT(*) as count
  FROM matches
  WHERE on_chain_match_id IS NOT NULL
    AND result IS NOT NULL
    AND on_chain_resolved = 0
`).get() as any;

console.log(`Remaining unresolved on-chain matches: ${remaining.count}`);

db.close();

