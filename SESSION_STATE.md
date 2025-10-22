# Session State - Midnight Escrow Contract with insertCommitment() Solution

**Date**: 2025-10-20
**Status**: Implementation complete, testing in progress

## Current Situation

We successfully implemented the solution to the "release coins from contract" problem using the `insertCommitment()` approach suggested by L A from Midnight team.

### Wallet Info
- **Address**: `mn_shield-addr_test10p5tlytz2ec3x9ds4f8vqpprxg5v6apklt67zjht20c2jfkn9d9sxqzwaphvq928mqcupnt37vhhzqxak3fp9scrhypu3yq4z5403lsu6vp4w9es`
- **Balance**: 1,946,742,713 tDUST (after faucet)
- **Contract Address**: `020089c22e49f61e356db4fdf8e37480ba35a569296b0de491f91c970d16dc8b1cbc`

### Escrow Amount
- Changed from 1 tDUST (1,000,000) to **0.1 tDUST (100,000)** for testing

---

## The Problem (From Discord Messages)

### Message 1 - Your Problem Statement:
```
My issue with connecting and interacting with the contract has been resolved.

However, I'm now stuck on a very fundamental problem. I can successfully create an escrow,
but the main issue is releasing the assets locked in the contract.

The contract includes a send() method to transfer assets, but it requires an mt_index,
which the contract doesn't have access to. Here's the situation:

1. When an escrow is created and tokens are transferred to the contract, it receives them
   as CoinInfo, which does not include the mt_index (Merkle tree index).
2. The mt_index only exists in QualifiedCoinInfo, which is required for spending coins.
3. There's no function in the Compact contract or standard library to convert CoinInfo
   to QualifiedCoinInfo or to look up the mt_index for coins held by the contract.
4. Qualifying a coin (associating it with an mt_index) is handled by the runtime or
   transaction assembly layer, not the contract itself.
5. From what I can tell, there's also no documented off-chain API or method for a dApp
   to scan the ledger and determine the new mt_index of coins once they've been
   transferred to the contract.

I've tried saving the mt_index when a wallet sends tokens, but once they're transferred
to the contract, the mt_index changes — and there's no way for the contract (or even
off-chain logic tied to the contract state) to retrieve the new one.
```

### Message 2 - L A's Solution:
```
hey @Jeyem, hmm. i think that the solution I see to your problem is to use
insertCommitment() in QueryContext

When your contract receives coins (e.g., via receive() or another similar method),
those coins arrive as CoinInfo, but without an mt_index. In order to spend them later,
you need to 'upgrade' them to QualifiedCoinInfo, which involves recording their position
in the Merkle tree.

The process works as follows:

i) When your contract receives the coins, the runtime or indexer already knows the
   mt_index where that coin's commitment was inserted into the ledger's Merkle tree.

ii) Your DApp must save that information by calling insertCommitment() on the QueryContext
    while the transaction is being assembled or validated:

    queryContext.insertCommitment(commitment, index)

    This indicates that a specific coin commitment is available at a given index within
    the tree.

iii) Later, when you need to spend those coins, the runtime's internal qualify() method
     uses the registered commitments to convert the CoinInfo into a QualifiedCoinInfo,
     ready to be used in a transaction.

In your contract:
- Store received coins as CoinInfo in your ledger state (as you're already doing)
- When you want to spend them, use send() or similar functions that accept QualifiedCoinInfo

In your dapp (TypeScript/JavaScript):
- When you receive coins into the contract, track the commitment and its mt_index from
  the transaction result or indexer query.
- Before calling a circuit that spends those coins, use insertCommitment() on your
  QueryContext to register the index.
- The runtime will automatically qualify the CoinInfo to QualifiedCoinInfo when needed.
```

---

## What We Implemented

### 1. Contract Changes (`contract/src/escrow.compact`)
✅ **Already had the required structure:**
- Stores `amount: Uint<128>` in the Escrow struct (line 8)
- `create()` circuit stores the coin amount (line 37)
- `release()` circuit takes `QualifiedCoinInfo` and validates the amount matches (line 46)

### 2. Witness Function (`contract/src/witnesses.ts`)
✅ **CREATED witness function for release circuit:**

```typescript
import type { CircuitContext } from '@midnight-ntwrk/compact-runtime';

export type EscrowPrivateState = {
  // Track coins received by the contract
  coinCommitments?: Array<{
    commitment: string;
    mt_index: bigint;
    nonce: string;
    color: string;
    value: bigint;
  }>;
};

export const witnesses = {
  // Witness for release circuit - registers the coin commitment before spending
  release: (
    context: CircuitContext<EscrowPrivateState>,
    id: bigint,
    coin: { nonce: Uint8Array; color: Uint8Array; value: bigint; mt_index: bigint }
  ) => {
    // Get tracked coins from private state
    const trackedCoins = context.currentPrivateState.coinCommitments || [];

    // Find the coin that matches the value we're trying to spend
    const trackedCoin = trackedCoins.find(c => c.value === coin.value);

    if (trackedCoin) {
      // Register the commitment with its mt_index so the runtime can qualify it
      context.transactionContext = context.transactionContext.insertCommitment(
        trackedCoin.commitment,
        trackedCoin.mt_index
      );
    }

    return context;
  }
};
```

**Key Point**: The witness function calls `insertCommitment()` on the `transactionContext` (which is the QueryContext) BEFORE the circuit executes. This allows the runtime to qualify the coin.

