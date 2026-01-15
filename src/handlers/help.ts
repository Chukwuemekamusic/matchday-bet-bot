/**
 * /help command handler
 * Shows available bot commands
 */

import type { CommandHandler, BaseCommandEvent } from "./types";
import { config } from "../config";

export const handleHelp: CommandHandler<BaseCommandEvent> = async (
  handler,
  { channelId }
) => {
  const message = `🎯 **MatchDay Bet Bot - Commands**

**Viewing Matches:**
• \`/matches\` - Show today's matches
• \`/odds <match#>\` - Show current odds for a match

**Betting:**
• \`/bet <match#> <home|draw|away> <amount>\` - Place a bet
  Example: \`/bet 1 home 0.01\`
  (You'll get a confirmation button to sign the transaction)
• \`/pending\` - Check your pending bet status
• \`/cancel\` - Cancel your pending bet

**Your Bets:**
• \`/mybets\` - Show your active bets
• \`/claim <match#>\` - Claim winnings for a match

**Stats:**
• \`/stats\` - Show your betting stats
• \`/leaderboard\` - Show top bettors

**Debug Commands:**
• \`/contractinfo\` - Show contract details


💰 Stakes: ${config.betting.minStake} - ${config.betting.maxStake} ETH`;

  await handler.sendMessage(channelId, message);
};
