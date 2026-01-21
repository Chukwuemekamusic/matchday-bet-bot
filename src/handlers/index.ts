/**
 * Central export for all command handlers
 */

// Types
export * from "./types";

// Help
export { handleHelp } from "./help";

// Betting
export { createBetHandler, handlePending, handleCancel } from "./betting";

// Matches
export {
  handleMatches,
  handleActive,
  createOddsHandler,
  createMyBetsHandler,
  createWinnersHandler,
  createVerifyHandler,
} from "./matches";

// Claiming
export {
  createClaimHandler,
  createClaimableHandler,
  createClaimAllHandler,
  createClaimRefundHandler,
} from "./claiming";

// Stats
export { createStatsHandler, handleLeaderboard } from "./stats";

// Admin
export {
  createFetchHandler,
  createPostHandler,
  createSyncMatchesHandler,
  createDBCheckHandler,
  createMigrateHandler,
  createBotInfoHandler,
  createResolveHandler,
  createMatchIdHandler,
} from "./admin";

// Utility
export { createContractInfoHandler, createUserHasBetHandler } from "./utility";

// Interactions
export { handleConfirmButton } from "./interactions/buttons/confirm";
export {
  handleClaimCancelButton,
  handleClaimAllCancelButton,
  handleRefundCancelButton,
  handleClaimConfirmButton,
  handleClaimAllConfirmButton,
  handleRefundConfirmButton,
} from "./interactions/buttons";
