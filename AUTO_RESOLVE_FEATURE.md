# Auto-Resolution Feature

## Overview

The auto-resolution feature automatically attempts to resolve matches when users try to claim winnings or refunds. This is particularly useful for handling edge cases like postponed matches that were rescheduled and finished but weren't caught by the scheduler.

## Problem Solved

Previously, when a match was postponed and later rescheduled:

1. The scheduler's `pollMatchResults()` excludes matches with status `POSTPONED` (see `getMatchesAwaitingResults()`)
2. If the match was rescheduled and finished, it wouldn't be automatically resolved
3. Users trying to `/claim` would see "Match hasn't been resolved yet" with no way forward
4. Admin intervention or manual `/resolve` command was required

## Solution

When a user tries to `/claim` or `/claim_refund` on an unresolved match, the bot now:

1. **Smart detection**: Checks if match is from a past date (via match_code) AND status is POSTPONED
   - If yes → Always attempts resolution (match was clearly rescheduled)
   - If no → Falls back to 3-hour check since kickoff
2. Fetches the latest match status from the Football API
3. If the match is now FINISHED, automatically resolves it
4. Proceeds with the claim process seamlessly

## Implementation

### Helper Function: `tryAutoResolveMatch()`

**Location:** `src/index.ts` (lines 44-167)

**Signature:**

```typescript
async function tryAutoResolveMatch(match: DBMatch): Promise<DBMatch>;
```

**Logic:**

1. **Early returns** if match is already resolved or has no on-chain ID
2. **Smart detection**:
   - Extracts date from `match_code` (format: `YYYYMMDD-N`)
   - If match date < today AND status is POSTPONED → Always attempt (reason: "postponed match from past date")
   - Otherwise, check if 3+ hours have passed since kickoff → Attempt if true (reason: "3+ hours since kickoff")
3. **API fetch**: Gets latest match data from Football-Data.org
4. **Status check**: Verifies match is FINISHED with valid scores
5. **Database update**: Updates local database with result
6. **On-chain resolution**: Calls contract to resolve match on-chain
7. **Return**: Returns updated match object or original on error

**Error Handling:**

- All errors are caught and logged
- Returns original match on any failure
- User sees standard "not resolved" message if auto-resolution fails

### Integration Points

#### 1. `/claim` Command

**Location:** Line 1142 in `src/index.ts`

```typescript
// Try to auto-resolve if match is unresolved but enough time has passed
match = await tryAutoResolveMatch(match);
```

**Placement:** After on-chain check, before resolution check

#### 2. `/claim_refund` Command

**Location:** Line 1487 in `src/index.ts`

```typescript
// Try to auto-resolve if match is unresolved but enough time has passed
match = await tryAutoResolveMatch(match);
```

**Placement:** After on-chain check, before eligibility check

## User Experience

### Before Auto-Resolution

```
User: /claim 20260113-4

Bot: ⏳ Match hasn't been resolved yet.

HSV vs Leverkusen Status: POSTPONED

You can claim once the match is finished and resolved.
```

User is stuck and needs admin help.

### After Auto-Resolution

```
User: /claim 20260113-4

[Bot silently checks API, finds match finished, resolves it]

Bot: 💰 Claim Your Winnings
[Shows claim interface]
```

User gets seamless experience!

## Console Logging

The feature includes verbose logging for debugging:

**Successful auto-resolution (postponed match from past date):**

```
🔄 Auto-resolve attempt for match 20260113-4: HSV vs Leverkusen (Status: POSTPONED, Reason: postponed match from past date)
   ✅ Database updated: 2-1 (HOME)
   ✅ On-chain resolution successful for match 123
   🎉 Auto-resolution complete! Match 20260113-4 is now resolved
```

**Successful auto-resolution (3+ hours since kickoff):**

```
🔄 Auto-resolve attempt for match 20260115-2: Arsenal vs Chelsea (Status: SCHEDULED, Reason: 3+ hours since kickoff)
   ✅ Database updated: 3-1 (HOME)
   ✅ On-chain resolution successful for match 124
   🎉 Auto-resolution complete! Match 20260115-2 is now resolved
```

**Match still not finished:**

```
🔄 Auto-resolve attempt for match 20260113-4: HSV vs Leverkusen (Status: POSTPONED, Reason: postponed match from past date)
   ℹ️ Match still not finished (Status: POSTPONED)
```

**API error:**

```
🔄 Auto-resolve attempt for match 20260113-4: HSV vs Leverkusen (Status: POSTPONED, Reason: postponed match from past date)
   ❌ Auto-resolve failed for match 123: Network error
```

## Configuration

### Primary Logic: Match Code Date Check

**Location:** Lines 59-73 in `src/index.ts`

The bot extracts the date from `match_code` (format: `YYYYMMDD-N`) and compares it to today's date:

- If `matchDateStr < todayStr` AND `status === "POSTPONED"` → Always attempt resolution
- This is the **primary** detection method for postponed matches that were rescheduled

### Fallback Logic: Time Threshold

**Time Threshold:** 3 hours after kickoff

- Conservative to avoid resolving matches too early
- Typical match duration is ~2 hours
- Gives buffer for extra time, delays, etc.

**Location:** Lines 75-85 in `src/index.ts`

```typescript
const threeHours = 3 * 60 * 60;
```

To change the threshold, modify this constant.

## Benefits

✅ **Better UX**: Users don't need admin intervention
✅ **Self-healing**: System fixes itself when users interact
✅ **Handles edge cases**: Catches postponed→rescheduled→finished matches
✅ **Minimal overhead**: Only triggers on user action, not constant polling
✅ **Safe**: All errors caught, returns original match on failure
✅ **Transparent**: Verbose logging for debugging

## Testing

See `test-auto-resolve.md` for detailed test scenarios and manual testing steps.

## Future Enhancements

Potential improvements:

- Make time threshold configurable via environment variable
- Add metrics/analytics for auto-resolution success rate
- Consider adding auto-resolution to other commands (e.g., `/odds`, `/winners`)
- Add user notification when auto-resolution succeeds ("✨ Match was just resolved!")
