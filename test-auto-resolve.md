# Auto-Resolution Feature Test Plan

## Overview
The auto-resolution feature attempts to resolve matches that are unresolved but have passed their expected finish time (3+ hours after kickoff). This is particularly useful for postponed matches that were rescheduled and finished.

## Implementation Details

### Helper Function: `tryAutoResolveMatch(match: DBMatch)`
- **Location:** `src/index.ts` (lines 44-140)
- **Purpose:** Attempts to auto-resolve a match by fetching latest API data
- **Conditions:**
  1. Match must be unresolved (`result === null`)
  2. Match must have an on-chain ID
  3. At least 3 hours must have passed since kickoff
  4. API must return FINISHED status with valid scores

### Integration Points

#### 1. `/claim` Command
- **Location:** Line 1141 in `src/index.ts`
- **Timing:** After on-chain check, before resolution check
- **Code:** `match = await tryAutoResolveMatch(match);`

#### 2. `/claim_refund` Command
- **Location:** Line 1487 in `src/index.ts`
- **Timing:** After on-chain check, before eligibility check
- **Code:** `match = await tryAutoResolveMatch(match);`

## Test Scenarios

### Scenario 1: Postponed Match That Was Rescheduled and Finished
**Setup:**
1. Match was originally scheduled for 2026-01-13
2. Match status changed to POSTPONED
3. Match was rescheduled and played on 2026-01-15
4. Match finished with score 2-1
5. User tries to claim 3+ hours after original kickoff

**Expected Behavior:**
1. User runs `/claim 20260113-4`
2. Bot detects match is unresolved
3. Bot checks time since kickoff (> 3 hours)
4. Bot fetches latest API data
5. Bot finds match is FINISHED with scores
6. Bot updates database with result
7. Bot resolves match on-chain
8. Bot proceeds with claim process
9. User sees claim interface (if they won) or appropriate message

**Console Logs:**
```
🔄 Auto-resolve attempt for match 20260113-4: HSV vs Leverkusen (Status: POSTPONED)
   ✅ Database updated: 2-1 (HOME)
   ✅ On-chain resolution successful for match 123
   🎉 Auto-resolution complete! Match 20260113-4 is now resolved
```

### Scenario 2: Match Still Not Finished
**Setup:**
1. Match is unresolved
2. 3+ hours have passed since kickoff
3. API still shows status as POSTPONED or IN_PLAY

**Expected Behavior:**
1. User runs `/claim 20260113-4`
2. Bot attempts auto-resolution
3. Bot fetches API data
4. Bot finds match is not FINISHED
5. Bot returns original match
6. User sees "Match hasn't been resolved yet" message

**Console Logs:**
```
🔄 Auto-resolve attempt for match 20260113-4: HSV vs Leverkusen (Status: POSTPONED)
   ℹ️ Match still not finished (Status: POSTPONED)
```

### Scenario 3: Too Soon After Kickoff
**Setup:**
1. Match is unresolved
2. Less than 3 hours have passed since kickoff

**Expected Behavior:**
1. User runs `/claim 20260113-4`
2. Bot skips auto-resolution (too soon)
3. User sees "Match hasn't been resolved yet" message

**Console Logs:**
(No auto-resolve logs)

### Scenario 4: API Error During Auto-Resolution
**Setup:**
1. Match meets all criteria for auto-resolution
2. API request fails or returns invalid data

**Expected Behavior:**
1. User runs `/claim 20260113-4`
2. Bot attempts auto-resolution
3. API call fails
4. Bot catches error and returns original match
5. User sees "Match hasn't been resolved yet" message

**Console Logs:**
```
🔄 Auto-resolve attempt for match 20260113-4: HSV vs Leverkusen (Status: POSTPONED)
   ❌ Auto-resolve failed for match 123: API error message
```

## Manual Testing Steps

1. **Find a postponed match in the database:**
   ```sql
   SELECT * FROM matches WHERE status = 'POSTPONED' AND on_chain_match_id IS NOT NULL;
   ```

2. **Manually update kickoff time to be 4 hours ago:**
   ```sql
   UPDATE matches SET kickoff_time = strftime('%s', 'now') - 14400 WHERE id = <match_id>;
   ```

3. **Try to claim:**
   ```
   /claim <match_code>
   ```

4. **Check console logs** for auto-resolution attempt

5. **Verify behavior** matches expected scenario

## Success Criteria

✅ Auto-resolution only triggers when conditions are met
✅ API is called to fetch latest match data
✅ Database is updated when match is finished
✅ On-chain resolution is attempted
✅ Errors are caught and logged
✅ User experience is seamless (no extra steps required)
✅ Works for both `/claim` and `/claim_refund` commands

## Notes

- The 3-hour threshold is conservative to avoid resolving matches too early
- Auto-resolution is "best effort" - if it fails, users can still use `/resolve` command
- Logging is verbose to help debug edge cases
- The feature is self-healing - the system fixes itself when users interact with it

