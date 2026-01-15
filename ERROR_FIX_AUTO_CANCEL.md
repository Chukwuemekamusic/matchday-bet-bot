# Fix: Auto-Cancel Transaction Revert Error

## Problem

When starting the bot, the auto-cancel scheduler task tried to cancel match 12 and got this error:

```
TransactionExecutionError: Execution reverted for an unknown reason.
```

## Root Cause

The contract's `cancelMatch()` function reverts if:
1. **Match is already cancelled** (`MatchAlreadyCancelled` error)
2. **Match is already resolved** (`MatchAlreadyResolved` error)
3. **Match doesn't exist** (`MatchNotFound` error)

The scheduler was trying to cancel a match that was **already cancelled or resolved** on-chain, causing the transaction to revert.

## Solution

Added **on-chain status check** before attempting to cancel:

### 1. Check Match Status First

Before calling `cancelMatch()`, we now:
1. Fetch the match from the contract using `getMatch(matchId)`
2. Check the on-chain status
3. Skip if already cancelled (status = 3) or resolved (status = 2)
4. Only proceed with cancellation if status is OPEN (0) or CLOSED (1)

### 2. Sync Local DB with On-Chain State

If we find a match that's already cancelled on-chain but not in our DB:
- Update local DB status to CANCELLED
- Skip the cancellation attempt
- Log as "skipped"

## Implementation

### Updated `tryAutoCancelMatch()` (src/index.ts, lines 191-257)

**Before:**
```typescript
// Directly tried to cancel
const result = await contractService.cancelMatch(
  match.on_chain_match_id,
  "Match postponed - auto-cancelled"
);
```

**After:**
```typescript
// Check on-chain status first
const onChainMatch = await contractService.getMatch(match.on_chain_match_id);

if (onChainMatch) {
  if (onChainMatch.status === 3) {
    // Already CANCELLED - just update DB
    db.updateMatchStatus(match.id, "CANCELLED");
    return updatedMatch;
  }
  
  if (onChainMatch.status === 2) {
    // Already RESOLVED - cannot cancel
    return match;
  }
}

// Now safe to cancel
const result = await contractService.cancelMatch(...);
```

### Updated `autoCancelPostponedMatches()` (src/scheduler.ts, lines 964-993)

**Before:**
```typescript
// Directly tried to cancel
const result = await contractServiceInstance.cancelMatch(
  match.on_chain_match_id!,
  "Match postponed - auto-cancelled by scheduler"
);
```

**After:**
```typescript
// Check on-chain status first
const onChainMatch = await contractServiceInstance.getMatch(
  match.on_chain_match_id!
);

if (!onChainMatch) {
  console.log(`⏭️ Skipping match ${match.match_code} - not found on-chain`);
  skippedCount++;
  continue;
}

if (onChainMatch.status === 3 || onChainMatch.status === 2) {
  console.log(`⏭️ Skipping match ${match.match_code} - already ${
    onChainMatch.status === 3 ? "cancelled" : "resolved"
  } on-chain`);
  
  // Sync DB
  if (onChainMatch.status === 3 && match.status !== "CANCELLED") {
    db.updateMatchStatus(match.id, "CANCELLED");
  }
  
  skippedCount++;
  continue;
}

// Now safe to cancel
const result = await contractServiceInstance.cancelMatch(...);
```

## Match Status Enum

From the contract:
```solidity
enum MatchStatus {
    OPEN,      // 0
    CLOSED,    // 1
    RESOLVED,  // 2
    CANCELLED  // 3
}
```

## Console Output

### Before Fix
```
Cancelling match 12: Match postponed - auto-cancelled by scheduler
Failed to cancel match 12
TransactionExecutionError: Execution reverted for an unknown reason.
```

### After Fix

**If already cancelled:**
```
🚫 Auto-cancel attempt for postponed match 20260113-4: HSV vs Leverkusen (Status: POSTPONED)
   ℹ️ Match 12 already cancelled on-chain
   ✅ Database updated to CANCELLED
```

**If already resolved:**
```
🚫 Auto-cancel attempt for postponed match 20260113-4: HSV vs Leverkusen (Status: POSTPONED)
   ℹ️ Match 12 already resolved on-chain - cannot cancel
```

**If successfully cancelled:**
```
🚫 Auto-cancel attempt for postponed match 20260113-4: HSV vs Leverkusen (Status: POSTPONED)
   ✅ On-chain cancellation successful for match 12
   ✅ Database updated to CANCELLED
   🎉 Auto-cancellation complete! Match 20260113-4 is now cancelled
```

## Benefits

✅ **No more transaction reverts** - Check status before attempting cancellation
✅ **DB sync** - Local database stays in sync with on-chain state
✅ **Better logging** - Clear messages about why matches are skipped
✅ **Idempotent** - Safe to run multiple times without errors
✅ **Gas savings** - Don't send transactions that will revert

## Testing

The bot should now start without errors. Try:

```bash
bun run dev
```

**Expected output:**
```
📅 Starting scheduler...
⏰ Next morning fetch: 2026-01-16T06:00:00.000Z
🌅 Morning fetch starting...
⏭️ Skipping match 20260113-4 - already cancelled on-chain
🚫 Auto-cancel summary: 0 cancelled, 1 skipped
✅ Scheduler started
🎯 MatchDay Bet Bot started!
```

No errors! 🎉

