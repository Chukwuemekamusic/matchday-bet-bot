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
  {
    name: "active",
    description: "Show matches with active betting pools",
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

  // Claiming Winnings
  {
    name: "claim",
    description: "Claim winnings from a specific match",
  },
  {
    name: "claim_refund",
    description: "Claim refund from a cancelled match",
  },
  {
    name: "claimable",
    description: "List all your unclaimed winnings",
  },
  {
    name: "claim_all",
    description: "Claim all your unclaimed winnings at once",
  },
  {
    name: "verify",
    description: "Verify and sync your bets with on-chain state",
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
  {
    name: "winners",
    description: "Show winning bettors for a specific match",
  },

  // Migration (Temporary)
  {
    name: "migrate",
    description: "Migrate your existing on-chain bets to database",
  },

  // Admin
  {
    name: "fetch",
    description: "Manually fetch today's matches from API",
  },

  {
    name: "post",
    description: "[Admin] Manually post daily match announcements",
  },

  {
    name: "dbcheck",
    description: "[Admin] Check database connectivity and show stats",
  },

  /*//////////////////////////////////////////////////////////////
                         DEBUG SLASH COMMANDS
    //////////////////////////////////////////////////////////////*/

  {
    name: "contractinfo",
    description: "🔧 Show contract version and configuration",
  },
  {
    name: "botinfo",
    description: "🔧 Show bot wallet addresses and balance",
  },
  {
    name: "userHasBet",
    description: "🔧 Test if user has bet on a match",
  },
  {
    name: "resolve",
    description:
      "🔧 [Admin] Manually resolve/cancel a match (by # or match code)",
  },
  {
    name: "syncmatches",
    description: "[Admin] Sync on-chain match IDs and fix match codes",
  },
] as const satisfies BotCommand[];

export default commands;
