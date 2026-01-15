# Test Scenario: Match 20260113-4 (HSV vs Leverkusen)

## Current Situation

**Match Code:** `20260113-4`
**Teams:** HSV vs Leverkusen
**Original Kickoff:** 2026-01-13 (2 days ago)
**Status:** POSTPONED
**Current Date:** 2026-01-15

## Expected Behavior

When a user runs `/claim 20260113-4`, the bot should:

1. **Detect postponed match from past date:**
   - Extract date from match_code: `20260113`
   - Compare to today: `20260115`
   - `20260113 < 20260115` ✅
   - Status is `POSTPONED` ✅
   - **Trigger:** Auto-resolution attempt

2. **Fetch latest match data from API:**
   - Call Football-Data.org API with `api_match_id`
   - Check if match status is now `FINISHED`

3. **If match is finished:**
   - Extract final score (e.g., 2-1)
   - Determine outcome (HOME/DRAW/AWAY)
   - Update database with result
   - Resolve match on-chain
   - Proceed with claim process

4. **If match is still postponed:**
   - Log: "Match still not finished (Status: POSTPONED)"
   - Show user: "Match hasn't been resolved yet"

## Console Output (Expected)

### Scenario A: Match is now finished

```
🔄 Auto-resolve attempt for match 20260113-4: HSV vs Leverkusen (Status: POSTPONED, Reason: postponed match from past date)
   ✅ Database updated: 2-1 (HOME)
   ✅ On-chain resolution successful for match 123
   🎉 Auto-resolution complete! Match 20260113-4 is now resolved
```

Then the `/claim` command proceeds normally with the claim interface.

### Scenario B: Match is still postponed

```
🔄 Auto-resolve attempt for match 20260113-4: HSV vs Leverkusen (Status: POSTPONED, Reason: postponed match from past date)
   ℹ️ Match still not finished (Status: POSTPONED)
```

User sees:
```
⏳ Match hasn't been resolved yet.

HSV vs Leverkusen Status: POSTPONED

You can claim once the match is finished and resolved.
```

### Scenario C: API error

```
🔄 Auto-resolve attempt for match 20260113-4: HSV vs Leverkusen (Status: POSTPONED, Reason: postponed match from past date)
   ❌ Auto-resolve failed for match 123: Network timeout
```

User sees:
```
⏳ Match hasn't been resolved yet.

HSV vs Leverkusen Status: POSTPONED

You can claim once the match is finished and resolved.
```

## How to Test

### 1. Check current match status in database

```bash
bun run src/db/query.ts
```

```sql
SELECT 
  id, 
  match_code, 
  home_team, 
  away_team, 
  status, 
  kickoff_time,
  on_chain_match_id,
  result
FROM matches 
WHERE match_code = '20260113-4';
```

### 2. Run the claim command

In Towns chat:
```
/claim 20260113-4
```

### 3. Watch the console logs

Look for the auto-resolution attempt log with the reason.

### 4. Verify the outcome

- If match was finished in API → Should resolve and show claim interface
- If match is still postponed → Should show "not resolved yet" message
- Check database to see if `result` was updated

## Key Points to Verify

✅ **Date extraction works:** `20260113` is correctly extracted from `20260113-4`
✅ **Date comparison works:** `20260113 < 20260115` evaluates to true
✅ **Status check works:** Match status is `POSTPONED`
✅ **Reason is logged:** Console shows "Reason: postponed match from past date"
✅ **API is called:** Football-Data.org API is queried for latest match data
✅ **Resolution happens:** If match is finished, database and contract are updated

## Debugging

If auto-resolution doesn't trigger, check:

1. **Match has on-chain ID:**
   ```sql
   SELECT on_chain_match_id FROM matches WHERE match_code = '20260113-4';
   ```
   Should NOT be NULL.

2. **Match is unresolved:**
   ```sql
   SELECT result FROM matches WHERE match_code = '20260113-4';
   ```
   Should be NULL.

3. **Match code exists:**
   ```sql
   SELECT match_code FROM matches WHERE match_code = '20260113-4';
   ```
   Should return the match.

4. **Date comparison:**
   - Today's date in UTC: Check `new Date().toISOString()`
   - Match date from code: `20260113`
   - Should be: `20260113 < 20260115`

## Success Criteria

✅ Auto-resolution is attempted for match `20260113-4`
✅ Console log shows "Reason: postponed match from past date"
✅ If match is finished in API, it gets resolved automatically
✅ User can proceed with claim without admin intervention

