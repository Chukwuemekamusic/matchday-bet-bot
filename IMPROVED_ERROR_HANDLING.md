# Improved Error Handling for Betting Flow

## Overview

Enhanced the `/bet` command flow to gracefully handle edge cases and provide actionable error messages to users. The pending bet system now preserves user bets during failures, allowing them to retry without re-entering information.

## Key Improvements

### 1. Enhanced `createMatch()` Error Detection

**Location:** `src/services/contract.ts`

The `createMatch()` method now returns detailed error information instead of just `null`:

```typescript
// Before: Returns null on any error
async createMatch(...): Promise<{ matchId: number; txHash: string } | null>

// After: Returns specific error types
async createMatch(...): Promise<
  | { matchId: number; txHash: string; error?: never }
  | { matchId?: never; txHash?: never; error: string; errorType: string }
>
```

**Error Types Detected:**

1. **INSUFFICIENT_GAS** - Bot treasury has insufficient ETH for gas
   - Pre-flight check: Validates balance before attempting transaction
   - Threshold: Less than 0.001 ETH triggers error

2. **NOT_MATCH_MANAGER** - Bot is not registered as match manager
   - Detects "NotMatchManager" or "Ownable" errors in transaction revert

3. **TRANSACTION_REVERTED** - Transaction was submitted but reverted on-chain
   - Checks receipt status after transaction is mined

4. **NONCE_ERROR** - Transaction nonce conflict
   - Detects nonce-related errors in exception messages

5. **RPC_TIMEOUT** - RPC endpoint timeout or network congestion
   - Detects timeout errors from RPC provider

6. **UNKNOWN** - Any other error with truncated message

### 2. User-Friendly Error Messages

**Location:** `src/index.ts` (interaction handler)

When match creation fails, users now receive:
- Clear explanation of what went wrong
- Specific instructions on how to fix it
- Confirmation that their pending bet is saved
- Guidance on how to retry

**Example Error Messages:**

#### Insufficient Gas
```
❌ Unable to Create Match

Bot treasury has insufficient gas. Balance: 0.0005 ETH. 
Please fund 0x1234...5678

What to do:
1. Admin needs to fund the bot treasury
2. Your pending bet is saved
3. Try clicking "Confirm & Sign" again in a few minutes

Your pending bet expires in 5 minutes. Use `/cancel` to cancel it.
```

#### Not Match Manager
```
❌ Unable to Create Match

Bot is not registered as a match manager. Use /checkmanager for instructions.

What to do:
1. Admin needs to register bot as match manager
2. Run `/checkmanager` for instructions
3. Your pending bet is saved
4. Try clicking "Confirm & Sign" again after fixing

Your pending bet expires in 5 minutes. Use `/cancel` to cancel it.
```

#### Network Issues
```
❌ Unable to Create Match

RPC timeout. The network may be congested. Please try again.

What to do:
The network is busy. Wait a moment and click "Confirm & Sign" again.

Your pending bet expires in 5 minutes. Use `/cancel` to cancel it.
```

### 3. Pending Bet Preservation

**Key Change:** Pending bets are NO LONGER cleared on match creation failure.

**Benefits:**
- Users don't have to re-type `/bet 1 home 0.01` after fixing issues
- Just click "Confirm & Sign" button again
- Reduces friction and improves UX

**Safeguards:**
- 5-minute expiration still applies
- Users can check status with `/pending`
- Users can cancel with `/cancel`

### 4. New `/pending` Command

**Location:** `src/index.ts`

Allows users to check their pending bet status:

```
/pending
```

**Output:**
```
⏳ Your Pending Bet

Match: Arsenal vs Chelsea
Your Pick: Arsenal Win (Home)
Stake: 0.01 ETH

Expires in: 4m 23s

To complete your bet, click the "Confirm & Sign" button in the message above.
To cancel, use `/cancel`.
```

### 5. Success Notifications

When match creation succeeds, users now see:
```
✅ Match created on-chain! Now sending your bet transaction...
```

This provides feedback that the first step (match creation) completed successfully.

## Error Handling Flow

```
User clicks "Confirm & Sign"
    ↓
Check if match exists on-chain
    ↓ (No)
Pre-flight check: Bot balance >= 0.001 ETH?
    ↓ (Yes)
Attempt to create match on-chain
    ↓
Transaction submitted
    ↓
Wait for receipt
    ↓
Check receipt status
    ↓
Parse for errors
    ↓
┌─────────────┬─────────────┐
│   Success   │   Failure   │
└─────────────┴─────────────┘
      ↓              ↓
Save match ID   Show specific error
      ↓         Keep pending bet
Send bet tx     User can retry
```

## Testing the Improvements

### Test Case 1: Insufficient Gas

1. Drain bot treasury to < 0.001 ETH
2. Place a bet: `/bet 1 home 0.01`
3. Click "Confirm & Sign"
4. **Expected:** Error message with treasury address to fund
5. Fund the treasury
6. Click "Confirm & Sign" again (same pending bet)
7. **Expected:** Success!

### Test Case 2: Not Match Manager

1. Deploy new contract without registering bot
2. Place a bet: `/bet 1 home 0.01`
3. Click "Confirm & Sign"
4. **Expected:** Error message with `/checkmanager` instructions
5. Register bot as match manager
6. Click "Confirm & Sign" again
7. **Expected:** Success!

### Test Case 3: Network Congestion

1. Use a congested RPC endpoint
2. Place a bet: `/bet 1 home 0.01`
3. Click "Confirm & Sign"
4. **Expected:** Timeout error with retry instructions
5. Wait a moment and click "Confirm & Sign" again
6. **Expected:** Success (or another timeout to retry)

## Benefits

1. **Better UX** - Users understand what went wrong and how to fix it
2. **Reduced Friction** - No need to re-enter bet details after fixing issues
3. **Actionable Errors** - Every error includes specific next steps
4. **Admin Visibility** - Clear messages help admins diagnose issues quickly
5. **Retry-Friendly** - Pending bets survive failures, enabling easy retries

## Future Enhancements

Potential improvements for the future:

1. **Auto-retry** - Automatically retry match creation on transient errors
2. **Batch creation** - Create multiple matches at once to save gas
3. **Gas estimation** - Show estimated gas cost before creating match
4. **Webhook notifications** - Notify admins when bot needs funding
5. **Pending bet warnings** - Send reminder when bet is about to expire

