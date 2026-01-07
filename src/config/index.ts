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
  // Contract (on Base)
  contract: {
    address: requireEnv("CONTRACT_ADDRESS"),
  },

  // Base Chain RPC
  chain: {
    rpcUrl: optionalEnv("BASE_RPC_URL", "https://sepolia.base.org"),
  },

  // Bot Wallet (for contract interactions - creating/resolving matches)
  wallet: {
    privateKey: requireEnv("BOT_WALLET_PRIVATE_KEY"),
  },

  // Football API
  footballApi: {
    apiKey: requireEnv("FOOTBALL_API_KEY"),
    baseUrl: optionalEnv(
      "FOOTBALL_API_BASE_URL",
      "https://api.football-data.org/v4"
    ),
    supportedCompetitions: optionalEnv(
      "SUPPORTED_COMPETITIONS",
      "2021,2014,2002,2019,2015,2001"
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
    minStake: optionalEnv("MIN_STAKE", "0.001"),
    maxStake: optionalEnv("MAX_STAKE", "0.1"),
    pendingBetTimeout: 5 * 60 * 1000, // 5 minutes in ms
  },
};

export default config;
