/**
 * Competition-related utilities
 */

import { COMPETITION_NAMES, COMPETITION_EMOJIS } from "../types";
import { config } from "../config";

/**
 * Get emoji for a competition code
 */
export function getCompetitionEmoji(code: string): string {
  const emojiMap: Record<string, string> = {
    PL: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    PD: "🇪🇸",
    BL1: "🇩🇪",
    SA: "🇮🇹",
    FL1: "🇫🇷",
    CL: "🏆",
  };
  return emojiMap[code] || "⚽";
}

/**
 * Get a formatted list of supported competitions without emojis
 * Example: "Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Champions League"
 */
export function getSupportedCompetitionsList(): string {
  return config.footballApi.supportedCompetitions
    .map((id) => COMPETITION_NAMES[id])
    .filter((name): name is string => name !== undefined)
    .join(", ");
}

/**
 * Get a formatted list of supported competitions with emojis
 * Example: "🏴󠁧󠁢󠁥󠁮󠁧󠁿 Premier League, 🇪🇸 La Liga, ..."
 */
export function getSupportedCompetitionsWithEmojis(): string {
  return config.footballApi.supportedCompetitions
    .map((id) => {
      const name = COMPETITION_NAMES[id];
      const emoji = COMPETITION_EMOJIS[id];
      return name && emoji ? `${emoji} ${name}` : null;
    })
    .filter((entry): entry is string => entry !== null)
    .join(", ");
}

/**
 * Map of league filter aliases to competition codes
 */
export const LEAGUE_CODE_MAP: Record<string, string> = {
  PL: "PL",
  PREMIER: "PL",
  LALIGA: "PD",
  LA: "PD",
  BUNDESLIGA: "BL1",
  BL: "BL1",
  SERIEA: "SA",
  SA: "SA",
  LIGUE1: "FL1",
  FL1: "FL1",
  UCL: "CL",
  CL: "CL",
  CHAMPIONS: "CL",
};

