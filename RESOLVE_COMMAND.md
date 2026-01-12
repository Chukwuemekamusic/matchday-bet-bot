# Admin `/resolve` Command

## Overview

The `/resolve` command allows the bot administrator to manually resolve finished matches. This is useful for:
- Immediate resolution without waiting for the scheduler
- Manual intervention when the scheduler fails
- Testing the resolution flow
- Handling edge cases

## Setup

### 1. Add Your Admin User ID to `.env`

Add your Ethereum address to the `.env` file:

```bash
ADMIN_USER_ID=0xYourEthereumAddressHere
```

**How to find your user ID:**
- Your user ID in Towns is your Ethereum address (the one you use to sign in)
- It should be a 42-character hex string starting with `0x`
- You can temporarily add `console.log("User ID:", userId)` to any command to see it

### 2. Restart the Bot

After adding the `ADMIN_USER_ID` to your `.env` file, restart the bot:

```bash
bun run dev
# or
bun run start
```

## Usage

```bash
/resolve <match#>
```

**Example:**
```bash
/resolve 1
```

Use `/matches` to see today's match numbers.

## How It Works

1. **Admin Check**: Verifies that the user is the configured admin
2. **Match Validation**: Checks that the match exists and is on-chain
3. **Fetch Latest Data**: Gets the latest match status from the Football API
4. **Verify Finished**: Ensures the match has actually finished
5. **Get Scores**: Retrieves the final score
6. **Determine Outcome**: Calculates the result (Home/Draw/Away)
7. **Update Database**: Saves the result locally
8. **Resolve On-Chain**: Calls the smart contract to resolve the match
9. **Confirm Success**: Shows the result and transaction hash

## Error Messages

### Access Denied
```
❌ Access Denied
This command is only available to the bot administrator.
```
**Solution:** Make sure your `ADMIN_USER_ID` in `.env` matches your Ethereum address.

### Match Not Found
```
❌ Match #X not found for today.
```
**Solution:** Use `/matches` to see available match numbers.

### Match Not On-Chain
```
❌ Cannot Resolve Match
This match hasn't been created on-chain yet (no bets placed).
```
**Solution:** Only matches with bets can be resolved. This match has no on-chain activity.

### Match Not Finished
```
❌ Match Not Finished
Status: IN_PLAY
Cannot resolve a match that hasn't finished yet.
```
**Solution:** Wait for the match to finish before resolving.

### Already Resolved
```
ℹ️ Match Already Resolved
Score: 2 - 1
Result: HOME
```
**Info:** The match has already been resolved. No action needed.

## Success Example

```
✅ Match Resolved Successfully

🏁 Manchester United 2 - 1 Liverpool

Result: HOME
💰 Total Pool: 0.5 ETH
🔗 Transaction: 0x1234...5678

Winners can now claim their winnings using `/claim 1`
```

## Comparison: Scheduler vs Manual Resolution

| Feature | Scheduler | `/resolve` Command |
|---------|-----------|-------------------|
| **Trigger** | Automatic (every 15 min) | Manual (admin only) |
| **Use Case** | Normal operation | Immediate resolution, testing |
| **Batch Support** | Yes (efficient) | No (single match) |
| **Access** | System | Admin only |
| **When to Use** | Default | When you need control |

## Technical Details

- **Admin Check:** `userId !== config.admin.userId`
- **Database Update:** `db.updateMatchResult()`
- **On-Chain Resolution:** `contractService.resolveMatch()`
- **API Call:** `footballApi.getMatch()` for latest data
- **Outcome Determination:** `FootballAPIService.determineOutcome()`

## Files Modified

1. **`src/config/index.ts`** - Added `admin.userId` configuration
2. **`src/commands.ts`** - Added `/resolve` command definition
3. **`src/index.ts`** - Implemented `/resolve` command handler
4. **`.env.sample`** - Documented `ADMIN_USER_ID` variable

## Security

- Only the configured admin user ID can execute this command
- All other users receive an "Access Denied" message
- The admin user ID is stored in the `.env` file (not committed to git)
- No sensitive information is exposed in error messages

