# Subgraph Integration Guide

This document describes the integration of The Graph subgraph into the MatchDay Bet Bot.

## Overview

The bot now uses The Graph subgraph as the primary data source for on-chain betting data, with automatic fallback to database + contract queries when the subgraph is unavailable.

## What Was Added

### 1. Configuration (`src/config/index.ts`)

Added subgraph URL configuration:
```typescript
subgraph: {
  url: optionalEnv(
    "SUBGRAPH_URL",
    "https://api.studio.thegraph.com/query/93996/matchdaybet-2/version/latest"
  ),
}
```

**Environment Variable:**
- `SUBGRAPH_URL` - The Graph Studio endpoint (optional, defaults to production endpoint)

### 2. New Service (`src/services/subgraph.ts`)

Created a comprehensive subgraph service with:

**GraphQL Queries:**
- `GET_USER_CLAIMABLE_BETS` - Get unclaimed winnings and refunds
- `GET_USER_STATS` - Get user betting statistics
- `GET_LEADERBOARD` - Get top users by profit
- `GET_GLOBAL_STATS` - Get protocol-wide statistics

**API Methods:**
- `getUserClaimable(userAddress)` - Returns winnings and refunds with fallback
- `getUserStats(userAddress)` - Returns user stats with fallback
- `getLeaderboard(limit)` - Returns top bettors
- `getGlobalStats()` - Returns global statistics

**Fallback Strategy:**
Each method includes automatic fallback to database queries when subgraph fails. The fallback is transparent to the caller.

### 3. TypeScript Types (`src/types/index.ts`)

Added comprehensive GraphQL types:
- `SubgraphBet` - Bet entity from subgraph
- `SubgraphUser` - User entity with aggregated stats
- `SubgraphGlobalStats` - Global protocol statistics
- `ClaimableMatch` - Processed claimable match data
- `ClaimableData` - Combined winnings and refunds
- Query response types for all endpoints

### 4. REST API Endpoints (`src/index.ts`)

Added three new REST endpoints:

**GET /api/claimable/:userAddress**
- Returns user's claimable winnings and refunds
- Sections: winnings[] and refunds[]
- Includes match details, amounts, payouts, profits

**GET /api/stats/:userAddress**
- Returns user betting statistics
- Includes wins, losses, refunds, profit, etc.

**GET /api/leaderboard?limit=10**
- Returns top users by profit
- Default limit: 10, max: 100

All endpoints return:
```json
{
  "data": {...},
  "source": "subgraph" | "fallback",
  "timestamp": 1234567890
}
```

### 5. Enhanced Slash Commands

**`/claimable` Command:**
- Now uses subgraph for faster queries
- Shows both winnings and refunds in sections
- Displays pre-calculated payouts and profits (when available)
- Format:
  ```
  🏆 Winnings (2)
  [match details with profit calculations]

  💰 Refunds (1)
  [cancelled match details]
  ```

**`/stats` Command:**
- Now uses subgraph for richer statistics
- Shows additional metrics: refund count, total claimed
- More accurate profit tracking
- Includes losses count

## Fallback Behavior

### When Subgraph is Down

1. **Critical Commands** (`/claimable`, `/stats`):
   - Automatically falls back to database queries
   - User experiences no disruption
   - Warning indicator shown: `⚠️ Using fallback data source`

2. **Analytics** (`/leaderboard`):
   - Returns empty array with warning
   - Could implement database fallback later

3. **REST API**:
   - Returns data from fallback source
   - Response includes `"source": "fallback"` field

### What Works in Fallback Mode

✅ List claimable matches (from database)
✅ User statistics (from database)
✅ All core betting functionality

❌ Pre-calculated profit amounts (must be computed)
❌ Global statistics
❌ Leaderboard

## Advantages of Subgraph Integration

### Performance
- ✅ Faster queries (indexed data)
- ✅ No RPC rate limits
- ✅ Efficient batch queries via GraphQL

### Data Quality
- ✅ Pre-calculated profit/payout amounts
- ✅ Aggregated user statistics in real-time
- ✅ Historical claim timestamps
- ✅ Refund tracking

### Scalability
- ✅ Handles high query volume
- ✅ No database load for on-chain data
- ✅ Can support web app / mobile app

### Reliability
- ✅ Graceful degradation with fallback
- ✅ Bot never breaks for users
- ✅ Monitoring via `source` field in responses

## Testing

### Test Subgraph Query Directly

```bash
# Test getUserClaimable
curl http://localhost:5123/api/claimable/0xYourAddress

# Test getUserStats
curl http://localhost:5123/api/stats/0xYourAddress

# Test leaderboard
curl http://localhost:5123/api/leaderboard?limit=5
```

