# Interaction Handler Refactoring Plan

**Created**: 2026-01-19
**Goal**: Extract all inline button and transaction handlers from `index.ts` following the clean pattern established with `confirm.ts`

## Current State

### ✅ Already Refactored
- `confirm` button → `handlers/interactions/buttons/confirm.ts` (170 lines)
- `cancel` button → `handlers/interactions/buttons/cancel.ts` (40 lines)

### Infrastructure in Place
- ✅ Router pattern: `handlers/interactions/router.ts`
- ✅ Type system: `handlers/interactions/types.ts`
- ✅ Button registry: `handlers/interactions/buttons/index.ts`

### Current index.ts Stats
- **Total lines**: ~1,200
- **Interaction handler**: ~680 lines (lines 136-820)
- **Target reduction**: 680 lines → ~100 lines (85% reduction)

---

## Remaining Inline Handlers in index.ts

### Button Handlers (Lines 254-676)

| Button ID | Lines | Complexity | Status | Priority |
|-----------|-------|------------|--------|----------|
| `claim-cancel` | 4 | Trivial | ⏳ Phase 1 | HIGH |
| `claim-all-cancel` | 4 | Trivial | ⏳ Phase 1 | HIGH |
| `refund-cancel` | 8 | Trivial | ⏳ Phase 1 | HIGH |
| `claim-confirm` | 151 | High | 📋 Phase 2 | HIGH |
| `refund-confirm` | 102 | High | 📋 Phase 2 | MEDIUM |
| `claim-all-confirm` | 140 | Very High | 📋 Phase 2 | MEDIUM |

**Total button handler lines**: ~409 lines

### Transaction Handler (Lines 682-1116)

| Handler Type | Lines | Complexity | Status | Priority |
|--------------|-------|------------|--------|----------|
| Claim transaction | 150 | High | 📋 Phase 3 | CRITICAL |
| Refund transaction | 69 | Medium | 📋 Phase 3 | CRITICAL |
| Bet transaction | 106 | High | 📋 Phase 3 | CRITICAL |
| Failed transaction | 42 | Medium | 📋 Phase 3 | CRITICAL |

**Total transaction handler lines**: ~434 lines

---

## Code Duplication Patterns

### 1. Thread ID Parsing
```typescript
// Pattern 1: From transaction ID
const parts = txId.split("-");
const threadId = parts[parts.length - 1];

// Pattern 2: From interaction ID
const metadata = interactionService.parseInteractionId(requestId);
const threadId = metadata?.threadId;
```
**Occurrences**: 6 locations
**Fix**: Create utility in `utils/threadId.ts`

### 2. Match Validation
```typescript
const match = db.getMatchById(matchId);
if (!match) {
  await handler.sendMessage(channelId, "❌ Match no longer available.", opts);
  return;
}
```
**Occurrences**: ~8 locations
**Fix**: Create utility in `utils/validation.ts`

### 3. Transaction ID Generation
```typescript
// Different formats used:
const txId = `claim-tx-${onChainMatchId}-${userId.slice(0, 8)}-${threadId || "none"}`;
const txId = `refund-tx-${onChainMatchId}-${userId.slice(0, 8)}-${opts?.threadId || "none"}`;
const txId = `tx-${onChainMatchId}-${userId.slice(0, 8)}-${opts?.threadId || "none"}`;
```
**Occurrences**: 6 locations
**Fix**: Create utility in `utils/transaction.ts`

### 4. Transaction Status Messages
```typescript
await handler.sendMessage(
  channelId,
  `⏳ **Transaction Submitted!**\n\nWaiting for confirmation...\n\n🔗 [View on Basescan](...)`,
  opts
);
```
**Occurrences**: 4 locations
**Fix**: Create templates in `utils/messaging.ts`

---

## Phase 1: Trivial Cancel Buttons ⏳ IN PROGRESS

**Time Estimate**: 30 minutes
**Risk**: Low
**Impact**: Establishes pattern, removes 16 lines

### Files to Create

#### 1. `src/handlers/interactions/buttons/claim-cancel.ts`
```typescript
export const handleClaimCancelButton: ButtonHandler = async (
  handler,
  event,
  context,
) => {
  const { channelId, threadId } = event;
  const opts = threadId ? { threadId } : undefined;

  await handler.sendMessage(
    channelId,
    "Claim cancelled. You can claim anytime before the match expires (7 days after kickoff).",
    opts
  );
};
```

#### 2. `src/handlers/interactions/buttons/claim-all-cancel.ts`
```typescript
export const handleClaimAllCancelButton: ButtonHandler = async (
  handler,
  event,
  context,
) => {
  const { channelId, threadId } = event;
  const opts = threadId ? { threadId } : undefined;

  await handler.sendMessage(
    channelId,
    "Claim all cancelled. You can claim your winnings anytime.",
    opts
  );
};
```

