# Postponement Auto-Cancellation Improvements

## Overview

Enhanced the auto-cancellation system for postponed matches with two major improvements:

1. **Same-Day Postponement Cancellation** - Cancel postponed matches on the same day after a configurable delay
2. **Channel Notifications** - Notify users when matches are auto-cancelled

## Changes Made

### 1. Database Schema Update

**File:** `src/db/index.ts`

Added `postponed_at` column to track when a match was first marked as postponed:

```sql
ALTER TABLE matches ADD COLUMN postponed_at INTEGER
```

**TypeScript Type Update:** `src/types/index.ts`
```typescript
export interface DBMatch {
  // ... existing fields
  postponed_at: number | null; // Unix timestamp when match was first marked as postponed
}
```

### 2. Postponed Timestamp Tracking

**File:** `src/db/index.ts` (lines 227-240)

Updated `upsertMatch()` to automatically set `postponed_at` when a match transitions to POSTPONED status:

```typescript
// Track postponed_at timestamp if transitioning to POSTPONED
const shouldSetPostponedAt =
  match.status === "POSTPONED" && existing.status !== "POSTPONED";

const updateStmt = this.db.prepare(`
  UPDATE matches
  SET status = ?,
      postponed_at = ${shouldSetPostponedAt ? "strftime('%s', 'now')" : "postponed_at"}
  WHERE api_match_id = ?
`);
```

### 3. Configuration

**File:** `src/config/index.ts`

Added configurable delay for same-day postponement cancellation:

```typescript
cancellation: {
  // Delay before auto-cancelling same-day postponed matches (in seconds)
  // Default: 1 hour (3600 seconds)
  postponementDelay: parseInt(
    optionalEnv("POSTPONEMENT_CANCEL_DELAY", "3600")
  ),
}
```

**Environment Variable:** `POSTPONEMENT_CANCEL_DELAY` (optional, defaults to 3600 seconds / 1 hour)

### 4. Enhanced Auto-Cancel Logic

**File:** `src/scheduler.ts` (lines 930-1089)

Completely rewrote `autoCancelPostponedMatches()` with:

#### A. Same-Day Postponement Support

```typescript
const isFromPastDate = matchDateStr < todayStr;
const isSameDayPostponement = matchDateStr === todayStr;

if (isFromPastDate) {
  shouldCancel = true;
  cancelReason = "Match from past date - auto-cancelled";
} else if (isSameDayPostponement && match.postponed_at) {
  const timeSincePostponed = now - match.postponed_at;
  if (timeSincePostponed >= postponementDelay) {
    shouldCancel = true;
    const hoursWaited = Math.floor(timeSincePostponed / 3600);
    cancelReason = `Same-day postponement - auto-cancelled after ${hoursWaited}h`;
  }
}
```

#### B. Channel Notifications

```typescript
// Track cancelled matches
const cancelledMatches: Array<{
  homeTeam: string;
  awayTeam: string;
  competition: string;
  matchCode: string;
}> = [];

// ... after successful cancellation
cancelledMatches.push({
  homeTeam: match.home_team,
  awayTeam: match.away_team,
  competition: match.competition,
  matchCode: match.match_code,
});

// Send notification to channel
if (cancelledCount > 0 && botInstance && defaultChannelId) {
  const matchList = cancelledMatches
    .map((m) => `• **${m.homeTeam} vs ${m.awayTeam}** (${m.competition})`)
    .join("\n");

  await botInstance.sendMessage(
    defaultChannelId,
    `🚫 **Match${cancelledCount > 1 ? "es" : ""} Cancelled**

${matchList}

${cancelledCount > 1 ? "These matches were" : "This match was"} postponed and ${
      cancelledCount > 1 ? "have" : "has"
    } been automatically cancelled.

💰 **Refunds Available:** All bettors can claim refunds using \`/claim\``
  );
}
```

### 5. Increased Polling Frequency

**File:** `src/scheduler.ts` (lines 191-196)

Changed auto-cancel interval from 6 hours to 15 minutes to catch same-day postponements faster:

```typescript
// Auto-cancel postponed matches every 15 minutes
intervals.push(
  setInterval(() => {
    autoCancelPostponedMatches();
  }, 15 * 60 * 1000) // 15 minutes (was 6 hours)
);
```

## How It Works

### Scenario 1: Past-Date Postponement

1. Match scheduled for 2026-01-12 is postponed
2. On 2026-01-13 (or later), scheduler runs
3. Match is immediately cancelled on-chain
4. Database updated to CANCELLED
5. Notification sent to channel

### Scenario 2: Same-Day Postponement

1. Match scheduled for 2026-01-15 at 3:00 PM is postponed at 1:00 PM
2. `postponed_at` timestamp is set to 1:00 PM
3. Scheduler runs every 15 minutes
4. At 2:00 PM (1 hour later), match is cancelled on-chain
5. Database updated to CANCELLED
6. Notification sent to channel

### Scenario 3: Multiple Matches Cancelled

```
🚫 Matches Cancelled

• Manchester United vs Liverpool (Premier League)
• Barcelona vs Real Madrid (La Liga)
• Bayern Munich vs Dortmund (Bundesliga)

These matches were postponed and have been automatically cancelled.

💰 Refunds Available: All bettors can claim refunds using `/claim`
```

## Testing

To test the implementation:

1. **Test same-day postponement:**
   - Set `POSTPONEMENT_CANCEL_DELAY=60` (1 minute for testing)
   - Manually mark a match as POSTPONED in the database
   - Wait 1 minute
   - Check logs for auto-cancellation

2. **Test past-date postponement:**
   - Manually mark an old match as POSTPONED
   - Run `/trigger cancel` command
   - Check logs and channel for notification

3. **Test notification:**
   - Ensure `DEFAULT_CHANNEL_ID` is set in `.env`
   - Trigger auto-cancel
   - Check channel for notification message

## Benefits

1. ✅ **Faster Response** - Same-day postponements are cancelled within 1 hour (configurable)
2. ✅ **User Awareness** - Bettors are notified immediately when matches are cancelled
3. ✅ **Automatic Refunds** - Users know they can claim refunds via `/claim`
4. ✅ **Reduced Manual Work** - No need for admin to manually cancel and notify
5. ✅ **Configurable** - Delay can be adjusted via environment variable

## Configuration

Add to `.env` (optional):

```bash
# Delay before auto-cancelling same-day postponed matches (in seconds)
# Default: 3600 (1 hour)
POSTPONEMENT_CANCEL_DELAY=3600

# Channel for notifications (required for notifications to work)
DEFAULT_CHANNEL_ID=your_channel_id_here
```