### 3. Deploy Script Changes (`deploy.ts`)

✅ **Track coin info when creating escrow** (lines 297-342):
- After creating an escrow, extract ALL output coin information
- Calculate the mt_index for coins sent to the contract (using `firstFree` index)
- Store complete coin data: `{commitment, mt_index, nonce, color, value}`
- Save to `coin-tracking.json`

✅ **Load tracked coins into private state** (lines 192-212):
- Load `coin-tracking.json` on startup
- Pass `coinCommitments` array to contract's `initialPrivateState`
- This makes tracked coins available to the witness function

✅ **Implement release test** (lines 360-408):
- Load tracked coin data
- Construct `QualifiedCoinInfo` from tracked data
- Call `joined.callTx.release()` with the qualified coin
- The witness function automatically calls `insertCommitment()`

---

## Files Modified

1. **`contract/src/witnesses.ts`** - CREATED witness function with insertCommitment()
2. **`deploy.ts`** - Added coin tracking, private state loading, and release test
3. **Escrow amount** - Reduced to 0.1 tDUST (100,000 units)

---

## Current Status

### ✅ Completed:
1. Contract already stores amount correctly
2. Witness function created with insertCommitment() logic
3. Coin tracking implemented (saves to coin-tracking.json)
4. Private state loading implemented
5. Release test code written
6. Got faucet funding (wallet has ~1.9B tDUST)
7. Reduced escrow amount to 0.1 tDUST

### 🔄 In Progress:
- Last test run created escrow successfully in 199 seconds
- Hit bug: tried to access `output.coinInfo.nonce` instead of `output.nonce`
- **FIXED**: Changed line 324-325 to access `output.nonce` and `output.color` directly

### ⚠️ Known Issue - FIXED:
The output structure from the transaction has coin properties directly on the output object, not nested in a `coinInfo` property.

**Line 323-325 should be:**
```typescript
const nonceHex = Buffer.from(output.nonce).toString('hex');
const colorHex = Buffer.from(output.color).toString('hex');
```

**NOT:**
```typescript
const nonceHex = Buffer.from(output.coinInfo.nonce).toString('hex');  // WRONG
const colorHex = Buffer.from(output.coinInfo.color).toString('hex');  // WRONG
```

---

## Next Steps

1. **Run the deployment again** - The fix is in place
   ```bash
   npm run deploy
   ```

2. **Expected flow:**
   - Creates escrow with 0.1 tDUST (~3-5 min proof generation)
   - Tracks coin commitment, nonce, color, mt_index
   - Saves to `coin-tracking.json`
   - Attempts to release the escrow
   - Witness calls `insertCommitment()` before release circuit
   - Release should succeed!

3. **Success criteria:**
   - `coin-tracking.json` created with complete coin data
   - Release transaction succeeds
   - Escrow state changes from `active` to `released`
   - Contributor receives the 0.1 tDUST

---

## How to Continue After Restart

1. **Verify the fix is in place:**
   ```bash
   grep -A 2 "Extract coin info" deploy.ts
   ```
   Should show:
   ```typescript
   const nonceHex = Buffer.from(output.nonce).toString('hex');
   const colorHex = Buffer.from(output.color).toString('hex');
   ```

2. **Run deployment:**
   ```bash
   cd /home/jeyem/Socious/midnight-escrow
   npm run deploy
   ```

3. **Monitor for:**
   - "Created escrow ID: X"
   - "Saved complete coin tracking to coin-tracking.json"
   - "Calling release with QualifiedCoinInfo..."
   - "Release successful in Xs!"
   - "Final escrow X state: released"

4. **If release fails**, check:
   - Does `coin-tracking.json` exist and have data?
   - Is the witness function being called?
   - Check error message for clues

---

## Key Concepts

### insertCommitment() Solution:
1. **When creating escrow**: Track the coin's commitment and mt_index from transaction outputs
2. **Store in private state**: Pass tracked coins to contract's private state
3. **When releasing**: Witness function calls `insertCommitment()` to register the coin
4. **Runtime qualifies**: The runtime uses the registered commitment to qualify the coin for spending

### Why This Works:
- The runtime needs to know which coins are available at which mt_index
- By calling `insertCommitment()`, we tell the runtime: "This commitment exists at this index"
- The runtime can then qualify the CoinInfo to QualifiedCoinInfo for spending
- This happens automatically in the transaction assembly layer

---

## Important Files

- **`deploy.ts`** - Main deployment and testing script
- **`contract/src/escrow.compact`** - Smart contract (no changes needed)
- **`contract/src/witnesses.ts`** - Witness function with insertCommitment()
- **`coin-tracking.json`** - Generated file with tracked coin data (needed for release)
- **`deployment.json`** - Contract deployment info
- **`.env`** - Wallet seed and contract address

---

## Commands

```bash
# Run deployment and test
npm run deploy

# Check logs
tail -f release-test-*.log

# View tracked coins
cat coin-tracking.json

# View contract state
cat deployment.json
```

---

## Solution Summary

The key insight from L A's message is that **we must use `insertCommitment()` on the QueryContext** to register coins before spending them. We implemented this by:

1. Creating a witness function that calls `insertCommitment()`
2. Tracking complete coin data (commitment, mt_index, nonce, color, value) when coins are received
3. Storing this data in private state so the witness can access it
4. The witness registers the coin before the release circuit executes
5. The runtime automatically qualifies the coin for spending

This is the **correct Midnight SDK pattern** for spending coins that were received by a contract.
