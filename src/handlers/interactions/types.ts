/**
 * Types for interaction response handlers
 */

/**
 * Base event for all interaction responses
 */
export interface InteractionResponseEvent {
  response: any; // DecryptedInteractionResponse from Towns SDK
  channelId: string;
  userId: string;
}

/**
 * Form interaction event (button clicks)
 */
export interface FormInteractionEvent extends InteractionResponseEvent {
  requestId: string;
  components: any[]; // Form components from response
  threadId?: string;
}

/**
 * Transaction interaction event (signed transactions)
 */
export interface TransactionInteractionEvent extends InteractionResponseEvent {
  requestId: string;
  txHash: string;
  threadId?: string;
}

/**
 * Button handler function type
 */
export type ButtonHandler = (
  handler: any,
  event: FormInteractionEvent,
  context: any
) => Promise<void>;

/**
 * Transaction handler function type
 */
export type TransactionHandler = (
  handler: any,
  event: TransactionInteractionEvent,
  context: any
) => Promise<void>;

/**
 * Button registry - maps button IDs to handlers
 */
export interface ButtonRegistry {
  [buttonId: string]: ButtonHandler;
}

