/**
 * Interaction Response Router
 * Routes button clicks and transaction responses to appropriate handlers
 */

import { interactionService } from "../../services/interactions";
import { db } from "../../db";
import type {
  InteractionResponseEvent,
  FormInteractionEvent,
  TransactionInteractionEvent,
  ButtonRegistry,
  TransactionHandler,
} from "./types";

/**
 * Extract threadId from interaction
 */
function extractThreadId(requestId: string, isClaimInteraction: boolean): string | undefined {
  if (!isClaimInteraction) {
    // For bet confirmations, get threadId from pending bet
    const pendingBet = db.getPendingBetByInteractionId(requestId);
    return pendingBet?.thread_id;
  } else {
    // For claim interactions, parse threadId from requestId
    const metadata = interactionService.parseInteractionId(requestId);
    return metadata?.threadId;
  }
}

/**
 * Route form interactions (button clicks) to appropriate handlers
 */
export async function routeFormInteraction(
  handler: any,
  event: InteractionResponseEvent,
  buttonRegistry: ButtonRegistry,
  context: any
): Promise<void> {
  const { response, channelId, userId } = event;

  // Extract form data
  const form = response.payload.content.value;
  const requestId = form.requestId;

  console.log("📋 [INTERACTION] Form interaction detected");
  console.log("  - requestId:", requestId);
  console.log("  - form.components.length:", form.components.length);

  // Check if this is a claim interaction
  const isClaimInteraction = interactionService.isClaimInteraction(requestId);
  console.log("  - isClaimInteraction:", isClaimInteraction);

  // Extract threadId
  const threadId = extractThreadId(requestId, isClaimInteraction);

  // Create form event
  const formEvent: FormInteractionEvent = {
    response,
    channelId,
    userId,
    requestId,
    components: form.components,
    threadId,
  };

  // Find which button was clicked and route to handler
  console.log("🔍 [INTERACTION] Checking which button was clicked...");
  for (const component of form.components) {
    console.log("  - component.id:", component.id);
    console.log("  - component.component.case:", component.component.case);

    if (component.component.case === "button") {
      const buttonId = component.id;
      const buttonHandler = buttonRegistry[buttonId];

      if (buttonHandler) {
        console.log(`✅ [INTERACTION] Routing to handler for button: ${buttonId}`);
        await buttonHandler(handler, formEvent, context);
        return;
      }
    }
  }

  // No handler found
  console.warn(`⚠️ [INTERACTION] No handler found for interaction: ${requestId}`);
}

/**
 * Route transaction responses to handler
 */
export async function routeTransactionResponse(
  handler: any,
  event: InteractionResponseEvent,
  transactionHandler: TransactionHandler,
  context: any
): Promise<void> {
  const { response, channelId, userId } = event;

  // Extract transaction data
  const txResponse = response.payload.content.value;
  const requestId = txResponse.requestId || "";
  const txHash = txResponse.hash;

  console.log("💳 [INTERACTION] Transaction response detected");
  console.log("  - requestId:", requestId);
  console.log("  - txHash:", txHash);

  // Extract threadId from transaction ID
  // Format: "tx-{onChainMatchId}-{userIdPrefix}-{threadId}"
  const parts = requestId.split("-");
  const threadId = parts.length >= 4 ? parts[3] : undefined;

  // Create transaction event
  const txEvent: TransactionInteractionEvent = {
    response,
    channelId,
    userId,
    requestId,
    txHash,
    threadId: threadId === "none" ? undefined : threadId,
  };

  console.log(`✅ [INTERACTION] Routing to transaction handler`);
  await transactionHandler(handler, txEvent, context);
}

/**
 * Main interaction response router
 */
export async function routeInteractionResponse(
  handler: any,
  event: InteractionResponseEvent,
  buttonRegistry: ButtonRegistry,
  transactionHandler: TransactionHandler,
  context: any
): Promise<void> {
  const { response } = event;

  console.log("🔔 [INTERACTION] Received interaction response");
  console.log("  - userId:", event.userId);
  console.log("  - channelId:", event.channelId);
  console.log("  - response.payload.content?.case:", response.payload.content?.case);

  // Route based on interaction type
  if (response.payload.content?.case === "form") {
    await routeFormInteraction(handler, event, buttonRegistry, context);
  } else if (response.payload.content?.case === "transaction") {
    await routeTransactionResponse(handler, event, transactionHandler, context);
  } else {
    console.warn(`⚠️ [INTERACTION] Unknown interaction type: ${response.payload.content?.case}`);
  }
}

