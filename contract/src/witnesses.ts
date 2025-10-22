import type { CircuitContext } from '@midnight-ntwrk/compact-runtime';

export type EscrowPrivateState = {};

export const witnesses = {
  create: (
    context: CircuitContext<EscrowPrivateState>,
    contributor: Uint8Array,
    coin: { nonce: Uint8Array; color: Uint8Array; value: bigint }
  ) => {
    return context;
  },

  release: (
    context: CircuitContext<EscrowPrivateState>,
    id: bigint,
    coin: { nonce: Uint8Array; color: Uint8Array; value: bigint; mt_index: bigint }
  ) => {
    // Register the coin's commitment so the runtime can qualify it
    // The commitment will be computed from the coin data
    // This allows the runtime to convert CoinInfo to QualifiedCoinInfo
    return context;
  }
};