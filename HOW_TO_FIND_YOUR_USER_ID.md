# How to Find Your User ID for Admin Commands

Your user ID in Towns Protocol is your **Ethereum address** (the wallet address you use to sign in to Towns).

## Method 1: Check Your Towns Profile

1. Open Towns app
2. Go to your profile settings
3. Your user ID is your wallet address (starts with `0x`)

## Method 2: Use a Test Command

Add a temporary log to any command to see your user ID:

### Option A: Add to `/help` command

In `src/index.ts`, find the `/help` command and add this line at the beginning:

```typescript
bot.onSlashCommand("help", async (handler, { channelId, userId }) => {
  console.log("🔍 YOUR USER ID:", userId);  // <-- Add this line
  
  // ... rest of the command
});
```

Then:
1. Restart the bot: `bun run dev`
2. Run `/help` in Towns
3. Check the bot logs - you'll see: `🔍 YOUR USER ID: 0x...`
4. Copy that address
5. Remove the console.log line

### Option B: Create a temporary `/whoami` command

Add this to `src/index.ts` (before the "START BOT" section):

```typescript
// Temporary command to find your user ID
bot.onSlashCommand("whoami", async (handler, { channelId, userId }) => {
  await handler.sendMessage(
    channelId,
    `Your user ID is: \`${userId}\`\n\nCopy this address and add it to your .env file as ADMIN_USER_ID`
  );
});
```

Don't forget to also add it to `src/commands.ts`:

```typescript
{
  name: "whoami",
  description: "Show your user ID",
},
```

Then:
1. Restart the bot
2. Run `/whoami` in Towns
3. Copy the address from the bot's response
4. Add to `.env`: `ADMIN_USER_ID=0x...`
5. Remove the `/whoami` command (optional)

## Method 3: Check Bot Logs

When you interact with the bot, your user ID appears in the logs. Look for lines like:

```
User 0x1234567890abcdef... executed /matches
```

## Setting Up Admin Access

Once you have your user ID:

1. Open `matchday_bet_bot/.env`
2. Add this line:
   ```bash
   ADMIN_USER_ID=0xYourAddressHere
   ```
3. Save the file
4. Restart the bot: `bun run dev`

## Verify It Works

Try running `/resolve 1` (or any match number):

- ✅ **If you're the admin:** You'll see the command execute (or an error if the match isn't ready)
- ❌ **If you're not the admin:** You'll see "Access Denied"

## Example

```bash
# In your .env file
ADMIN_USER_ID=0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
```

## Security Note

- Never commit your `.env` file to git
- The `.env` file is already in `.gitignore`
- Only share your user ID with trusted parties
- Anyone with access to the admin user ID can resolve matches manually

