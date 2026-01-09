import type { BotCommand } from "@towns-protocol/bot";

/**
 * Slash commands for MatchDay Bet Bot
 * These are registered with Towns and appear in autocomplete
 */
const commands = [
  // Help & Info
  {
    name: "help",
    description: "Show all available bot commands",
  },

  // Viewing Matches
  {
    name: "matches",
    description: "Show today's football matches (optionally filter by league)",
  },
  {
    name: "odds",
    description: "Show current betting odds for a match",
  },

  // Betting
  {
    name: "bet",
    description: "Place a bet on a match outcome",
  },
  {
    name: "pending",
    description: "Check your pending bet status",
  },
  {
    name: "cancel",
    description: "Cancel your pending bet",
  },

  // User Bets
  {
    name: "mybets",
    description: "Show your active bets for today",
  },
  {
    name: "claim",
    description: "Claim your winnings from a resolved match",
  },

  // Stats
  {
    name: "stats",
    description: "Show your betting statistics",
  },
  {
    name: "leaderboard",
    description: "Show top bettors by profit",
  },

  // Admin
  {
    name: "fetch",
    description: "Manually fetch today's matches from API",
  },

  /*//////////////////////////////////////////////////////////////
                         DEBUG SLASH COMMANDS
    //////////////////////////////////////////////////////////////*/
  {
    name: "debug",
    description: "🔧 Show bot and contract debug information",
  },
  {
    name: "checkmanager",
    description: "🔧 Check if bot is registered as match manager",
  },
  {
    name: "contractinfo",
    description: "🔧 Show contract version and configuration",
  },
  {
    name: "botinfo",
    description: "🔧 Show bot wallet addresses and balance",
  },
  {
    name: "testread",
    description: "🔧 Test reading data from contract (next match ID)",
  },
  {
    name: "testcreate",
    description: "🔧 Test creating a match on-chain (requires manager role)",
  },
  {
    name: "userHasBet",
    description: "🔧 Test if user has bet on a match",
  },
] as const satisfies BotCommand[];

export default commands;
