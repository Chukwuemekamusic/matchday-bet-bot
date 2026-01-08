# Project Structure

```
matchday_bet_bot/
   src/
      index.ts              # Main bot entry point
                            # - Initializes Towns bot with makeTownsBot()
                            # - Registers all slash command handlers
                            # - Starts Hono web server for webhooks
                            # - Launches scheduler for automated tasks
      
      commands.ts           # Slash command definitions
                            # - Exports array of command metadata
                            # - Used by Towns Protocol for command registration
      
      scheduler.ts          # Automated background tasks
                            # - Fetch matches every 6 hours
                            # - Close betting at kickoff (every 1 minute)
                            # - Check match results (every 15 minutes)
                            # - Cleanup expired pending bets (every 5 minutes)
      
      config/
         index.ts           # Environment configuration
                            # - Loads and validates environment variables
                            # - Provides typed config object with defaults
      
      db/
         index.ts           # SQLite database layer (DatabaseService class)
                            # - Schema: matches, pending_bets, user_stats, posted_messages
                            # - All database operations and queries
                            # - Singleton export used throughout app
      
      services/
         contract.ts        # Smart contract interactions (ContractService class)
                            # - Reads/writes to MatchDayBet contract via Viem
                            # - Uses bot's smart account (bot.appAddress)
                            # - Handles match creation, betting, resolution
         
         footballApi.ts     # Football-Data.org API client
                            # - Fetches live match data
                            # - Filters by supported competitions
                            # - Rate limit: 10 requests/minute (free tier)
      
      types/
         index.ts           # TypeScript types and enums
                            # - Outcome enum (HOME, DRAW, AWAY)
                            # - Database types (DBMatch, PendingBet, UserStats)
                            # - API response types
      
      utils/
         format.ts          # Formatting and parsing utilities
                            # - Format ETH amounts, times, odds, addresses
                            # - Parse outcomes and ETH amounts from user input
   
   data/
      matchday.db           # SQLite database (auto-created on first run)
                            # - Persistent storage for all bot data
                            # - Delete to reset database in development
   
   .env                     # Environment variables (create from .env.example)
                            # - Required: APP_PRIVATE_DATA, JWT_SECRET, FOOTBALL_API_KEY
                            # - Optional: CONTRACT_ADDRESS, BASE_RPC_URL, etc.
   
   package.json             # Dependencies and scripts
                            # - Runtime: Bun (not Node.js)
                            # - Key deps: @towns-protocol/bot, viem, hono
   
   tsconfig.json            # TypeScript configuration
                            # - Target: ES2022
                            # - Strict mode enabled
```

## Key Architecture Patterns

### Two-Step Betting Flow
1. `/bet` creates a pending bet in the database
2. `/confirm` creates on-chain match (if needed) and prompts user to sign transaction
3. Bot listens for `BetPlaced` events to confirm the bet

### Stateless Bot Design
- No in-memory state (follows Towns Protocol best practices)
- All data persisted to SQLite
- Scheduler tasks are idempotent

### Lazy Contract Interaction
- Contract address is optional in `.env`
- Bot gracefully handles missing contract with informative messages
- Matches only created on-chain when first bet is placed

### Smart Account Architecture
- Bot has two addresses:
  - `bot.botId` - EOA/signer address
  - `bot.appAddress` - Smart account address (fund this for on-chain operations)
- Contract calls use `execute()` from `viem/experimental/erc7821`

