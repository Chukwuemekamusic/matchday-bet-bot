/**
 * /help command handler
 * Shows available bot commands
 */

import type { CommandHandler, BaseCommandEvent } from "./types";
import { config } from "../config";
import { getSmartThreadOpts } from "../utils/threadRouter";

export const handleHelp: CommandHandler<BaseCommandEvent> = async (
  handler,
  { channelId, threadId }
) => {
  const opts = getSmartThreadOpts(threadId);
  const message = `🎯 **MatchDay Bet Bot - Commands**

**Viewing Matches:** \n\n
• \`/matches\` - Show today's matches \n\n
• \`/odds <match#>\` - Show current odds for a match \n\n

**Betting:** \n\n
• \`/bet <match#> <home|draw|away> <amount>\` - Place a bet \n\n
  Example: \`/bet 1 home 0.01\`
  (You'll get a confirmation button to sign the transaction)
• \`/pending\` - Check your pending bet status \n\n
• \`/cancel\` - Cancel your pending bet \n\n

**Your Bets:** \n\n
• \`/mybets\` - Show your active bets \n\n
• \`/claim <match#>\` - Claim winnings for a match \n\n

**Stats:** \n\n
• \`/stats\` - Show your betting stats \n\n
• \`/leaderboard\` - Show top bettors \n\n

**Debug Commands:** \n\n
• \`/contractinfo\` - Show contract details \n\n


💰 Stakes: ${config.betting.minStake} - ${config.betting.maxStake} ETH`;

  await handler.sendMessage(channelId, message, opts);
};
