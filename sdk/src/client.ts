import { WalletBuilder } from '@midnight-ntwrk/wallet';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { httpClientProofProvider, DEFAULT_CONFIG } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { getZswapNetworkId, getLedgerNetworkId, setNetworkId, NetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { nativeToken, Transaction } from '@midnight-ntwrk/ledger';
import { Transaction as ZswapTransaction } from '@midnight-ntwrk/zswap';
import { createBalancedTx } from '@midnight-ntwrk/midnight-js-types';
import { MidnightBech32m, ShieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import * as Rx from 'rxjs';
import type {
  MidnightConfig,
  WalletConfig,
  CreateEscrowParams,
  CreateEscrowResult,
  ReleaseEscrowParams,
  ReleaseEscrowResult,
  WalletBalance,
  EscrowState
} from './types';

/**
 * Escrow SDK Client for Midnight blockchain
 */
export class EscrowClient {
  private wallet: any;
  private walletState: any;
  private providers: any;
  private contract: any;
  private contractAddress: string;
  private config: MidnightConfig;
  private zkConfigPath: string;

  constructor(config: MidnightConfig, contractAddress: string, zkConfigPath: string) {
    this.config = config;
    this.contractAddress = contractAddress;
    this.zkConfigPath = zkConfigPath;

    // Set network to TestNet
    setNetworkId(NetworkId.TestNet);

    // Set proof timeout
    DEFAULT_CONFIG.timeout = config.proofTimeout || 900000;
  }

  /**
   * Connect wallet and initialize providers
   */
  async connect(walletConfig: WalletConfig): Promise<void> {
    if (walletConfig.type === 'seed') {
      // Seed-based wallet (backend/CLI)
      this.wallet = await WalletBuilder.buildFromSeed(
        this.config.indexer,
        this.config.indexerWS || this.config.indexer.replace('http', 'ws') + '/ws',
        this.config.proofServer,
        this.config.node,
        walletConfig.seed,
        getZswapNetworkId(),
        'error',
      );

      this.wallet.start();

      // Wait for wallet to sync
      await Rx.firstValueFrom(
        this.wallet.state().pipe(
          Rx.filter((state: any) => state.syncProgress?.synced === true),
          Rx.take(1),
        )
      );

      this.walletState = await Rx.firstValueFrom(this.wallet.state());
    } else {
      // Lace browser wallet
      this.wallet = walletConfig.laceAPI;
      this.walletState = await this.wallet.state();
    }

    // Create providers
    await this.createProviders(walletConfig.type);

    // Join contract
    await this.joinContract();
  }

  /**
   * Create Midnight providers
   */
  private async createProviders(walletType: 'seed' | 'lace'): Promise<void> {
    const publicDataProvider = indexerPublicDataProvider(
      this.config.indexer,
      this.config.indexerWS || this.config.indexer.replace('http', 'ws') + '/ws'
    );

    const zkConfigProvider = new NodeZkConfigProvider(this.zkConfigPath);
    const proofProvider = httpClientProofProvider(this.config.proofServer);
    const privateStateProvider = await levelPrivateStateProvider({
      privateStateStoreName: 'escrow-state'
    });

    let walletProvider: any;

    if (walletType === 'lace') {
      // Lace wallet - use directly as provider
      walletProvider = this.wallet;
    } else {
      // Seed-based wallet - wrap with balance/prove/submit
      walletProvider = {
        coinPublicKey: this.walletState.coinPublicKey,
        encryptionPublicKey: this.walletState.encryptionPublicKey,
        balanceTx: async (tx: any, newCoins: any) => {
          return this.wallet
            .balanceTransaction(
              ZswapTransaction.deserialize(tx.serialize(getLedgerNetworkId()), getZswapNetworkId()),
              newCoins,
            )
            .then((tx: any) => this.wallet.proveTransaction(tx))
            .then((zswapTx: any) => Transaction.deserialize(zswapTx.serialize(getZswapNetworkId()), getLedgerNetworkId()))
            .then(createBalancedTx);
        },
        submitTx: async (tx: any) => this.wallet.submitTransaction(tx),
      };
    }

    this.providers = {
      publicDataProvider,
      zkConfigProvider,
      proofProvider,
      privateStateProvider,
      walletProvider,
      midnightProvider: walletProvider,
    };
  }

  /**
   * Join existing contract
   */
  private async joinContract(): Promise<void> {
    // Import contract dynamically
    const { Contract: EscrowContract, ledger: escrowLedger } = await import(this.zkConfigPath + '/contract/index.cjs');
    const { witnesses } = await import(this.zkConfigPath + '/../witnesses.js');

    const escrow = new EscrowContract(witnesses);
    this.contract = await findDeployedContract(this.providers, {
      contractAddress: this.contractAddress,
      contract: escrow,
      privateStateId: 'escrow-state',
      initialPrivateState: {},
    });
  }

  /**
   * Get wallet balance
   */
  async getBalance(): Promise<WalletBalance> {
    const state: any = await Rx.firstValueFrom(this.wallet.state());
    return {
      balance: state.balances[nativeToken()] ?? 0n,
      address: state.address,
    };
  }

  /**
   * Get contract escrow state
   */
  async getEscrowState(): Promise<EscrowState> {
    const contractState = await this.providers.publicDataProvider.queryContractState(this.contractAddress);
    const { ledger: escrowLedger } = await import(this.zkConfigPath + '/contract/index.cjs');
    const ledgerData = escrowLedger(contractState.data);

    return {
      lastEscrowId: ledgerData.last_escrow_id,
    };
  }

  /**
   * Parse contributor address to public key bytes
   */
  private parseCoinPublicKey(address: string): Uint8Array {
    const bech32 = MidnightBech32m.parse(address);
    const shieldedAddr = ShieldedAddress.codec.decode(bech32.network, bech32);
    return Uint8Array.from(shieldedAddr.coinPublicKey.data);
  }

  /**
   * Create an escrow
   */
  async createEscrow(params: CreateEscrowParams): Promise<CreateEscrowResult> {
    try {
      const startTime = Date.now();

      // Parse contributor address
      const contributorPubKeyBytes = this.parseCoinPublicKey(params.contributorAddress);
      const contributorPubKey = { bytes: contributorPubKeyBytes };

      // Get available coins from wallet
      const state: any = await Rx.firstValueFrom(this.wallet.state());
      const availableCoins = state.availableCoins;

      // Find suitable coin
      const nativeTokenType = nativeToken();
      const suitableCoin = availableCoins.find((coin: any) =>
        coin.value >= params.amount && coin.type === nativeTokenType
      );

      if (!suitableCoin) {
        return {
          escrowId: 0,
          proofTime: 0,
          success: false,
          error: `No coin found with sufficient balance (need ${params.amount} tDUST)`,
        };
      }

      // Build CoinInfo
      const nonce = new Uint8Array(Buffer.from(suitableCoin.nonce, 'hex'));
      const typeBytes = Buffer.from(suitableCoin.type, 'hex');
      const color = new Uint8Array(typeBytes.slice(2, 34));

      const coinInfo = {
        nonce,
        color,
        value: params.amount, // Only send escrow amount, wallet handles change
      };

      // Call create circuit
      await this.contract.callTx.create(contributorPubKey, coinInfo);

      // Get updated escrow ID
      const escrowState = await this.getEscrowState();
      const proofTime = (Date.now() - startTime) / 1000;

      return {
        escrowId: escrowState.lastEscrowId,
        proofTime,
        success: true,
      };
    } catch (error: any) {
      return {
        escrowId: 0,
        proofTime: 0,
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * Release an escrow
   */
  async releaseEscrow(params: ReleaseEscrowParams): Promise<ReleaseEscrowResult> {
    try {
      const startTime = Date.now();

      // Call release circuit
      await this.contract.callTx.release(params.escrowId);

      const proofTime = (Date.now() - startTime) / 1000;

      return {
        escrowId: params.escrowId,
        proofTime,
        success: true,
      };
    } catch (error: any) {
      return {
        escrowId: params.escrowId,
        proofTime: 0,
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * Close wallet connection
   */
  async disconnect(): Promise<void> {
    if (this.wallet) {
      await this.wallet.close();
    }
  }
}
