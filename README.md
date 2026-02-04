# MatchDay Bet Bot ⚽💰

**A Towns Protocol bot that brings parimutuel football betting to your community.**

Built for the **Towns Protocol – "Bots That Move Money"** competition. Bet on real matches using ETH, powered by smart contracts on Base L2.

---

## What Makes This Special

- 💸 **Real Money, Real Matches** – Bet ETH on live football across 6 major leagues
- 🤝 **Parimutuel Pool Betting** – Winners split the entire pool proportionally (not house odds)
- ⛓️ **On-Chain Settlement** – Trustless, transparent betting via smart contracts on Base ([Smart contract](https://github.com/Chukwuemekamusic/matchday-contract.git))
- 📊 **Live In-Chat Updates** – Match scores, odds, and results flow right into your Town
- 🏆 **Competition-Ready** – Stats tracking, leaderboards, and seamless wallet integration

---

## For Users: How to Use the Bot

### Getting Started

Once **MatchDay Bet Bot** is added to your Town, you can start betting immediately. The bot fetches live matches daily and posts them to your channel.

**📢 Official Bot Town:** Visit [https://app.towns.com/t/0x6870d50263b4ab420b13c3c03af370b46f57be0a/](https://app.towns.com/t/0x6870d50263b4ab420b13c3c03af370b46f57be0a/) to see daily match announcements and join the community.

> 🚀 **Coming Soon:** Each Town using the bot will be able to configure their own announcement channel for automated match posts.

### Viewing Matches

**`/matches`** – See today's matches with live scores and status

```text
🕒 #1 Arsenal vs Chelsea
   ⏰ 20:00 UTC (in 2h 30m) | Pool: 0.15 ETH

🔴 #2 Man City vs Brighton
   LIVE | 2–1 | Pool: 0.08 ETH

✅ #3 Liverpool 3–0 Everton
   FT | Winner: Liverpool | Pool: 0.5 ETH
```

**`/matches <league>`** – Filter by league

```text
/matches PL        (Premier League)
/matches CL        (Champions League)
/matches SA        (Serie A)
```

**`/odds <match#>`** – View current odds and pool breakdown

```text
/odds 1

Arsenal vs Chelsea
⏰ 20:00 UTC (in 2h 15m)

Current Odds:
🏠 Arsenal: 2.5x (0.06 ETH pool)
🤝 Draw: 3.0x (0.05 ETH pool)
✈️ Chelsea: 2.8x (0.04 ETH pool)

Total Pool: 0.15 ETH
```

---

### Understanding Match Identifiers

Matches can be referenced in two ways:

**Daily Match Number (`#1`, `#2`, etc.)**

- Simple sequential numbers shown in `/matches` output
- Resets daily (e.g., today's `#1` is different from tomorrow's `#1`)
- Example: `/bet 1 home 0.05`

**Match Code (`20260204-1`, `20260204-2`, etc.)**

- Permanent identifier in format `YYYYMMDD-N`
- Stays the same across days
- More reliable for historical matches
- Example: `/bet 20260204-1 home 0.05`

💡 **Tip:** Both formats work for all commands. Use daily numbers for convenience, or match codes for precision.

---

### Placing Bets

**`/bet <match#> <home|draw|away> <amount>`** – Place a bet

```text
/bet 1 home 0.05        (Bet 0.05 ETH on Arsenal)
/bet 2 away 0.01        (Bet 0.01 ETH on Brighton)
/bet 3 draw 0.02        (Bet 0.02 ETH on a draw)
```

or

**`/bet <match_code> <home|draw|away> <amount>`** – Place a bet using the match code

```text
/bet 20260204-1 home 0.05        (Bet 0.05 ETH on Arsenal)
/bet 20260204-2 away 0.01        (Bet 0.01 ETH on Brighton)
/bet 20260204-3 draw 0.02        (Bet 0.02 ETH on a draw)
```

After placing a bet, you'll see a confirmation message with the pending bet details and a **"Confirm Bet"** button. You have **5 minutes** to confirm or cancel.

Click the **"Confirm Bet"** button, and the bot will prompt you to sign the transaction. Once the transaction is mined, you'll receive a success message.

**`/cancel`** – Cancel your pending bet (before clicking the confirm button)

**`/pending`** – Check if you have a pending bet

---

### Managing Your Bets

**`/mybets`** – View all your active bets

```text
Your Active Bets:

Match #1: Arsenal vs Chelsea
  Bet: 0.05 ETH on Arsenal
  Status: Open | Kickoff in 2h 15m

Match #5: Barcelona vs Real Madrid
  Bet: 0.03 ETH on Draw
  Status: Open | Kickoff in 5h 30m
```

**`/verify`** – Sync your bets with on-chain state

- Useful if you think there's a discrepancy between what you see and what's on-chain
- Use this when a transaction goes through but isn't properly captured by the bot
- This is a troubleshooting tool that reconciles the database with blockchain state

**`/claimable`** – List all unclaimed winnings

```text
Claimable Winnings:

Match #3: Liverpool vs Everton
  Your Bet: 0.02 ETH on Liverpool
  Winnings: 0.087 ETH
  → Use /claim 3 to claim

Total Claimable: 0.087 ETH
```

**`/claim <match#>`** – Claim your winnings

```text
/claim 3
```

The bot will show you the winnings amount and a **"Claim Winnings"** button. Click the button, and the bot will prompt you to sign the transaction. Your winnings will be sent to your wallet once the transaction is mined.

**`/claim_all`** – Claim all your unclaimed winnings at once

The bot will guide you through claiming all eligible winnings in a batch transaction.

---

### Seeing active bets

**`/active`** – List all matches with active betting pools

```text
📊 **Active Betting Pools for 2025-09-15**

_2 matches with active betting_

⚽ **Premier League**

• #1 Arsenal vs Chelsea
  Kickoff: 20:00 UTC | Pool: 0.15 ETH
  → Bet with /bet 1 <home|draw|away> <amount>

• #2 Man City vs Brighton
  Kickoff: 19:00 UTC | Pool: 0.08 ETH
  → Bet with /bet 2 <home|draw|away> <amount>

```

### Stats & Leaderboards

**`/stats`** – View your personal betting statistics

```text
Your Betting Stats:

Total Bets: 12
Wins: 5
Win Rate: 41.7%
Total Wagered: 0.24 ETH
Total Won: 0.31 ETH
Profit: +0.07 ETH
```

**`/leaderboard`** – See the top bettors by profit

```text
Top Bettors:

1. 0x1234...5678 – +0.42 ETH (18 bets)
2. 0xabcd...ef01 – +0.31 ETH (25 bets)
3. 0x9876...5432 – +0.12 ETH (9 bets)
```

**`/winners <match#>`** – See winning bettors for a specific match

```text
/winners 3

Winners for Liverpool vs Everton:
1. 0x1234...5678 – 0.05 ETH bet → 0.12 ETH won
2. 0xabcd...ef01 – 0.03 ETH bet → 0.07 ETH won
```

---

### How Betting Works

#### The Parimutuel Model

Unlike traditional sportsbooks, MatchDay Bet Bot uses **parimutuel betting**:

1. All bets go into three pools: **Home**, **Draw**, **Away**
2. Betting closes at kickoff
3. After the match, winners split the **entire pool** proportionally to their stake
4. A small **1% platform fee** applies (only when there are both winners and losers)

#### Betting Rules

1. You can only bet on one outcome per match
2. Minimum bet: 0.001 ETH & Maximum bet: 0.1 ETH (configurable by admin)
3. If everyone bets on the same outcome, you get your stake back (no fee)
4. If there are no winners (everyone bets on the losing outcome), you get your stake back (no fee)
5. If there are winners, you split the pool proportionally to your stake (1% fee)

**Example:**

- Total pool: 1.0 ETH
- Home pool: 0.6 ETH, Draw pool: 0.2 ETH, Away pool: 0.2 ETH
- Result: Home wins
- Winners (Home bettors) split: 0.99 ETH (1% fee)
- If you bet 0.3 ETH on Home (50% of Home pool), you win 0.495 ETH

#### Betting Flow

1. View matches with `/matches`
2. Place a bet: `/bet 1 home 0.05` (or use match code: `/bet 20260204-1 home 0.05`)
3. Click the **"Confirm Bet"** button within 5 minutes
4. Sign the transaction when prompted
5. Wait for the match to finish
6. Check claimable winnings: `/claimable`
7. Claim your winnings: `/claim 1`
8. Click the **"Claim Winnings"** button and sign the transaction

---

### Troubleshooting

**Transaction went through but bot didn't confirm?**

- Use `/verify` to sync your bets with on-chain state
- The bot will check the blockchain and update your bet status

**Can't claim winnings?**

- Check if the match is resolved with `/claimable`
- The bot auto-resolves matches 3+ hours after kickoff
- If the match is postponed, use `/claim_refund` instead

**Pending bet expired?**

- Pending bets expire after 5 minutes for security
- Simply place a new bet with `/bet`

**Wrong wallet used for betting?**

- The bot remembers which wallet you used for each bet
- Claims will automatically use the same wallet

---

### Supported Leagues

| Code | League                    |
| ---- | ------------------------- |
| PL   | Premier League (England)  |
| PD   | La Liga (Spain)           |
| BL1  | Bundesliga (Germany)      |
| SA   | Serie A (Italy)           |
| FL1  | Ligue 1 (France)          |
| CL   | Champions League (Europe) |

---

### Additional Commands

**`/help`** – List all available commands with descriptions

**`/contractinfo`** – Show smart contract details and configuration (for transparency)

view the deployed contract on [basescan](https://basescan.org/address/0x1b048C7323C7c7FE910a5F0e08B36b0c715e8947#code)
view the implementation contract on [basescan](https://basescan.org/address/0x2f0A079981aC1BaA4fEe85619F1f09BB12D9e9e4#code)

> **Note:** Daily match announcements are currently posted to the [official bot Town](https://app.towns.com/t/0x6870d50263b4ab420b13c3c03af370b46f57be0a/). In the future, each Town will be able to configure their own announcement channel.

---

## Why This Bot Wins

### For the Competition

This bot demonstrates true **"money movement"** on Towns Protocol:

- **On-chain value transfer** – Every bet is a real ETH transaction on Base L2
- **Smart contract-powered** – Trustless, transparent, auditable
- **Pull-based payouts** – Users control when to claim winnings (gas-efficient)
- **Dual wallet architecture** – Leverages Towns' smart account system for seamless UX
- **Event-driven confirmations** – Bot monitors blockchain events for real-time updates

### Key Innovations

1. **Lazy Contract Creation** – Matches only created on-chain when first bet arrives (saves gas)
2. **Automated Lifecycle** – Daily match fetching, betting windows, result polling, all automated
3. **Real-world Data Integration** – Live scores from Football-Data.org API
4. **Parimutuel Math** – Dynamic odds calculation, proportional payouts, fee handling
5. **Stateless Design** – Follows Towns best practices (no in-memory state, fully DB-backed)

---

## For Developers & Reviewers

### Tech Stack

**Bot:**

- **Runtime:** Bun (TypeScript)
- **Framework:** Hono (webhooks)
- **Database:** SQLite (via `bun:sqlite`)
- **Blockchain:** Viem (Ethereum)
- **Protocol:** Towns Protocol SDK (`@towns-protocol/bot`)

**Smart Contract:**

- **Language:** Solidity ^0.8.20
- **Framework:** Foundry
- **Chain:** Base L2 (Sepolia testnet + mainnet)
- **Security:** OpenZeppelin (Ownable, Pausable, ReentrancyGuard)

---

### Quick Start

#### Prerequisites

- [Bun](https://bun.sh) v1.0+
- Towns Protocol app credentials
- Football-Data.org API key ([get one here](https://www.football-data.org/client/register))
- MatchDayBet contract deployed on Base (optional for testing)

#### Installation

1. **Clone the repository**

```bash
git clone git@github.com:Chukwuemekamusic/matchday-bet-bot.git
cd matchday_bet_bot
```

2. **Install dependencies**

```bash
bun install
```

3. **Configure environment variables**

```bash
cp .env.sample .env
```

Edit `.env`:

```bash
# Required
APP_PRIVATE_DATA=<your_towns_app_private_data>
JWT_SECRET=<your_jwt_secret>
FOOTBALL_API_KEY=<your_football_data_api_key>

# Optional
CONTRACT_ADDRESS=<contract_address_on_base>
BASE_RPC_URL=https://mainnet.base.org
PORT=5123
MIN_STAKE=0.001
MAX_STAKE=0.1
DATABASE_PATH=/data/matchday.db
SUPPORTED_COMPETITIONS=2021,2014,2002,2019,2015,2001
DEFAULT_CHANNEL_ID=<channel_id_for_announcements>
```

4. **Run the bot**

```bash
# Development (with hot reload)
bun run dev

# Production
bun run start
```

---

### Development Scripts

```bash
bun run dev          # Hot reload
bun run start        # Production
bun run typecheck    # TypeScript checks
bun run lint         # ESLint
bun run lint:fix     # Auto-fix linting issues
bun run build        # Type check (Bun runs TS directly)
```

---

### Project Structure

```text
matchday_bet_bot/
├─ src/
│  ├─ index.ts           # Bot entry point
│  ├─ commands.ts        # Slash command definitions
│  ├─ scheduler.ts       # Automated tasks (fetch, close, resolve)
│  ├─ handlers/          # Command handlers
│  │  ├─ admin.ts        # /help, /post, /dbcheck
│  │  ├─ betting.ts      # /bet, /cancel, /pending
│  │  ├─ claiming.ts     # /claim, /claimable, /claim_all, /claim_refund, /verify
│  │  ├─ matches.ts      # /matches, /odds, /active, /mybets, /winners
│  │  └─ stats.ts        # /stats, /leaderboard
│  ├─ services/          # External integrations
│  │  ├─ contract.ts     # On-chain interactions (Viem)
│  │  ├─ footballApi.ts  # Match data fetching
│  │  └─ subgraph.ts     # Event querying (optional)
│  ├─ db/                # SQLite database layer
│  │  └─ index.ts        # Database service (matches, bets, stats)
│  ├─ config/            # Environment configuration
│  │  └─ index.ts        # Config loader with defaults
│  ├─ types/             # TypeScript types
│  │  └─ index.ts        # Shared types (Match, Bet, Stats, etc.)
│  └─ utils/             # Utilities
│     ├─ format.ts       # Formatting (ETH, times, odds, addresses)
│     ├─ validation.ts   # Input validation
│     └─ retry.ts        # Retry logic for API/RPC calls
├─ data/                 # SQLite database
│  └─ matchday.db
├─ docs/                 # Detailed documentation
│  └─ PROJECT_STRUCTURE.md
├─ scripts/              # Utility scripts
└─ .env                  # Environment variables
```

> See [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md) for detailed architecture.

---

### Architecture Highlights

#### Daily Lifecycle

```text
06:00 UTC – Fetch matches from Football-Data.org
│
├─ No matches → sleep
└─ Matches found
   ├─ Store in DB
   ├─ Post to channel (if configured)
   ├─ Schedule betting close at kickoff
   └─ Schedule result polling
      ├─ Start: +90 mins after kickoff
      ├─ Poll: Every 15 mins
      └─ Stop: When resolved or +3 hours
```

#### Betting Flow (Technical)

1. User runs `/bet 1 home 0.05`
2. Bot creates pending bet in DB (5-min expiry)
3. Bot sends message with "Confirm Bet" button
4. User clicks "Confirm Bet" button
5. Bot checks if match exists on-chain
   - If not: `createMatch()` transaction via smart account
6. Bot sends transaction interaction to user's wallet
7. User signs → Transaction sent to Base
8. Bot monitors for `BetPlaced` event
9. On event: Update DB, confirm to user
10. At kickoff: Bot calls `closeBetting()`
11. Post-match: Bot calls `resolveMatch()` with result
12. User runs `/claim` → Bot shows "Claim Winnings" button
13. User clicks button → Bot sends `claimWinnings()` transaction interaction
14. User signs → Winnings transferred to wallet

#### Smart Account Architecture

- **Bot EOA** (`bot.botId`) – Signs transactions
- **Bot Smart Account** (`bot.appAddress`) – Holds funds, executes calls
- **User Wallets** – Sign bets, receive winnings
- **Contract Calls** – Use `execute()` from `viem/experimental/erc7821`

**Important:** Fund the `bot.appAddress` (not `bot.botId`) for on-chain operations.

#### Database Schema

**matches** – Football matches

- Links API data (`api_match_id`) to on-chain matches (`on_chain_match_id`)
- Tracks pools (`home_pool`, `draw_pool`, `away_pool`)
- Resolution status, winner, posted flags

**pending_bets** – Temporary bets awaiting confirmation

- 5-minute expiry
- One per user at a time
- Cleaned up by scheduler

**user_stats** – Aggregated statistics

- Total bets, wins, amounts wagered/won
- Powers `/stats` and `/leaderboard`

**posted_messages** – Deduplication tracker

- Prevents duplicate match announcements
- Keyed by `match_date` and `competition_code`

---

### Smart Contract Integration

The bot interacts with the **MatchDayBet** contract on Base L2.

**Contract Address:** `0x1b048C7323C7c7FE910a5F0e08B36b0c715e8947` ([View on Basescan](https://basescan.org/address/0x1b048C7323C7c7FE910a5F0e08B36b0c715e8947))

**Implementation Address:** `0x2f0A079981aC1BaA4fEe85619F1f09BB12D9e9e4`([View on Basescan](https://basescan.org/address/0x2f0A079981aC1BaA4fEe85619F1f09BB12D9e9e4))

**Contract github:** `https://github.com/Chukwuemekamusic/matchday-contract.git`

#### Key Features

- **Parimutuel model** – Three pools (Home/Draw/Away)
- **1% platform fee** – Only when there are winners AND losers
- **Pull-based payouts** – Gas-efficient, user-controlled
- **Emergency controls** – Pause, cancel, refund
- **Event-driven** – `BetPlaced`, `BettingClosed`, `MatchResolved`

#### Contract Functions (Owner)

- `createMatch(matchId, homeTeam, awayTeam, kickoff)` – Create betting market
- `closeBetting(matchId)` – Lock bets at kickoff
- `resolveMatch(matchId, outcome)` – Set winner, enable claims
- `cancelMatch(matchId)` – Enable refunds

#### Contract Functions (User)

- `placeBet(matchId, outcome) payable` – Bet with ETH
- `claimWinnings(matchId)` – Pull winnings
- `claimRefund(matchId)` – Get refund if cancelled

#### View Functions

- `getOdds(matchId)` – Current parimutuel odds
- `getPools(matchId)` – Pool sizes
- `calculatePotentialWinnings(matchId, outcome, amount)` – Estimate payout

> See [../matchdaybet/README.md](../matchdaybet/README.md) for contract details.

---

### Security

**Bot:**

- Input validation on all user inputs
- JWT verification for webhooks
- Prepared SQL statements (no injection)
- Pending bet expiry (prevents stale state)
- Never stores private keys
- Fund `appAddress`, not signer

**Smart Contract:**

- Inherits: `Ownable`, `Pausable`, `ReentrancyGuard`
- Pull payment pattern (reentrancy-safe)
- Input validation on all state changes
- Emergency pause and cancel functionality
- Tested with Foundry

---

### Environment Variables

**Required:**

- `APP_PRIVATE_DATA` – Bot credentials from Towns Protocol (base64)
- `JWT_SECRET` – Webhook authentication secret
- `FOOTBALL_API_KEY` – Football-Data.org API key

**Optional:**

- `CONTRACT_ADDRESS` – MatchDayBet contract address (defaults to zero address)
- `BASE_RPC_URL` – Base chain RPC endpoint (defaults to public)
- `PORT` – HTTP server port (defaults to 5123)
- `MIN_STAKE` – Minimum bet in ETH (defaults to 0.001)
- `MAX_STAKE` – Maximum bet in ETH (defaults to 0.1)
- `DATABASE_PATH` – SQLite file location (defaults to `./data/matchday.db`)
- `SUPPORTED_COMPETITIONS` – Comma-separated IDs (defaults to PL, La Liga, etc.)
- `DEFAULT_CHANNEL_ID` – Optional channel for automated announcements

---

### API & External Services

**Football-Data.org API**

- Free tier: 10 requests/minute
- Endpoints: `/matches`, `/competitions/{id}/matches`
- Returns: Match status (SCHEDULED, IN_PLAY, FINISHED, etc.)
- Competition IDs: PL=2021, La Liga=2014, Bundesliga=2002, Serie A=2019, Ligue 1=2015, UCL=2001

**Base L2**

- Low gas costs (~$0.003 per bet)
- Native ETH (no token approvals needed)
- RPC: `https://mainnet.base.org` (or Sepolia for testing)

**Towns Protocol**

- Stateless webhook-based bot
- Slash commands don't trigger `onMessage`
- User IDs are Ethereum addresses
- Mentions use `<@{userId}>` format

---

### Common Development Tasks

**Adding a new slash command:**

1. Add command metadata to `src/commands.ts`
2. Create handler function in `src/handlers/`
3. Register in `src/index.ts` using `bot.onSlashCommand(name, handler)`

**Modifying database schema:**

1. Update table creation in `src/db/index.ts` constructor
2. Add/modify query methods in `DatabaseService` class
3. Update types in `src/types/index.ts`
4. Delete `data/matchday.db` to recreate (dev only, no migrations)

**Testing contract changes:**

```bash
cd ../matchdaybet
forge test -vvv --match-test testFunctionName
```

**Debugging:**

- Bot logs to console
- Check `data/matchday.db` for state
- Use Base block explorer for on-chain transactions

---

## License

MIT

---

## Resources

- [Towns Protocol Docs](https://docs.towns.com)
- [Football-Data.org API](https://www.football-data.org/documentation/api)
- [Base L2](https://base.org)
- [Viem Docs](https://viem.sh)
- [Foundry Book](https://book.getfoundry.sh)

---

**Built with ⚽ for the Towns Protocol – "Bots That Move Money" competition.**

> Questions? Issues? Open an issue on [GitHub](https://github.com/Chukwuemekamusic/matchday-bet-bot).
