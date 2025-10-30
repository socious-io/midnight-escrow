# Branch: insertcommitment-approach

## Status: Work in Progress

This branch contains the implementation attempting to use `insertCommitment()` pattern as suggested by Discord support.

## What's Working

✅ **CREATE Escrow**: Successfully creates escrow by:
- Getting available coins from `walletState.availableCoins`
- Selecting a suitable coin with sufficient balance
- Converting coin data (nonce, type→color) to proper format
- Passing real CoinInfo to contract
- Contract calls `receive(disclose(coin))` to hold funds
- Escrow stored in contract state with ID

**Test Results:**
- Escrow creation time: ~127 seconds
- Transaction fees: ~193K tDUST per escrow
- Successfully created escrows with IDs 1-6

## Current Blocker

❌ **RELEASE Escrow**: Cannot extract mt_index for QualifiedCoinInfo

**The Problem:**
1. Contract needs `QualifiedCoinInfo` (with mt_index) to spend coins
2. Transaction result is WASM object (`__wbg_ptr`) - can't access outputs directly
3. ZswapChainState is also WASM object - can't query coins directly
4. `firstFree` returns 0, can't use as mt_index

**Discord Guidance Received:**
- Use `queryContext.insertCommitment(commitment, index)` in witness function
- Runtime will automatically qualify CoinInfo to QualifiedCoinInfo
- Need to track commitment and mt_index from transaction result

**Unanswered Questions:**
1. How to extract commitment and mt_index from transaction result (WASM object)?
2. Should these be stored in private state?
3. Where exactly to call insertCommitment() - in release witness function?

## Files Modified

### Contract
- `/contract/src/escrow.compact` - Escrow contract with receive() and send()
- `/contract/src/witnesses.ts` - Witness functions (need insertCommitment implementation)

### Off-chain
- `/deploy.ts` - Deployment and testing script
  - Lines 201-236: Create escrow with wallet coins
  - Lines 241-266: Debug transaction structure (blocked here)
  - Lines 278-312: Attempt to release (needs mt_index)

### Environment
- `.env` - Wallet seed and contract address
- `deployment.json` - Contract deployment info

## Contract Structure

```compact
struct Escrow {
    contributor: ZswapCoinPublicKey,
    state: ESCROW_STATE,
    value: Uint<128>,
}

export circuit create(
    contributor: ZswapCoinPublicKey,
    coin: CoinInfo
): Uint<32> {
    receive(disclose(coin));
    // Store escrow with value
}

export circuit release(
    id: Uint<32>,
    coin: QualifiedCoinInfo  // <-- Need mt_index here
): [] {
    send(disclose(coin), contributor, value);
    // Update escrow state
}
```

## Next Steps (if continuing this approach)

1. Figure out how to extract commitment and mt_index from transaction
2. Implement private state to track escrow coins:
   ```typescript
   type EscrowPrivateState = {
     escrowCoins: Map<bigint, { commitment: string, mt_index: bigint }>
   }
   ```
3. Call `context.insertCommitment()` in release witness
4. Test release circuit

## Alternative Approach

The user wants to "trick this stuff to bypass" - suggesting a simpler approach might be needed that doesn't require tracking mt_index.

## Deployed Contract

Contract Address: `020025d41a1c6722b637d8194283cf16addb0a5fe0ef550b9c51bb237499dfdfd132`
Network: Midnight TestNet-02

Current escrow count: 6 escrows created (testing)