#### 3. `src/handlers/interactions/buttons/refund-cancel.ts`
```typescript
export const handleRefundCancelButton: ButtonHandler = async (
  handler,
  event,
  context,
) => {
  const { channelId, threadId } = event;
  const opts = threadId ? { threadId } : undefined;

  await handler.sendMessage(
    channelId,
    "Refund claim cancelled. You can claim your refund anytime before the match expires (7 days after kickoff).",
    opts
  );
};
```

### Files to Update

1. **`src/handlers/interactions/buttons/index.ts`**
   - Export new handlers

2. **`src/handlers/index.ts`**
   - Export from main handlers

3. **`src/index.ts`**
   - Import new handlers
   - Replace inline handlers with delegation

### Testing Checklist
- [ ] TypeScript compilation passes
- [ ] All button clicks still work
- [ ] Messages appear in correct threads
- [ ] No runtime errors

---

## Phase 2: Complex Confirmation Buttons 📋 PLANNED

**Time Estimate**: 2-3 hours
**Risk**: Medium
**Impact**: Removes ~393 lines

### Files to Create

1. **`src/handlers/interactions/buttons/claim-confirm.ts`** (151 lines)
   - Parse match ID from interaction
   - Validate match, bet, and claim eligibility
   - Generate claim transaction calldata
   - Send transaction interaction

2. **`src/handlers/interactions/buttons/refund-confirm.ts`** (102 lines)
   - Parse match ID from interaction
   - Validate match and refund eligibility
   - Generate refund transaction calldata
   - Send transaction interaction

3. **`src/handlers/interactions/buttons/claim-all-confirm.ts`** (140 lines)
   - Fetch all user wallets (smart account + linked)
   - Query subgraph for claimable matches
   - Generate batch claim transactions
   - Send multiple transaction requests

### Dependencies
- `contractService` - For transaction generation
- `interactionService` - For sending transactions
- `subgraphService` - For claim-all (query claimable matches)
- `db` - For match/bet lookups
- `getSmartAccountFromUserId` - For wallet resolution
- `getLinkedWalletsExcludingSmartAccount` - For claim-all

### Testing Checklist
- [ ] Claim flow works end-to-end
- [ ] Refund flow works end-to-end
- [ ] Claim-all handles multiple matches
- [ ] Error cases handled gracefully
- [ ] Thread context preserved

---

## Phase 3: Transaction Handlers 📋 PLANNED

**Time Estimate**: 3-4 hours
**Risk**: High
**Impact**: Removes ~434 lines, critical for maintainability

### New Infrastructure

#### `src/handlers/interactions/transactions/types.ts`
```typescript
export interface TransactionEvent {
  response: any;
  channelId: string;
  userId: string;
  requestId: string;
  txHash: string;
  threadId?: string;
}

export enum TransactionType {
  BET = "bet",
  CLAIM = "claim",
  REFUND = "refund",
  UNKNOWN = "unknown"
}
```

#### `src/handlers/interactions/transactions/router.ts`
```typescript
export const routeTransaction = async (
  handler: any,
  event: TransactionEvent,
  context: HandlerContext
) => {
  const txType = parseTransactionType(event.requestId);

  switch (txType) {
    case TransactionType.BET:
      return await handleBetTransaction(handler, event, context);
    case TransactionType.CLAIM:
      return await handleClaimTransaction(handler, event, context);
    case TransactionType.REFUND:
      return await handleRefundTransaction(handler, event, context);
    default:
      console.error("Unknown transaction type:", event.requestId);
  }
};
```

### Files to Create

1. **`src/handlers/interactions/transactions/bet.ts`** (106 lines)
   - Wait for transaction receipt
   - Find pending bet and match
   - Query on-chain bet details
   - Update user stats
   - Clear pending bet
   - Send confirmation message

2. **`src/handlers/interactions/transactions/claim.ts`** (150 lines)
   - Wait for transaction receipt
   - Parse match ID from transaction ID
   - Find match and on-chain bet
   - Calculate winnings
   - Update user stats
   - Send success message with amounts

3. **`src/handlers/interactions/transactions/refund.ts`** (69 lines)
   - Wait for transaction receipt
   - Parse match ID
   - Clear pending bet if exists
   - Send refund confirmation message

4. **`src/handlers/interactions/transactions/failed.ts`** (42 lines)
   - Parse error messages
   - Determine if user-initiated or system error
   - Send appropriate error message
   - Preserve pending bets for retries where appropriate

### Testing Checklist
- [ ] Bet transactions confirm correctly
- [ ] Claim transactions update stats
- [ ] Refund transactions clear bets
- [ ] Failed transactions show helpful errors
- [ ] All messages appear in correct threads

---

## Phase 4: Shared Utilities 📋 OPTIONAL

**Time Estimate**: 1-2 hours
**Risk**: Low
**Impact**: Reduces duplication by ~30%

### Files to Create

#### 1. `src/handlers/interactions/utils/validation.ts`
```typescript
export async function validateMatch(
  matchId: number
): Promise<{ match?: DBMatch; error?: string }> {
  const match = db.getMatchById(matchId);
  if (!match) {
    return { error: "❌ Match no longer available." };
  }
  return { match };
}

export async function validateBet(
  matchId: number,
  userId: string
): Promise<{ bet?: any; error?: string }> {
  // Implementation
}
```

