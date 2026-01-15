/**
 * Interaction Service
 * Centralized service for managing user interactions (buttons, forms, transactions)
 */

import { hexToBytes } from "viem";
import { retryWithBackoff } from "../utils/retry";

/**
 * Interaction types supported by the bot
 */
export enum InteractionType {
  BET_CONFIRM = "bet",
  CLAIM = "claim",
  CLAIM_REFUND = "claim_refund",
  REFUND = "refund",
}

/**
 * Metadata extracted from interaction IDs
 */
export interface InteractionMetadata {
  type: InteractionType;
  matchId: number;
  userId: string;
  threadId?: string;
  timestamp?: number;
}

/**
 * Button configuration for interaction forms
 */
export interface ButtonConfig {
  id: string;
  label: string;
  style: 1 | 2 | 3 | 4; // PRIMARY=1, SECONDARY=2, SUCCESS=3, DANGER=4
}

/**
 * Form interaction request configuration
 */
export interface FormInteractionConfig {
  id: string;
  title: string;
  content: string;
  buttons: ButtonConfig[];
}

/**
 * Transaction interaction request configuration
 */
export interface TransactionInteractionConfig {
  id: string;
  title: string;
  chainId: string;
  to: string;
  value: string;
  data: string;
}

export class InteractionService {
  /**
   * Generate a unique interaction ID
   * Format: {type}-{matchId}-{userIdPrefix}-{threadId|timestamp}
   */
  generateInteractionId(
    type: InteractionType,
    matchId: number,
    userId: string,
    threadIdOrTimestamp?: string
  ): string {
    const userPrefix = userId.slice(0, 8);
    const suffix = threadIdOrTimestamp || Date.now().toString();
    return `${type}-${matchId}-${userPrefix}-${suffix}`;
  }

  /**
   * Parse an interaction ID to extract metadata
   */
  parseInteractionId(interactionId: string): InteractionMetadata | null {
    const parts = interactionId.split("-");

    // Minimum format: {type}-{matchId}-{userPrefix}-{suffix}
    if (parts.length < 4) {
      return null;
    }

    const type = parts[0] as InteractionType;
    const matchId = parseInt(parts[1]);
    const userPrefix = parts[2];
    const suffix = parts[3];

    if (isNaN(matchId)) {
      return null;
    }

    // Determine if suffix is threadId or timestamp
    const timestamp = parseInt(suffix);
    const threadId = isNaN(timestamp) ? suffix : undefined;

    return {
      type,
      matchId,
      userId: userPrefix, // Note: This is just the prefix, not the full address
      threadId,
      timestamp: isNaN(timestamp) ? undefined : timestamp,
    };
  }

  /**
   * Check if an interaction ID is of a specific type
   */
  isInteractionType(interactionId: string, type: InteractionType): boolean {
    return interactionId.startsWith(`${type}-`);
  }

  /**
   * Check if an interaction is a claim-related interaction
   */
  isClaimInteraction(interactionId: string): boolean {
    return (
      this.isInteractionType(interactionId, InteractionType.CLAIM) ||
      this.isInteractionType(interactionId, InteractionType.CLAIM_REFUND) ||
      this.isInteractionType(interactionId, InteractionType.REFUND)
    );
  }

  /**
   * Send a form interaction request with retry logic
   */
  async sendFormInteraction(
    handler: any,
    channelId: string,
    userId: string,
    config: FormInteractionConfig,
    threadId?: string
  ): Promise<void> {
    const opts = threadId ? { threadId } : undefined;

    await retryWithBackoff(
      async () => {
        await handler.sendInteractionRequest(
          channelId,
          {
            case: "form",
            value: {
              id: config.id,
              title: config.title,
              content: config.content,
              components: config.buttons.map((btn) => ({
                id: btn.id,
                component: {
                  case: "button",
                  value: {
                    label: btn.label,
                    style: btn.style,
                  },
                },
              })),
            },
          } as any,
          hexToBytes(userId as `0x${string}`),
          opts
        );
      },
      3, // max retries
      1000 // base delay (1s)
    );
  }

  /**
   * Send a transaction interaction request
   */
  async sendTransactionInteraction(
    handler: any,
    channelId: string,
    userId: string,
    config: TransactionInteractionConfig,
    threadId?: string
  ): Promise<void> {
    const opts = threadId ? { threadId } : undefined;

    await handler.sendInteractionRequest(
      channelId,
      {
        case: "transaction",
        value: {
          id: config.id,
          title: config.title,
          content: {
            case: "evm",
            value: {
              chainId: config.chainId,
              to: config.to,
              value: config.value,
              data: config.data,
            },
          },
        },
      } as any,
      hexToBytes(userId as `0x${string}`),
      opts
    );
  }
}

// Export singleton instance
export const interactionService = new InteractionService();
