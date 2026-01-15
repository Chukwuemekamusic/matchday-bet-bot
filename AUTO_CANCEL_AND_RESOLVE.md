# Auto-Cancellation and Auto-Resolution Features

## Overview

The bot now has **two separate auto-handling mechanisms** for different match scenarios:

1. **Auto-Cancellation** - For postponed matches that should be cancelled
2. **Auto-Resolution** - For finished matches that weren't resolved yet

## Problem Solved

### The Postponed Match Issue

When a match is postponed:
1. The match status in the database is set to `POSTPONED`
2. The match is **cancelled** (not rescheduled to find a new result)
3. All bets should be **refunded**
4. Users should use `/claim_refund` (not `/claim`)
5. Previously required admin intervention to cancel the match on-chain

### The Unresolved Match Issue

When a match finishes but isn't resolved:
1. The scheduler might miss it due to timing or errors
2. Users trying to `/claim` would see "Match hasn't been resolved yet"
3. Previously required admin intervention to resolve the match

---

## Solution 1: Auto-Cancellation

### When It Triggers

**Command:** `/claim_refund <match_code>`

**Conditions:**
- Match status is `POSTPONED`
- Match is from a **past date** (using match_code date component)
- Match has an on-chain ID

**Example:**
- Today: 2026-01-15
- Match code: `20260113-4` (from Jan 13)
- Status: POSTPONED
- → Auto-cancel triggered!

### What It Does

1. **Detects** postponed match from past date
2. **Cancels** the match on-chain via `contractService.cancelMatch()`
3. **Updates** database status to `CANCELLED`
4. **Proceeds** with refund claim process

### Implementation

**Function:** `tryAutoCancelMatch()` (lines 149-231 in `src/index.ts`)

**Key Logic:**
```typescript
// Only cancel postponed matches from past dates
if (match.status === "POSTPONED" && match.match_code) {
  const matchDateStr = match.match_code.split("-")[0]; // "20260113"
  const todayStr = "20260115"; // Current date
  
  if (matchDateStr < todayStr) {
    // Cancel on-chain
    await contractService.cancelMatch(
      match.on_chain_match_id,
      "Match postponed - auto-cancelled"
    );
    
    // Update DB
    db.updateMatchStatus(match.id, "CANCELLED");
  }
}
```

**Used in:** `/claim_refund` command (line 1578)

---

## Solution 2: Auto-Resolution

### When It Triggers

**Command:** `/claim <match_code>`

**Conditions:**
- Match is **not** postponed
- Match is unresolved (no result yet)
- 3+ hours have passed since kickoff
- Match has an on-chain ID

### What It Does

1. **Checks** if enough time has passed (3+ hours)
2. **Fetches** latest match data from Football API
3. **Resolves** the match if status is FINISHED
4. **Proceeds** with claim process

### Implementation

**Function:** `tryAutoResolveMatch()` (lines 44-147 in `src/index.ts`)

**Key Logic:**
```typescript
// Don't try to resolve postponed matches
if (match.status === "POSTPONED") {
  return match;
}

// Check if 3+ hours since kickoff
if (timeSinceKickoff > threeHours) {
  // Fetch from API
  const apiMatch = await footballApi.getMatch(match.api_match_id);
  
  if (FootballAPIService.isFinished(apiMatch.status)) {
    // Resolve on-chain
    await contractService.resolveMatch(match.on_chain_match_id, outcome);
    
    // Update DB
    db.updateMatchResult(match.id, homeScore, awayScore, outcome);
  }
}
```

**Used in:** `/claim` command (line 1233)

---

## Scheduler Integration

### Auto-Cancel Task

**Function:** `autoCancelPostponedMatches()` (lines 919-974 in `src/scheduler.ts`)

**Schedule:** Every 6 hours + on startup

**What It Does:**
- Finds all postponed matches with on-chain IDs
- Checks if they're from past dates
- Auto-cancels them proactively (before users try to claim)

**Benefits:**
- Users don't have to wait for auto-cancel on first `/claim_refund`
- Keeps the system clean
- Reduces on-chain calls during user interactions

---

## Console Logging

### Auto-Cancellation Logs

**Success:**
```
🚫 Auto-cancel attempt for postponed match 20260113-4: HSV vs Leverkusen (Status: POSTPONED)
   ✅ On-chain cancellation successful for match 123
   ✅ Database updated to CANCELLED
   🎉 Auto-cancellation complete! Match 20260113-4 is now cancelled
```

**Already Cancelled:**
```
(No log - function returns early)
```

### Auto-Resolution Logs

**Success:**
```
🔄 Auto-resolve attempt for match 20260115-2: Arsenal vs Chelsea (Status: SCHEDULED, Reason: 3+ hours since kickoff)
   ✅ Database updated: 3-1 (HOME)
   ✅ On-chain resolution successful for match 124
   🎉 Auto-resolution complete! Match 20260115-2 is now resolved
```

**Still Not Finished:**
```
🔄 Auto-resolve attempt for match 20260115-2: Arsenal vs Chelsea (Status: IN_PLAY, Reason: 3+ hours since kickoff)
   ℹ️ Match still not finished (Status: IN_PLAY)
```

---

## Key Differences

| Feature | Auto-Cancellation | Auto-Resolution |
|---------|------------------|-----------------|
| **Trigger** | `/claim_refund` | `/claim` |
| **Match Status** | POSTPONED | Any except POSTPONED |
| **Condition** | Past date | 3+ hours since kickoff |
| **Action** | Cancel on-chain | Resolve on-chain |
| **DB Update** | Status → CANCELLED | Result → HOME/DRAW/AWAY |
| **User Gets** | Refund | Winnings (if won) |
| **Scheduler** | Yes (every 6 hours) | No |

---

## Testing

### Test Auto-Cancellation

1. Find a postponed match from a past date:
   ```sql
   SELECT * FROM matches 
   WHERE status = 'POSTPONED' 
   AND match_code < '20260115-0'
   AND on_chain_match_id IS NOT NULL;
   ```

2. Try to claim refund:
   ```
   /claim_refund 20260113-4
   ```

3. Check console for auto-cancel logs

### Test Auto-Resolution

1. Find an unresolved match 3+ hours old:
   ```sql
   SELECT * FROM matches 
   WHERE result IS NULL 
   AND status != 'POSTPONED'
   AND kickoff_time < (strftime('%s', 'now') - 10800)
   AND on_chain_match_id IS NOT NULL;
   ```

2. Try to claim:
   ```
   /claim <match_code>
   ```

3. Check console for auto-resolve logs

