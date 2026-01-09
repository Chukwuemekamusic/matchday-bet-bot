# Debug Slash Commands

This document describes the debug slash commands added to help test and verify the bot's interaction with the smart contract.

## Overview

Six new debug commands have been added to help you verify that the bot can properly interact with the deployed UUPS proxy contract on Base.

## Commands

### `/debug` - Comprehensive Debug Information

Shows all debug information in one place.

**Output includes:**
- Bot signer (EOA) and treasury (Smart Account) addresses
- Treasury balance
- Contract address, version, and owner
- Bot's match manager status
- Contract configuration (next match ID, stake limits, platform fee, accumulated fees)
- RPC URL being used

**Use this when:** You want a complete overview of the bot's status and configuration.

### `/checkmanager` - Check Match Manager Status

Verifies if the bot's treasury address is registered as a match manager on the contract.

**Output includes:**
- Bot treasury address
- Match manager status (✅ or ❌)
- If not registered, provides the exact `cast send` command to fix it

**Use this when:** 
- Bot transactions are failing with "NotMatchManager" error
- After deploying a new contract
- After changing bot credentials

### `/contractinfo` - Contract Information

Shows detailed information about the deployed contract.

**Output includes:**
- Contract address
- Contract version (from `version()` function)
- Contract owner address
- Configuration (next match ID, stake limits, platform fee, accumulated fees)
- Link to view contract on BaseScan

**Use this when:** You want to verify contract deployment and configuration.

### `/botinfo` - Bot Wallet Information

Shows information about the bot's wallet addresses and balances.

**Output includes:**
- Signer address (EOA) - signs transactions
- Treasury address (Smart Account) - executes transactions and holds funds
- Treasury balance
- Links to view both addresses on BaseScan
- Warning if balance is low

**Use this when:** 
- You need to fund the bot
- Transactions are failing due to insufficient gas
- You want to verify which address to send funds to

### `/testread` - Test Contract Read

Tests if the bot can successfully read data from the contract.

**What it does:**
- Calls `nextMatchId()` on the contract
- Measures response time
- Shows the result

**Use this when:**
- You want to verify RPC connectivity
- Contract address might be wrong
- Testing after changing RPC endpoints

### `/testcreate` - Test Contract Write

Tests if the bot can successfully write to the contract by creating a test match.

**What it does:**
- Checks if bot is a match manager first
- Creates a test match with kickoff in 24 hours
- Returns the match ID and transaction hash
- Provides link to view transaction on BaseScan

**Use this when:**
- You want to verify the bot can create matches
- Testing after registering bot as match manager
- Verifying treasury has sufficient gas

**⚠️ Warning:** This creates a real on-chain match. You may want to cancel it afterward.

## Typical Debugging Workflow

### 1. Initial Setup Verification

```
/debug
```

This will show you everything at once. Look for:
- ✅ Bot is match manager
- ✅ Treasury has balance
- ✅ Contract version shows "1.0.0"

### 2. If Bot is NOT Match Manager

```
/checkmanager
```

Copy the provided `cast send` command and run it from your terminal with the owner's private key.

### 3. Test Read Operations

```
/testread
```

This confirms:
- Contract address is correct
- RPC is working
- Contract is deployed

### 4. Test Write Operations

```
/testcreate
```

This confirms:
- Bot has match manager role
- Treasury has gas
- Bot can execute transactions

## Common Issues and Solutions

### Issue: "Bot is NOT a match manager"

**Solution:**
1. Run `/checkmanager`
2. Copy the provided command
3. Run it with the contract owner's private key
4. Verify with `/checkmanager` again

### Issue: "Low balance" warning

**Solution:**
1. Run `/botinfo` to get the treasury address
2. Send ETH to the treasury address (not the signer!)
3. Verify with `/botinfo` again

### Issue: "Failed to read from contract"

**Possible causes:**
- Wrong contract address in `.env`
- RPC URL is down or rate-limited
- Contract not deployed at that address

**Solution:**
1. Verify `CONTRACT_ADDRESS` in `.env`
2. Check RPC URL is accessible
3. Verify contract on BaseScan

### Issue: "Match creation failed"

**Possible causes:**
- Not a match manager
- Insufficient gas in treasury
- Contract is paused
- Transaction reverted

**Solution:**
1. Run `/checkmanager` - ensure bot is manager
2. Run `/botinfo` - ensure treasury has balance
3. Check bot logs for detailed error
4. Verify contract is not paused on BaseScan

## Technical Details

### ABI Updates

The following functions were added to the contract ABI:
- `isMatchManager(address)` - Check if address is manager
- `owner()` - Get contract owner
- `version()` - Get contract version
- `platformFeeBps()` - Get platform fee
- `accumulatedFees()` - Get accumulated fees

### New ContractService Methods

- `isMatchManager(address)` - Check if address is manager
- `isBotMatchManager()` - Check if bot is manager
- `getOwner()` - Get contract owner
- `getVersion()` - Get contract version
- `getPlatformFeeBps()` - Get platform fee
- `getAccumulatedFees()` - Get accumulated fees

## Next Steps

After verifying everything works with these debug commands:

1. ✅ Confirm bot is match manager
2. ✅ Confirm treasury has balance
3. ✅ Test read operations work
4. ✅ Test write operations work
5. 🎯 Start using the bot for real matches!

## Support

If you encounter issues not covered here, check:
- Bot console logs for detailed errors
- BaseScan for transaction details
- RPC provider status

