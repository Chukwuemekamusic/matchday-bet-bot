/**
 * Configuration for MatchDay Bet Bot
 *
 * Towns-specific vars (APP_PRIVATE_DATA, JWT_SECRET) are handled by the SDK
 */

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  // Contract (on Base) - Optional for pre-deployment
  contract: {
    address: optionalEnv(
      "CONTRACT_ADDRESS",
      "0x1b048C7323C7c7FE910a5F0e08B36b0c715e8947",
    ),
  },

  implementation: {
    address: optionalEnv(
      "IMPLEMENTATION",
      "0x626A22ecFaD621e62e1c7829e256e1C650533028",
    ),
  },

  // Base Chain RPC
  chain: {
    rpcUrl: optionalEnv("BASE_RPC_URL", "https://mainnet.base.org"),
  },

  // The Graph Subgraph
  subgraph: {
    url: optionalEnv(
      "SUBGRAPH_URL",
      "https://api.studio.thegraph.com/query/93996/matchdaybet-2/version/latest",
    ),
  },

  // Football API
  footballApi: {
    apiKey: requireEnv("FOOTBALL_API_KEY"),
    baseUrl: optionalEnv(
      "FOOTBALL_API_BASE_URL",
      "https://api.football-data.org/v4",
    ),
    supportedCompetitions: optionalEnv(
      "SUPPORTED_COMPETITIONS",
      "2021,2014,2002,2019,2015,2001",
    )
      .split(",")
      .map((id) => parseInt(id.trim())),
  },

  // Database
  database: {
    path: optionalEnv("DATABASE_PATH", "./data/matchday.db"),
  },

  // Betting limits (in ETH)
  betting: {
    minStake: optionalEnv("MIN_STAKE", "0.0001"),
    maxStake: optionalEnv("MAX_STAKE", "0.1"),
    pendingBetTimeout: 5 * 60 * 1000, // 5 minutes in ms
  },

  // Smart batching for match resolution (gas optimization)
  smartBatching: {
    // Enable smart batching logic (waits to batch nearby matches)
    enabled: optionalEnv("SMART_BATCHING_ENABLED", "true") === "true",
    // Maximum time to wait for batching before forcing resolution (seconds)
    maxWaitTime: parseInt(optionalEnv("MAX_BATCHING_WAIT", "900")), // 15 minutes
    // Minimum matches needed to consider it a "good batch" (resolve immediately)
    minBatchSize: parseInt(optionalEnv("MIN_BATCH_SIZE", "3")),
    // Window to look ahead for upcoming match finishes (seconds)
    nearbyMatchWindow: parseInt(optionalEnv("NEARBY_MATCH_WINDOW", "600")), // 10 minutes
  },

  // Match cancellation settings
  cancellation: {
    // Delay before auto-cancelling same-day postponed matches (in seconds)
    // Default: 1 hour (3600 seconds)
    postponementDelay: parseInt(
      optionalEnv("POSTPONEMENT_CANCEL_DELAY", "3600"),
    ),
  },

  // Optional channel for announcements
  defaultChannelId: optionalEnv(
    "DEFAULT_CHANNEL_ID",
    "206870d50263b4ab420b13c3c03af370b46f57be0aa3b744c73dcaff5e6828ad",
  ),

  // Admin permissions
  admin: {
    userId: optionalEnv(
      "ADMIN_USER_ID",
      "0xb17B2CF146890336E383B891DC3D2F636B20a294",
    ), // Admin's Ethereum address (0x...)
  },
};

export default config;