### Test Slash Commands

In Towns app:
```
/claimable  # Should show winnings + refunds sections
/stats      # Should show enhanced statistics
```

### Test Fallback

To test fallback mode, temporarily set an invalid `SUBGRAPH_URL`:
```bash
export SUBGRAPH_URL="https://invalid-url.com"
bun run dev
```

Commands should still work, showing `⚠️ Using fallback data source`.

## Monitoring

### Log Messages

Watch for these log patterns:

**Subgraph Success:**
```
No special logs (silent success)
```

**Fallback Triggered:**
```
⚠️ Subgraph query failed, using fallback: [error details]
```

**Leaderboard Unavailable:**
```
⚠️ Leaderboard unavailable (subgraph down, no fallback implemented)
```

### Response Source Field

All REST API responses include `"source"` field:
- `"source": "subgraph"` - Data from The Graph
- `"source": "fallback"` - Data from database

Track the ratio to monitor subgraph health.

## Future Enhancements

### Potential Improvements

1. **Caching Layer**
   - Cache subgraph responses for 30-60 seconds
   - Serve stale data when subgraph is down
   - Reduce query load

2. **Leaderboard Fallback**
   - Implement database-based leaderboard
   - Use `user_stats` table

3. **Contract Verification in Fallback**
   - Add optional contract verification for claim status
   - More accurate but slower

4. **Global Stats from Database**
   - Compute global statistics from database
   - Fallback for analytics

5. **GraphQL Subscriptions**
   - Real-time updates via subscriptions
   - Push notifications for match resolutions

6. **Batch Claim Support**
   - Query multiple users at once
   - Optimize for web app

## Dependencies

**New Packages:**
- `graphql-request@7.4.0` - GraphQL client
- `graphql@16.12.0` - GraphQL schema/types

**Total Bundle Size Impact:**
- ~150KB (compressed)

## Configuration

### Environment Variables

Add to `.env`:
```bash
# Optional - defaults to production endpoint
SUBGRAPH_URL=https://api.studio.thegraph.com/query/93996/matchdaybet-2/version/latest
```

### Default Endpoint

The default endpoint points to The Graph Studio:
- Subgraph: `matchdaybet-2`
- Network: Base mainnet
- Version: `version/latest` (auto-updates)

## Troubleshooting

### Issue: "Subgraph query failed"

**Cause:** The Graph Studio is down or rate-limited

**Solution:** Bot automatically uses fallback. No action needed.

**Monitor:** Check The Graph Studio status at https://thegraph.com/studio/

### Issue: Empty winnings/refunds arrays

**Possible Causes:**
1. User hasn't placed bets yet
2. All bets already claimed
3. Database out of sync with contract
4. Subgraph not indexed yet

**Debug:**
1. Check user address is correct
2. Query contract directly for user's bets
3. Check subgraph sync status in Studio
4. Verify database has match records

### Issue: Incorrect profit calculations

**Cause:** Subgraph data might be stale during block reorganizations

**Solution:** Wait a few minutes for subgraph to re-index

**Mitigation:** Use database fallback which queries contract directly

## Architecture Diagram

```
┌─────────────┐
│  User       │
└──────┬──────┘
       │
       ├─ /claimable
       ├─ /stats
       ├─ /leaderboard
       │
       v
┌─────────────────────┐
│  Bot (index.ts)     │
│                     │
│  Slash Commands     │
│  + REST API         │
└──────────┬──────────┘
           │
           v
┌─────────────────────────┐
│ SubgraphService         │
│ (subgraph.ts)           │
│                         │
│ ┌─────────────────┐    │
│ │ Try: Subgraph   │    │
│ └────────┬────────┘    │
│          │              │
│          │ (on error)   │
│          v              │
│ ┌─────────────────┐    │
│ │ Fallback: DB    │    │
│ └─────────────────┘    │
└───────────┬─────────────┘
            │
      ┌─────┴────┐
      │          │
      v          v
┌──────────┐ ┌────────┐
│ Subgraph │ │   DB   │
│ (Graph)  │ │ SQLite │
└──────────┘ └────────┘
```

## Summary

The subgraph integration provides:
- ✅ **3 new REST API endpoints** for external integrations
- ✅ **Enhanced slash commands** with richer data
- ✅ **Automatic fallback** for 100% uptime
- ✅ **Performance boost** via indexed queries
- ✅ **Better UX** with pre-calculated profits

The bot now has a production-ready data layer that scales to support future web/mobile apps while maintaining full backward compatibility.
