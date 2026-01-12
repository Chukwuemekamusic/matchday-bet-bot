import { formatEther, parseEther } from "viem";
import { Outcome, OUTCOME_NAMES, COMPETITION_EMOJIS, DBMatch } from "../types";

/**
 * Format ETH amount for display
 */
export function formatEth(wei: bigint | string): string {
  const formatted = formatEther(typeof wei === "string" ? BigInt(wei) : wei);
  const num = parseFloat(formatted);
  if (num === 0) return "0";
  if (num < 0.0001) return "<0.0001";
  return num.toFixed(4).replace(/\.?0+$/, "");
}

/**
 * Parse ETH string to wei
 */
export function parseEth(eth: string): bigint {
  return parseEther(eth);
}

/**
 * Format timestamp to readable date/time
 */
export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

/**
 * Format time only
 */
export function formatTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return (
    date.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }) + " UTC"
  );
}

/**
 * Format outcome for display
 */
export function formatOutcome(outcome: Outcome): string {
  return OUTCOME_NAMES[outcome];
}

/**
 * Parse outcome from string
 */
export function parseOutcome(str: string): Outcome | null {
  const lower = str.toLowerCase();
  if (lower === "home" || lower === "h" || lower === "1") return Outcome.HOME;
  if (lower === "draw" || lower === "d" || lower === "x") return Outcome.DRAW;
  if (lower === "away" || lower === "a" || lower === "2") return Outcome.AWAY;
  return null;
}

/**
 * Format odds (from basis points to multiplier)
 */
export function formatOdds(oddsBps: bigint): string {
  if (oddsBps === 0n) return "-";
  const multiplier = Number(oddsBps) / 10000;
  return multiplier.toFixed(2) + "x";
}

/**
 * Get competition emoji
 */
export function getCompetitionEmoji(competitionId: number): string {
  return COMPETITION_EMOJIS[competitionId] || "⚽";
}

/**
 * Format match for display in list
 */
export function formatMatchListItem(
  match: DBMatch,
  displayId: number,
  poolEth: string = "0"
): string {
  const time = formatTime(match.kickoff_time);
  const pool = formatEth(parseEth(poolEth));

  return `#${displayId} ${match.home_team} vs ${match.away_team}
   ⏰ ${time} | 💰 Pool: ${pool} ETH`;
}

/**
 * Format full match details
 */
export function formatMatchDetails(
  match: DBMatch,
  pools: { total: string; home: string; draw: string; away: string },
  odds: { home: string; draw: string; away: string }
): string {
  const time = formatDateTime(match.kickoff_time);

  return `⚽ **${match.home_team} vs ${match.away_team}**
${match.competition}

⏰ Kickoff: ${time}

📊 Current Pools:
• Home: ${pools.home} ETH (${odds.home})
• Draw: ${pools.draw} ETH (${odds.draw})
• Away: ${pools.away} ETH (${odds.away})

💰 Total Pool: ${pools.total} ETH`;
}

/**
 * Truncate address for display
 */
export function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Format transaction hash as link
 */
export function formatTxLink(
  txHash: string,
  isMainnet: boolean = false
): string {
  const baseUrl = isMainnet
    ? "https://basescan.org/tx/"
    : "https://sepolia.basescan.org/tx/";
  return `${baseUrl}${txHash}`;
}

/**
 * Calculate time until kickoff
 */
export function timeUntilKickoff(kickoffTime: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = kickoffTime - now;

  if (diff <= 0) return "Started";

  const hours = Math.floor(diff / 3600);
  const minutes = Math.floor((diff % 3600) / 60);

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * Check if betting is still open for a match
 */
export function isBettingOpen(kickoffTime: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  return now < kickoffTime;
}

/**
 * Format match display based on status (for /matches command)
 * Uses match.daily_id for stable display numbers throughout the day
 */
export function formatMatchDisplay(match: DBMatch, displayId?: number): string {
  const { status, home_score, away_score, home_team, away_team, kickoff_time, total_pool, result, daily_id, match_code } = match;
  const pool = match.on_chain_match_id ? formatEth(total_pool) : "0";
  // Use daily_id if available, otherwise fall back to displayId parameter
  const matchNumber = daily_id ?? displayId ?? "?";

  // Show match code subtly in parentheses if available
  const codeDisplay = match_code ? ` (${match_code})` : "";

  // FINISHED - Show final score and result
  if (status === "FINISHED") {
    let resultText = "";
    if (result === Outcome.HOME) {
      resultText = ` | Winner: ${home_team} ✅`;
    } else if (result === Outcome.AWAY) {
      resultText = ` | Winner: ${away_team} ✅`;
    } else if (result === Outcome.DRAW) {
      resultText = " | Draw ✅";
    }

    return `🏁 **#${matchNumber}** ${home_team} ${home_score ?? 0}-${away_score ?? 0} ${away_team}${codeDisplay}\n   FT${resultText} | Pool: ${pool} ETH\n\n`;
  }

  // IN_PLAY, PAUSED, HALFTIME - Show live score
  if (["IN_PLAY", "PAUSED", "HALFTIME"].includes(status)) {
    const statusEmoji = status === "HALFTIME" ? "⏸️" : "⚽";
    const statusText = status === "HALFTIME" ? "HT" : "LIVE";
    return `🔴 **#${matchNumber}** ${home_team} vs ${away_team}${codeDisplay}\n   ${statusEmoji} ${statusText} | ${home_score ?? 0}-${away_score ?? 0} | Pool: ${pool} ETH\n\n`;
  }

  // POSTPONED or CANCELLED
  if (["POSTPONED", "CANCELLED", "SUSPENDED"].includes(status)) {
    return `⚠️ **#${matchNumber}** ${home_team} vs ${away_team}${codeDisplay}\n   ${status} | Pool: ${pool} ETH\n\n`;
  }

  // SCHEDULED or TIMED - Show countdown
  const countdown = timeUntilKickoff(kickoff_time);
  const statusIcon = isBettingOpen(kickoff_time) ? "🟢" : "🔴";
  return `${statusIcon} **#${matchNumber}** ${home_team} vs ${away_team}${codeDisplay}\n   ⏰ ${formatTime(kickoff_time)} (${countdown}) | 💰 ${pool} ETH\n\n`;
}
