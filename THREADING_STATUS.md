# Threading Implementation Status

## Overview
Implementing automatic thread creation for personal commands to declutter the main channel while keeping global/informational commands visible to everyone.

## ✅ Completed (5 commands)

### Betting Flow Commands
1. **`/bet`** - Place a bet
   - ✅ Signature updated with `eventId` and `threadId`
   - ✅ All 12 `sendMessage` calls now use threading
   - ✅ Creates thread on first message, maintains thread on subsequent messages

2. **`/pending`** - Check pending bet status
   - ✅ Fully threaded
   - ✅ Stays in same thread as `/bet` when user checks status

3. **`/cancel`** - Cancel pending bet
   - ✅ Fully threaded
   - ✅ Stays in same thread as `/bet` and `/pending`

### User Bets Commands
4. **`/mybets`** - Show user's active bets
   - ✅ Fully threaded
   - ✅ Long bet lists now stay in threads instead of cluttering main channel

5. **`/claim`** - Claim winnings (PARTIAL)
   - ✅ Signature updated
   - ⚠️ Most `sendMessage` calls threaded (15+ updated)
   - ⚠️ May have a few remaining calls to update

## ❌ Remaining Work (11 commands)

### Claims Commands (3 remaining)
- **`/claim_refund`** - Claim refund from cancelled match
- **`/claimable`** - List all unclaimed winnings
- **`/claim_all`** - Claim all unclaimed winnings at once

### Stats Commands (3)
- **`/stats`** - Show betting statistics
- **`/verify`** - Verify and sync bets with on-chain state
- **`/migrate`** - Migrate existing on-chain bets to database

### Debug Commands (4)
- **`/contractinfo`** - Show contract version and configuration
- **`/botinfo`** - Show bot wallet addresses and balance
- **`/userHasBet`** - Test if user has bet on a match
- **`/resolve`** - Manually resolve a finished match

## 🎯 Testing Instructions

### 1. Start the bot
```bash
bun run dev
```

### 2. Test Threading Behavior

#### Test Case 1: Betting Flow
1. In main channel, run `/bet 1 home 0.01`
   - **Expected**: A thread should be created automatically
2. In that same thread, run `/pending`
   - **Expected**: Response should appear in the thread
3. In that same thread, run `/cancel`
   - **Expected**: Confirmation should appear in the thread

#### Test Case 2: My Bets
1. In main channel, run `/mybets`
   - **Expected**: A new thread should be created automatically
   - **Expected**: Long bet list appears in thread, not main channel

#### Test Case 3: Thread Persistence
1. In main channel, run `/bet 2 away 0.02`
   - **Expected**: Creates Thread A
2. In Thread A, run `/pending`
   - **Expected**: Stays in Thread A
3. In main channel, run another command like `/matches`
   - **Expected**: Appears in main channel (not threaded)
4. Go back to Thread A, run `/cancel`
   - **Expected**: Still stays in Thread A

### 3. Global Commands (Should NOT Thread)
These should still appear in main channel:
- `/help` - Help message
- `/matches` - Today's matches
- `/odds` - Match odds
- `/leaderboard` - Global leaderboard
- `/winners` - Match winners
- `/fetch` - Admin fetch matches

## 📋 Implementation Details

### Files Modified
1. **`src/utils/threadRouter.ts`**
   - Updated `THREAD_COMMANDS` array with all 16 personal commands
   - `getThreadMessageOpts()` utility handles threading logic

2. **`src/index.ts`**
   - Added import: `import { getThreadMessageOpts } from "./utils/threadRouter"`
   - Updated 5 command handlers (bet, pending, cancel, mybets, claim*)
   - Each handler now:
     - Accepts `eventId` and `threadId` in destructured parameters
     - Calls `const opts = getThreadMessageOpts(threadId, eventId)`
     - Passes `opts` to all `sendMessage()` calls

### Threading Logic
The `getThreadMessageOpts()` function handles the logic:
- **First message in thread**: Uses `{ threadId: eventId }` to create a NEW thread
- **Subsequent messages**: Uses `{ threadId }` to stay in the existing thread
- **Result**: Seamless threading without manual management, creates clickable thread sidebars

## 🔄 Next Steps (Future Work)

To complete the threading implementation:

1. **Finish `/claim` command** - Check for any remaining `sendMessage` calls
2. **Update remaining 10 commands** following the same pattern:
   - Add `eventId, threadId` to signature
   - Add `const opts = getThreadMessageOpts(threadId, eventId)` at start
   - Add `, opts` to all `handler.sendMessage()` calls

3. **Pattern to follow**:
```typescript
// Before
bot.onSlashCommand("command", async (handler, { channelId, userId }) => {
  await handler.sendMessage(channelId, "message");
});

// After
bot.onSlashCommand("command", async (handler, { channelId, userId, eventId, threadId }) => {
  const opts = getThreadMessageOpts(threadId, eventId);
  await handler.sendMessage(channelId, "message", opts);
});
```

## ✨ Benefits

### UX Improvements
✅ Main channel stays clean and focused on global info
✅ Personal betting interactions happen in user-specific threads
✅ Easy to track conversation history per user
✅ Reduces notification noise for other users

### Technical Implementation
✅ Uses native Towns Protocol threading (no database needed)
✅ Automatic thread creation/maintenance
✅ No breaking changes - backward compatible
✅ Minimal code changes per command

## 📝 Notes
- Type checking passes ✅
- No runtime errors expected
- Thread IDs are managed by Towns Protocol
- First message with `threadId: eventId` creates a NEW thread
- Subsequent messages with `threadId` maintain the thread
- Using `threadId` (not `replyId`) creates clickable thread sidebars in Towns UI
