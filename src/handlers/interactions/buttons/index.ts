/**
 * Button handlers index
 * Exports all button handlers and creates the button registry
 */

import type { ButtonRegistry } from "../types";
import { handleConfirmButton } from "./confirm";
import { handleCancelButton } from "./cancel";

// TODO: Add claim button handlers
// import { handleClaimConfirmButton } from "./claim-confirm";
// import { handleClaimCancelButton } from "./claim-cancel";
// import { handleRefundConfirmButton } from "./refund-confirm";
// import { handleRefundCancelButton } from "./refund-cancel";

/**
 * Button registry - maps button IDs to handlers
 */
export const buttonRegistry: ButtonRegistry = {
  // Bet confirmation buttons
  confirm: handleConfirmButton,
  cancel: handleCancelButton,

  // TODO: Add claim button handlers
  // "claim-confirm": handleClaimConfirmButton,
  // "claim-cancel": handleClaimCancelButton,
  // "refund-confirm": handleRefundConfirmButton,
  // "refund-cancel": handleRefundCancelButton,
};

// Export individual handlers
export { handleConfirmButton, handleCancelButton };

