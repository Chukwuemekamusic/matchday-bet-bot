# MatchDay Bet Bot

A **Towns Protocol bot** that brings **parimutuel football betting** to your community.
Built for the **“Bots That Move Money”** competition.

---

## Overview

**MatchDay Bet Bot** allows users to bet on real football matches using **ETH**, backed by a smart contract deployed on **Base L2**.

### Key Highlights

- ⚽ **Live Match Tracking** – Fetches matches daily from Football-Data.org
- 💰 **Parimutuel Betting** – Winners split the pool proportionally
- 📊 **Real-time Updates** – Live scores and match results
- 🌍 **Multi-league Support** – EPL, La Liga, Bundesliga, Serie A, Ligue 1, UCL
- 🏆 **Stats & Leaderboards** – Track performance and profit
- 🔗 **Smart-Contract Powered** – Trustless betting on Base

---

## Features

### Slash Commands

#### Viewing Matches

- `/matches` – Show today’s matches (live scores & results)
- `/matches <league>` – Filter by league (e.g. `/matches PL`)
- `/odds <match#>` – View odds and pool sizes

#### Betting

- `/bet <match#> <home|draw|away> <amount>` – Place a bet
- `/pending` – Check pending bet status
- `/cancel` – Cancel a pending bet

#### Your Bets

- `/mybets` – View active bets
- `/verify` – Verify and sync bets with on-chain state
- `/claimable` – List all unclaimed winnings
- `/claim <match#>` – Claim winnings

#### Stats

- `/stats` – Personal betting statistics
- `/leaderboard` – Top bettors by profit

#### Admin

- `/fetch` – Manually fetch today’s matches
- `/help` – List all commands

---

## Match Display Examples

### 🕒 Scheduled Match

```text
🕒 #1 Arsenal vs Chelsea
   ⏰ 20:00 UTC (in 2h 30m) | Pool: 0.15 ETH
```

### 🔴 Live Match

```text
🔴 #2 Man City vs Brighton
   LIVE | 2–1 | Pool: 0.08 ETH
```

### ✅ Finished Match

```text
✅ #3 Liverpool 3–0 Everton
   FT | Winner: Liverpool | Pool: 0.5 ETH
```

### ⏸️ Halftime

```text
⏸️ #4 Barcelona vs Real Madrid
   HT | 1–1 | Pool: 0.3 ETH
```

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.0+
- Towns Protocol app credentials
- Football-Data.org API key
- MatchDayBet smart contract on Base (optional)

---

### Installation

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

```bash
APP_PRIVATE_DATA=<your_towns_app_private_data>
JWT_SECRET=<your_jwt_secret>
FOOTBALL_API_KEY=<your_football_data_api_key>

# Optional
CONTRACT_ADDRESS=<contract_address>
BASE_RPC_URL=https://mainnet.base.org
PORT=5123
MIN_STAKE=0.001
MAX_STAKE=0.1
DATABASE_PATH=/data/matchday.db
SUPPORTED_COMPETITIONS=2021,2014,2002,2019,2015,2001
DEFAULT_CHANNEL_ID=<channel_id>
```

4. **Run the bot**

```bash
# Development
bun run dev

# Production
bun run start
```

---

## Development

### Scripts

```bash
bun run dev          # Hot reload
bun run start        # Production
bun run typecheck    # TypeScript checks
bun run lint         # ESLint
bun run lint:fix     # Auto-fix
bun run build        # Type check
```

---

### Project Structure

```text
matchday_bet_bot/
├─ src/
│  ├─ index.ts           # Bot entry point
│  ├─ commands.ts        # Slash command definitions
│  ├─ scheduler.ts       # Automated tasks
│  ├─ handlers/          # Command handlers (admin, betting, claiming, matches, stats)
│  ├─ services/          # External integrations (contract, API, subgraph)
│  ├─ db/                # SQLite database layer
│  ├─ config/            # Environment configuration
│  ├─ types/             # TypeScript types
│  └─ utils/             # Utilities (formatting, validation, retry logic)
├─ docs/                 # Detailed documentation
├─ scripts/              # Utility scripts
├─ data/                 # SQLite database
└─ .env                  # Environment variables
```

> 📖 See [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md) for detailed architecture and patterns.

---

## How It Works

### Daily Lifecycle

```text
06:00 UTC – Fetch matches
│
├─ No matches → sleep
└─ Matches found
   ├─ Calculate kickoff times
   ├─ Schedule betting close
   └─ Poll results
      ├─ Start: +90 mins
      ├─ Every 15 mins
      └─ Stop: resolved or +3h
```

---

### Betting Flow

1. `/bet <match#> <prediction> <amount>`
2. Pending bet stored (5-min expiry)
3. `/confirm`
4. Match created on-chain if needed
5. User signs transaction
6. Bot confirms via `BetPlaced`
7. Betting auto-closes at kickoff
8. Match resolves post-game
9. Winners claim with `/claim`

---

## Smart Contract Integration

- Lazy on-chain match creation
- Pull-based payouts
- Event-driven confirmations
- Automated resolution
- Optional off-chain-only mode

See: [`../matchdaybet/README.md`](../matchdaybet/README.md)

---

## Supported Competitions

| Code |   ID | League           |
| ---: | ---: | ---------------- |
|   PL | 2021 | Premier League   |
|   PD | 2014 | La Liga          |
|  BL1 | 2002 | Bundesliga       |
|   SA | 2019 | Serie A          |
|  FL1 | 2015 | Ligue 1          |
|   CL | 2001 | Champions League |

---

## Security

- ✅ Input validation
- ✅ JWT verification
- ✅ Prepared SQL statements
- ✅ Pending bet expiry
- 🔒 Never store private keys
- 🔒 Fund `appAddress`, not signer

---

## License

MIT

---

## Resources

- [Towns Protocol Docs](https://docs.towns.com)
- [Football-Data.org](https://www.football-data.org/documentation/api)
- [Base](https://base.org)
- [Viem](https://viem.sh)

---

Built with ❤️ for the **Towns Protocol – Bots That Move Money** competition.
