/**
 * Competition-related utilities
 */

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