#### 2. `src/handlers/interactions/utils/transaction.ts`
```typescript
export function generateTransactionId(
  type: "bet" | "claim" | "refund",
  matchId: number,
  userId: string,
  threadId?: string
): string {
  const prefix = type === "bet" ? "tx" : `${type}-tx`;
  const userPrefix = userId.slice(0, 8);
  const suffix = threadId || "none";
  return `${prefix}-${matchId}-${userPrefix}-${suffix}`;
}

export function parseTransactionType(txId: string): TransactionType {
  if (txId.startsWith("claim-tx-")) return TransactionType.CLAIM;
  if (txId.startsWith("refund-tx-")) return TransactionType.REFUND;
  if (txId.startsWith("tx-")) return TransactionType.BET;
  return TransactionType.UNKNOWN;
}
```

#### 3. `src/handlers/interactions/utils/messaging.ts`
```typescript
export function getTransactionSubmittedMessage(
  txHash: string,
  type: "bet" | "claim" | "refund"
): string {
  return `⏳ **Transaction Submitted!**\n\nWaiting for confirmation...\n\n🔗 [View on Basescan](https://basescan.org/tx/${txHash})`;
}

export function getTransactionFailedMessage(
  error: string,
  canRetry: boolean
): string {
  // Implementation
}
```

#### 4. `src/handlers/interactions/utils/threadId.ts`
```typescript
export function extractThreadIdFromTxId(txId: string): string | undefined {
  const parts = txId.split("-");
  const lastPart = parts[parts.length - 1];
  return lastPart === "none" ? undefined : lastPart;
}

export function createThreadOpts(threadId?: string): MessageOpts | undefined {
  return threadId ? { threadId } : undefined;
}
```

### Refactoring Tasks
- [ ] Update all handlers to use utilities
- [ ] Remove duplicated code
- [ ] Run full test suite
- [ ] Verify no regressions

---

## Final File Structure

```
src/handlers/interactions/
├── types.ts                         ✅ Exists
├── router.ts                        ✅ Exists
├── index.ts                         ✅ Exists
│
├── buttons/
│   ├── index.ts                     ✅ Exists
│   ├── confirm.ts                   ✅ Done
│   ├── cancel.ts                    ✅ Done
│   ├── claim-cancel.ts              ⏳ Phase 1
│   ├── claim-all-cancel.ts          ⏳ Phase 1
│   ├── refund-cancel.ts             ⏳ Phase 1
│   ├── claim-confirm.ts             📋 Phase 2
│   ├── refund-confirm.ts            📋 Phase 2
│   └── claim-all-confirm.ts         📋 Phase 2
│
├── transactions/                    📋 Phase 3
│   ├── types.ts
│   ├── router.ts
│   ├── index.ts
│   ├── bet.ts
│   ├── claim.ts
│   ├── refund.ts
│   └── failed.ts
│
└── utils/                           📋 Phase 4 (Optional)
    ├── validation.ts
    ├── transaction.ts
    ├── messaging.ts
    └── threadId.ts
```

---

## Expected Impact

### After Phase 1 (Trivial Buttons)
- **Lines removed**: 16
- **Files created**: 3
- **Risk**: Low
- **Benefit**: Pattern established

### After Phase 2 (Confirmation Buttons)
- **Lines removed**: ~393
- **Files created**: 3
- **Risk**: Medium
- **Benefit**: Significant cleanup

### After Phase 3 (Transaction Handlers)
- **Lines removed**: ~434
- **Files created**: 7
- **Risk**: High
- **Benefit**: Critical for maintainability

### After Phase 4 (Utilities)
- **Duplication reduced**: ~30%
- **Files created**: 4
- **Risk**: Low
- **Benefit**: DRY code, easier maintenance

### Final Result
- **index.ts**: ~680 lines → ~100 lines (85% reduction)
- **Total new files**: 17
- **Maintainability**: Significantly improved
- **Testability**: Each handler isolated
- **Extensibility**: Easy to add new interactions

---

## Progress Tracking

- [x] Phase 0: Initial analysis and planning
- [ ] Phase 1: Trivial cancel buttons (⏳ In Progress)
- [ ] Phase 2: Complex confirmation buttons
- [ ] Phase 3: Transaction handlers
- [ ] Phase 4: Shared utilities (Optional)

---

## Notes

### Why This Approach?
1. **Incremental**: Start small, build confidence
2. **Low risk**: Begin with trivial handlers
3. **Pattern-based**: Follow established confirm.ts pattern
4. **Testable**: Each phase can be tested independently
5. **Reversible**: Changes can be rolled back if issues arise

### When to Stop?
- **Minimum**: Complete Phase 1-2 for significant improvement
- **Recommended**: Complete Phase 1-3 for full benefit
- **Optional**: Phase 4 if you want maximum code quality

### Future Considerations
- Consider adding unit tests for handlers
- Document interaction flow in separate diagram
- Add OpenAPI/JSDoc comments for better IDE support
