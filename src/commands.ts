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
    name: "confirm",
    description: "Confirm your pending bet",
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
] as const satisfies BotCommand[];

export default commands;
