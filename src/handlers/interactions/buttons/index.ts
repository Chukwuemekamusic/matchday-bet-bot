/**
 * Button handlers index
 * Exports all button handlers and creates the button registry
 */

import type { ButtonRegistry } from "../types";
import { handleConfirmButton } from "./confirm";
import { handleCancelButton } from "./cancel";
import { handleClaimCancelButton } from "./claim-cancel";
import { handleClaimAllCancelButton } from "./claim-all-cancel";
import { handleRefundCancelButton } from "./refund-cancel";
import { handleClaimConfirmButton } from "./claim-confirm";
import { handleClaimAllConfirmButton } from "./claim-all-confirm";
import { handleRefundConfirmButton } from "./refund-confirm";

/**
 * Button registry - maps button IDs to handlers
 */
export const buttonRegistry: ButtonRegistry = {
  // Bet confirmation buttons
  confirm: handleConfirmButton,
  cancel: handleCancelButton,

  // Claim/refund buttons
  "claim-confirm": handleClaimConfirmButton,
  "claim-cancel": handleClaimCancelButton,
  "claim-all-confirm": handleClaimAllConfirmButton,
  "claim-all-cancel": handleClaimAllCancelButton,
  "refund-confirm": handleRefundConfirmButton,
  "refund-cancel": handleRefundCancelButton,
};

// Export individual handlers
export {
  handleConfirmButton,
  handleCancelButton,
  handleClaimCancelButton,
  handleClaimAllCancelButton,
  handleRefundCancelButton,
  handleClaimConfirmButton,
  handleClaimAllConfirmButton,
  handleRefundConfirmButton,
};

