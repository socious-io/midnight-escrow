import type { CircuitContext } from '@midnight-ntwrk/compact-runtime';
export type EscrowPrivateState = {};
export declare const witnesses: {
    create: (context: CircuitContext<EscrowPrivateState>, contributor: Uint8Array, coin: {
        nonce: Uint8Array;
        color: Uint8Array;
        value: bigint;
    }) => CircuitContext<EscrowPrivateState>;
    release: (context: CircuitContext<EscrowPrivateState>, id: bigint, coin: {
        nonce: Uint8Array;
        color: Uint8Array;
        value: bigint;
        mt_index: bigint;
    }) => CircuitContext<EscrowPrivateState>;
};
