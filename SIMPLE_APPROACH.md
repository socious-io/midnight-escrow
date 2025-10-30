# Simple Approach: Single Method Pass-Through

## What Changed

Simplified the escrow contract to use `sendImmediate()` - a single-method contract that transfers funds from organization to contributor without storing any state.

## Contract: `release()`

**Single circuit method:**
```compact
export circuit release(
    contributor: ZswapCoinPublicKey,
    coin: CoinInfo
): [] {
    receive(disclose(coin));
    sendImmediate(
        disclose(coin),
        left<ZswapCoinPublicKey, ContractAddress>(contributor),
        disclose(coin.value)
    );
}
```

**How it works:**
1. Organization calls `release(contributorAddress, coinFromWallet)`
2. Contract receives the coin via `receive()`
3. Contract immediately sends to contributor via `sendImmediate()`
4. No state stored, no mt_index needed!

## Key Benefits

✅ **No mt_index problem** - `sendImmediate()` works with `CoinInfo` (no mt_index needed)
✅ **No state storage** - No ledger, no tracking, just atomic transfer
✅ **Simple flow** - One transaction: Org → Contract → Contributor
✅ **No `insertCommitment()` needed** - Bypasses the entire qualification problem

## Files Changed

### Contract
- `contract/src/escrow.compact` - Single `release()` method with `sendImmediate()`
- `contract/src/witnesses.ts` - Simplified to just `release` witness

### Off-chain
- `deploy.ts` - Simplified to test single release transaction
  - No CREATE step
  - No state querying
  - Just: get wallet coin → call release() → done

## Usage

**Deploy contract:**
```bash
cd /home/jeyem/Socious/midnight-escrow/contract
npm run compact
```

**Run test:**
```bash
cd /home/jeyem/Socious/midnight-escrow
npm run deploy
```

**Expected flow:**
1. Wallet syncs
2. Contract deploys (first run) or joins (subsequent runs)
3. Calls `release(contributorPubKey, coinInfo)`
4. Transfer completes: Organization → Contributor (via contract)

## What This Solves

**Original Problem:**
- Contract holds coins via `receive()`
- To spend later, needs `QualifiedCoinInfo` with `mt_index`
- Can't get `mt_index` from transaction WASM objects
- `insertCommitment()` approach unclear

**Simple Solution:**
- Don't hold coins!
- Use `sendImmediate()` to send right away
- No storage = no mt_index problem
- Atomic pass-through transaction

## Next Steps

If you need actual escrow (hold funds for dispute resolution):
1. Keep this simple approach for immediate transfers
2. Add separate dispute resolution mechanism
3. Or: Implement proper `insertCommitment()` tracking when docs are clearer
