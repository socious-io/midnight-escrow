/**
 * Configuration for connecting to Midnight network
 */
export interface MidnightConfig {
  /** Network indexer URL */
  indexer: string;
  /** Network indexer WebSocket URL (optional, will be auto-generated if not provided) */
  indexerWS?: string;
  /** RPC node URL */
  node: string;
  /** Proof server URL */
  proofServer: string;
  /** Proof generation timeout in milliseconds (default: 900000 = 15 min) */
  proofTimeout?: number;
}

/**
 * Midnight Lace Wallet (window.midnight.mnLace)
 */
export interface MidnightWallet {
  enable: () => Promise<LaceWalletAPI>;
  isEnabled: () => Promise<boolean>;
}

/**
 * Midnight Lace Wallet API (from window.midnight.mnLace.enable())
 */
export interface LaceWalletAPI {
  state: () => Promise<any>;
  balanceTransaction: (tx: any, options?: any) => Promise<any>;
  proveTransaction: (tx: any) => Promise<any>;
  balanceAndProveTransaction: (tx: any, options?: any) => Promise<any>;
  submitTransaction: (provenTx: any) => Promise<string>;
}

/**
 * Global window type extension for Midnight wallet
 */
declare global {
  interface Window {
    midnight?: {
      mnLace: MidnightWallet;
    };
  }
}

/**
 * Wallet configuration - either seed-based or Lace browser wallet
 */
export type WalletConfig =
  | { type: 'seed'; seed: string }
  | { type: 'lace'; laceAPI: LaceWalletAPI };

/**
 * Parameters for creating an escrow
 */
export interface CreateEscrowParams {
  /** Contributor's wallet address (recipient) */
  contributorAddress: string;
  /** Amount to escrow in tDUST */
  amount: bigint;
}

/**
 * Result of creating an escrow
 */
export interface CreateEscrowResult {
  /** Generated escrow ID */
  escrowId: number;
  /** Time taken for proof generation in seconds */
  proofTime: number;
  /** Success status */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Parameters for releasing an escrow
 */
export interface ReleaseEscrowParams {
  /** Escrow ID to release */
  escrowId: number;
}

/**
 * Result of releasing an escrow
 */
export interface ReleaseEscrowResult {
  /** Escrow ID that was released */
  escrowId: number;
  /** Time taken for proof generation in seconds */
  proofTime: number;
  /** Success status */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Escrow state from contract
 */
export interface EscrowState {
  /** Last escrow ID created */
  lastEscrowId: number;
}

/**
 * Wallet balance information
 */
export interface WalletBalance {
  /** Total balance in tDUST */
  balance: bigint;
  /** Wallet address */
  address: string;
}
