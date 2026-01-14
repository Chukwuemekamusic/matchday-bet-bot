import type { MessageOpts } from "@towns-protocol/bot";

/**
 * List of commands that should use threads for detailed interactions
 * Personal commands create/use threads to keep main channel clean
 */
export const THREAD_COMMANDS = [
  // Betting flow
  "bet",
  "pending",
  "cancel",
  // Claims & user bets
  "mybets",
  "claim",
  "claim_refund",
  "claimable",
  "claim_all",
  // Stats & account management
  "stats",
  "verify",
  "migrate",
  // Debug commands
  "contractinfo",
  "botinfo",
  "userHasBet",
  "resolve",
];

/**
 * Determines the appropriate message options for threading
 *
 * @param threadId - Current thread ID if already in a thread
 * @param eventId - Event ID of the message to reply to (creates thread)
 * @param enabled - Whether threading is enabled
 * @returns MessageOpts for sendMessage
 */
export function getThreadMessageOpts(
  threadId: string | undefined,
  eventId: string,
  enabled: boolean = true
): MessageOpts | undefined {
  if (!enabled) {
    return undefined;
  }

  // If already in a thread, stay in it
  if (threadId) {
    return { threadId };
  }

  // Otherwise, create a new thread using eventId as threadId
  return { threadId: eventId };
}

