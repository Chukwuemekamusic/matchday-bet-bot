# Thread Support Implementation Summary

## ✅ Completed Updates

### Message Handlers
- ✅ `onMessage` - Now respects `threadId` parameter and stays in threads

### Admin Commands  
- ✅ `/contractinfo` - Uses `getThreadMessageOpts(threadId, eventId)`
- ✅ `/botinfo` - Uses `getThreadMessageOpts(threadId, eventId)`
- ✅ `/userHasBet` - Uses `getThreadMessageOpts(threadId, eventId)`

### User Commands (Already Had Thread Support)
- ✅ `/help` - Uses `getSmartThreadOpts(threadId)`
- ✅ `/matches` - Uses `getSmartThreadOpts(threadId)`
- ✅ `/odds` - Uses `getSmartThreadOpts(threadId)`
- ✅ `/bet` - Uses `getThreadMessageOpts(threadId, eventId)`
- ✅ `/pending` - Uses `getThreadMessageOpts(threadId, eventId)`
- ✅ `/cancel` - Uses `getThreadMessageOpts(threadId, eventId)`
- ✅ `/mybets` - Uses `getThreadMessageOpts(threadId, eventId)`
- ✅ `/claim` - Uses `getThreadMessageOpts(threadId, eventId)`
- ✅ `/claim_refund` - Uses `getThreadMessageOpts(threadId, eventId)`
- ✅ `/claimable` - Uses `getThreadMessageOpts(threadId, eventId)`
- ✅ `/claim_all` - Uses `getThreadMessageOpts(threadId, eventId)`
- ✅ `/stats` - Uses `getThreadMessageOpts(threadId, eventId)`
- ✅ `/leaderboard` - Uses `getSmartThreadOpts(threadId)`

## ⚠️ Remaining Commands to Update

The following commands still need thread support added. They need to:
1. Add `threadId` (and possibly `eventId`) to their parameter destructuring
2. Call appropriate thread helper function
3. Pass `opts` to all `sendMessage` calls

### Commands Needing Updates:
- `/winners` - Should use `getSmartThreadOpts(threadId)` (informational command)
- `/migrate` - Should use `getThreadMessageOpts(threadId, eventId)` (personal command)
- `/fetch` - Should use `getSmartThreadOpts(threadId)` (admin/informational)
- `/resolve` - Should use `getThreadMessageOpts(threadId, eventId)` (admin command)

## Thread Helper Functions

### `getThreadMessageOpts(threadId, eventId)`
**Use for:** Personal/interactive commands that should create or stay in threads
- Creates a new thread if not in one (using eventId)
- Stays in existing thread if already in one
- Examples: `/bet`, `/claim`, `/stats`, `/mybets`

### `getSmartThreadOpts(threadId)`
**Use for:** Informational commands that shouldn't create new threads
- Stays in thread if already in one
- Doesn't create new thread if in main channel
- Examples: `/matches`, `/odds`, `/help`, `/leaderboard`

## Implementation Pattern

```typescript
// For personal/interactive commands:
bot.onSlashCommand("command", async (handler, { channelId, userId, args, threadId, eventId }) => {
  const opts = getThreadMessageOpts(threadId, eventId);
  // ... rest of handler
  await handler.sendMessage(channelId, message, opts);
});

// For informational commands:
bot.onSlashCommand("command", async (handler, { channelId, args, threadId }) => {
  const opts = getSmartThreadOpts(threadId);
  // ... rest of handler
  await handler.sendMessage(channelId, message, opts);
});
```

## Benefits

1. **Better UX**: Responses stay in the same thread where the command was issued
2. **Cleaner Channels**: Personal interactions don't clutter the main channel
3. **Context Preservation**: Thread conversations remain coherent
4. **Consistent Behavior**: All commands behave predictably with threads

