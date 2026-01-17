import { Database } from 'bun:sqlite';

const db = new Database('./data/matchday.db');

console.log('\n=== Checking for unresolved on-chain matches ===\n');

const matches = db.prepare(`
  SELECT 
    id,
    home_team,
    away_team,
    on_chain_match_id,
    result,
    status,
    on_chain_resolved,
    kickoff_time,
    resolved_at
  FROM matches
  WHERE on_chain_match_id IS NOT NULL
    AND result IS NOT NULL
    AND on_chain_resolved = 0
  ORDER BY kickoff_time ASC
`).all();

if (matches.length === 0) {
  console.log('✅ No unresolved on-chain matches found.');
} else {
  console.log(`⚠️  Found ${matches.length} unresolved on-chain match(es):\n`);
  
  for (const match of matches as any[]) {
    console.log(`Match ID: ${match.id}`);
    console.log(`  Teams: ${match.home_team} vs ${match.away_team}`);
    console.log(`  On-chain Match ID: ${match.on_chain_match_id}`);
    console.log(`  Result: ${match.result}`);
    console.log(`  Status: ${match.status}`);
    console.log(`  On-chain Resolved: ${match.on_chain_resolved}`);
    console.log(`  Kickoff: ${new Date(match.kickoff_time * 1000).toISOString()}`);
    console.log(`  Resolved At: ${match.resolved_at ? new Date(match.resolved_at * 1000).toISOString() : 'N/A'}`);
    console.log('');
  }
}

// Also show all on-chain matches for context
console.log('\n=== All on-chain matches (for context) ===\n');

const allOnChain = db.prepare(`
  SELECT 
    id,
    home_team,
    away_team,
    on_chain_match_id,
    result,
    status,
    on_chain_resolved,
    kickoff_time
  FROM matches
  WHERE on_chain_match_id IS NOT NULL
  ORDER BY kickoff_time DESC
  LIMIT 10
`).all();

console.log(`Total on-chain matches (showing last 10): ${allOnChain.length}\n`);

for (const match of allOnChain as any[]) {
  const resolved = match.on_chain_resolved ? '✅' : '❌';
  console.log(`${resolved} ID:${match.id} | On-chain:${match.on_chain_match_id} | ${match.home_team} vs ${match.away_team} | Result:${match.result ?? 'N/A'} | Status:${match.status}`);
}

db.close();

