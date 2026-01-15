/**
 * Shared types for command handlers
 */

import type { BotHandler } from "@towns-protocol/bot";

/**
 * Base event data passed to all slash command handlers
 */
export interface BaseCommandEvent {
  channelId: string;
  userId: string;
  eventId: string;
  threadId?: string;
}

/**
 * Event data for slash commands with arguments
 */
export interface CommandEventWithArgs extends BaseCommandEvent {
  args: string[];
}

/**
 * Event data for interaction responses
 */
export interface InteractionEvent extends BaseCommandEvent {
  interactionId: string;
  componentId: string;
}

/**
 * Handler function type for slash commands
 */
export type CommandHandler<T extends BaseCommandEvent = BaseCommandEvent> = (
  handler: BotHandler,
  event: T
) => Promise<void>;

/**
 * Handler context containing shared services and utilities
 */
export interface HandlerContext {
  bot: any;
  contractService: any;
  matchOps: any;
  subgraphService: any;
}
