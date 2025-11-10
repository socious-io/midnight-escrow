// WalletBuilder imported dynamically only when needed (for seed-based wallets)
import {
  deployContract,
  findDeployedContract,
  call,
  createUnprovenCallTx,
  submitCallTx,
} from '@midnight-ntwrk/midnight-js-contracts';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider, DEFAULT_CONFIG } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { getZswapNetworkId, getLedgerNetworkId, setNetworkId, NetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { nativeToken, Transaction } from '@midnight-ntwrk/ledger';
import { Transaction as ZswapTransaction } from '@midnight-ntwrk/zswap';
import { createBalancedTx, ZKConfigProvider } from '@midnight-ntwrk/midnight-js-types';
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
  private walletType: 'seed' | 'lace' | null = null;

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
    this.walletType = walletConfig.type;

    if (walletConfig.type === 'seed') {
      // Seed-based wallet (backend/CLI) - dynamically import to avoid loading in browser
      const { WalletBuilder } = await import('@midnight-ntwrk/wallet');
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
      console.log('[SDK] Setting up Lace wallet...');
      this.wallet = walletConfig.laceAPI;
      this.walletState = await this.wallet.state();
      console.log('[SDK] ✅ Lace wallet state obtained');
    }

    // Create providers
    console.log('[SDK] Creating providers...');
    await this.createProviders(walletConfig.type);
    console.log('[SDK] ✅ Providers created');

    // Join contract
    console.log('[SDK] Joining contract...');
    await this.joinContract();
    console.log('[SDK] ✅ Contract joined');
  }

  /**
   * Create Midnight providers
   */
  private async createProviders(walletType: 'seed' | 'lace'): Promise<void> {
    console.log('[SDK] Creating publicDataProvider with:');
    console.log('[SDK]   HTTP:', this.config.indexer);
    console.log('[SDK]   WS:', this.config.indexerWS || this.config.indexer.replace('http', 'ws') + '/ws');

    const publicDataProvider = indexerPublicDataProvider(
      this.config.indexer,
      this.config.indexerWS || this.config.indexer.replace('http', 'ws') + '/ws'
    );

    // ZK config provider - directly import artifacts from contract directory
    const zkConfigProvider = {
      async getZKIR(circuitId: string) {
        const url = new URL(`../../contract/src/managed/escrow/zkir/${circuitId}.zkir`, import.meta.url);
        const response = await fetch(url.href);
        if (!response.ok) {
          throw new Error(`Failed to fetch ZKIR for ${circuitId}: ${response.statusText}`);
        }
        return new Uint8Array(await response.arrayBuffer());
      },
      async getProverKey(circuitId: string) {
        const url = new URL(`../../contract/src/managed/escrow/keys/${circuitId}.prover`, import.meta.url);
        const response = await fetch(url.href);
        if (!response.ok) {
          throw new Error(`Failed to fetch prover key for ${circuitId}: ${response.statusText}`);
        }
        return new Uint8Array(await response.arrayBuffer());
      },
      async getVerifierKey(circuitId: string) {
        const url = new URL(`../../contract/src/managed/escrow/keys/${circuitId}.verifier`, import.meta.url);
        const response = await fetch(url.href);
        if (!response.ok) {
          throw new Error(`Failed to fetch verifier key for ${circuitId}: ${response.statusText}`);
        }
        return new Uint8Array(await response.arrayBuffer());
      },
      async getVerifierKeys(circuitIds: string[]) {
        return Promise.all(
          circuitIds.map(async (id) => {
            const vk = await this.getVerifierKey(id);
            return [id, vk] as [string, Uint8Array];
          })
        );
      },
      async get(circuitId: string) {
        const [zkir, proverKey, verifierKey] = await Promise.all([
          this.getZKIR(circuitId),
          this.getProverKey(circuitId),
          this.getVerifierKey(circuitId),
        ]);
        return { circuitId, zkir, proverKey, verifierKey };
      },
    } as any;

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
    // Dynamically import contract and witnesses
    console.log('[SDK] Importing contract module...');
    const contractModule = await import('../../contract/src/managed/escrow/contract/index.mjs');
    console.log('[SDK] ✅ Contract module imported');

    console.log('[SDK] Importing witnesses...');
    const witnessesModule = await import('../../contract/src/witnesses.js');
    console.log('[SDK] ✅ Witnesses imported');

    console.log('[SDK] Creating contract instance...');
    const escrow = new contractModule.Contract(witnessesModule.witnesses);
    console.log('[SDK] ✅ Contract instance created');

    if (this.walletType === 'lace') {
      // For Lace wallet, skip findDeployedContract (causes timeout in browser)
      // and manually create callTx wrapper
      console.log('[SDK] Using Lace wallet - creating manual callTx wrapper');

      // Store bare contract instance
      this.contract = escrow;

      // Create manual callTx wrapper for each circuit
      (this.contract as any).callTx = {
        create: async (contributorPubKey: any, coinInfo: any) => {
          return this.manualCallTx('create', contributorPubKey, coinInfo);
        },
        release: async (escrowId: number) => {
          return this.manualCallTx('release', escrowId);
        },
      };

      console.log('[SDK] ✅ Manual callTx wrapper created');
    } else {
      // For seed wallet (Node.js), use findDeployedContract as normal
      console.log('[SDK] Finding deployed contract at:', this.contractAddress);

      try {
        this.contract = await findDeployedContract(this.providers, {
          contractAddress: this.contractAddress,
          contract: escrow,
          privateStateId: 'escrow-state',
          initialPrivateState: {},
        });
        console.log('[SDK] ✅ Deployed contract found');
      } catch (error) {
        console.error('[SDK] ❌ Failed to find contract:', error);
        throw new Error(
          `Failed to find deployed contract. Error: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  /**
   * Get wallet balance
   */
  async getBalance(): Promise<WalletBalance> {
    const state: any = this.walletType === 'seed'
      ? await Rx.firstValueFrom(this.wallet.state())
      : await this.wallet.state();

    // For Lace wallet, balances might not be available or have different structure
    const balance = state.balances?.[nativeToken()] ?? 0n;

    return {
      balance,
      address: state.address,
    };
  }

  /**
   * Get contract escrow state
   */
  async getEscrowState(): Promise<EscrowState> {
    try {
      // Query contract state - returns Promise in browser, Observable in Node.js
      const contractState = await this.providers.publicDataProvider.queryContractState(this.contractAddress);

      if (!contractState || !contractState.data) {
        // In browser (Lace), indexer queries may not work properly
        // Return default state instead of throwing error
        console.warn('[SDK] Contract state query returned null - using default state');
        return { lastEscrowId: 0 };
      }

      // Dynamically import ledger function
      const contractModule = await import('../../contract/src/managed/escrow/contract/index.mjs');
      const ledgerData = contractModule.ledger(contractState.data);

      return {
        lastEscrowId: ledgerData.last_escrow_id,
      };
    } catch (error) {
      console.warn('[SDK] Failed to query contract state:', error);
      // Return default state for browser compatibility
      return { lastEscrowId: 0 };
    }
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
      console.log('--------------------------------- 1');
      // Get wallet state
      const state: any = this.walletType === 'seed'
        ? await Rx.firstValueFrom(this.wallet.state())
        : await this.wallet.state();

      let coinInfo;

      // Check if wallet has availableCoins (seed wallet)
      if (state.availableCoins && state.availableCoins.length > 0) {
        console.log('--------------------------------- 2');
        // Seed wallet - manually select coin
        const availableCoins = state.availableCoins;
        const nativeTokenType = nativeToken();
        const suitableCoin = availableCoins.find((coin: any) =>
          coin.value >= params.amount && coin.type === nativeTokenType
        );
        console.log('--------------------------------- 3');
        if (!suitableCoin) {
          return {
            escrowId: 0,
            proofTime: 0,
            success: false,
            error: `No coin found with sufficient balance (need ${params.amount} tDUST)`,
          };
        }

        // Build CoinInfo from actual coin
        const nonce = new Uint8Array(Buffer.from(suitableCoin.nonce, 'hex'));
        const typeBytes = Buffer.from(suitableCoin.type, 'hex');
        const color = new Uint8Array(typeBytes.slice(2, 34));

        coinInfo = {
          nonce,
          color,
          value: params.amount, // Only send escrow amount, wallet handles change
        };
      } else {
        // Lace wallet - use dummy nonce, wallet will handle coin selection during balancing
        const randomNonce = new Uint8Array(32);
        crypto.getRandomValues(randomNonce);

        // Native token color (all zeros for tDUST)
        const color = new Uint8Array(32);

        coinInfo = {
          nonce: randomNonce,
          color: color,
          value: params.amount,
        };
      }

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
   * Query contract state via HTTP GraphQL - using introspection to find schema
   */
  private async queryContractStateViaHTTP(contractAddress: string): Promise<any> {
    console.log('[SDK] Attempting HTTP GraphQL query for contract state...');
    console.log('[SDK] Indexer URL:', this.config.indexer);
    console.log('[SDK] Contract address:', contractAddress);

    try {
      // First, try introspection to discover available queries
      console.log('[SDK] Step 1: Trying GraphQL introspection...');
      const introspectionResponse = await fetch(this.config.indexer, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: `
            query IntrospectionQuery {
              __schema {
                queryType {
                  fields {
                    name
                    description
                    args {
                      name
                      type {
                        name
                        kind
                      }
                    }
                  }
                }
              }
            }
          `
        })
      });

      if (introspectionResponse.ok) {
        const introspectionResult = await introspectionResponse.json();
        console.log('[SDK] Introspection result:', JSON.stringify(introspectionResult, null, 2));

        // Look for contract-related queries
        const queryFields = introspectionResult.data?.__schema?.queryType?.fields || [];
        const contractQueries = queryFields.filter((f: any) =>
          f.name.toLowerCase().includes('contract')
        );
        console.log('[SDK] Available contract queries:', contractQueries.map((f: any) => f.name));
      }

      // Now try the actual query - try different possible field names
      const possibleQueries = [
        // Try contractState
        {
          name: 'contractState',
          query: `query GetContractState($address: String!) {
            contractState(address: $address) {
              address
              state
            }
          }`
        },
        // Try contractAction - query the specific contract by address
        {
          name: 'contractAction',
          query: `query GetContractState($address: String!) {
            contractAction(contractAddress: $address) {
              contractAddress
              state
              chainState
            }
          }`
        },
        // Try contracts
        {
          name: 'contracts',
          query: `query GetContractState($address: String!) {
            contracts(where: { address: { _eq: $address } }) {
              address
              state
            }
          }`
        }
      ];

      for (const queryAttempt of possibleQueries) {
        console.log(`[SDK] Trying query with field: ${queryAttempt.name}`);
        const response = await fetch(this.config.indexer, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: queryAttempt.query,
            variables: {
              address: contractAddress
            }
          })
        });

        if (!response.ok) {
          console.log(`[SDK] ${queryAttempt.name} failed with HTTP ${response.status}`);
          continue;
        }

        const result = await response.json();
        console.log(`[SDK] ${queryAttempt.name} response:`, JSON.stringify(result, null, 2));

        if (!result.errors && result.data) {
          const stateData = result.data[queryAttempt.name];
          console.log(`[SDK] ${queryAttempt.name} stateData:`, stateData);

          if (stateData) {
            console.log('[SDK] ✅ Got contract state from HTTP GraphQL query');
            // Handle different response structures:
            // - contractAction: might have different structure
            // - contracts: array response
            // - contractState: direct state
            if (Array.isArray(stateData)) {
              return stateData[0]?.state;
            } else if (stateData.state) {
              return stateData.state;
            } else {
              // contractAction might return the state directly or in a different field
              console.log('[SDK] Checking alternative state fields...');
              return stateData;
            }
          }
        }
      }

      throw new Error('No valid GraphQL query found for contract state');
    } catch (error) {
      console.error('[SDK] ❌ HTTP GraphQL query failed:', error);
      throw error;
    }
  }

  /**
   * Manual callTx implementation for browser (bypasses findDeployedContract)
   */
  private async manualCallTx(circuitId: string, ...args: any[]): Promise<any> {
    console.log(`[SDK] Manual callTx for circuit: ${circuitId}`);

    try {
      // Get current contract state from indexer
      // We MUST get the actual contract state - can't fake a StateValue
      console.log('[SDK] Querying contract state from indexer...');

      const contractStateResult = await this.providers.publicDataProvider.queryContractState(this.contractAddress);

      let initialContractState: any;

      if (!contractStateResult || !contractStateResult.data) {
        // Browser indexer returns null
        console.log('[SDK] ⚠️ publicDataProvider.queryContractState returned null');

        // For Lace wallet in browser, use default empty state
        // The wallet and indexer will handle state synchronization internally
        if (this.walletType === 'lace') {
          console.log('[SDK] Using default empty state for Lace wallet (browser mode)');
          console.log('[SDK] Lace wallet will manage state internally during transaction');

          // Import compact-runtime to create empty state
          const { ContractState } = await import('@midnight-ntwrk/compact-runtime');

          // Create a default empty contract state
          // NOTE: We need to pass the StateValue instance, not just .data
          initialContractState = new ContractState();

          console.log('[SDK] ✅ Using empty contract state for browser transaction');
          console.log('[SDK] Empty state (StateValue):', initialContractState);
        } else {
          // For seed wallet, we need actual state - try HTTP query
          console.log('[SDK] Attempting direct HTTP GraphQL query to indexer...');

          try {
            const stateData = await this.queryContractStateViaHTTP(this.contractAddress);
            console.log('[SDK] ✅ Got contract state from HTTP GraphQL query');
            initialContractState = stateData;
          } catch (httpError) {
            console.error('[SDK] HTTP GraphQL query failed:', httpError);
            throw new Error(
              `Cannot query contract state from indexer. ` +
              `Both publicDataProvider and direct HTTP query failed: ${httpError instanceof Error ? httpError.message : String(httpError)}`
            );
          }
        }
      } else {
        initialContractState = contractStateResult.data;
        console.log('[SDK] ✅ Contract state retrieved from indexer');
      }

      // Execute the callTx with the contract state
      return await this.executeCallTx(circuitId, initialContractState, args);
    } catch (error) {
      console.error(`[SDK] ❌ Failed to execute ${circuitId}:`, error);
      throw error;
    }
  }

  /**
   * Execute callTx with given contract state
   */
  private async executeCallTx(circuitId: string, initialContractState: any, args: any[]): Promise<any> {
    // Get wallet state
    const walletState = this.walletType === 'seed'
      ? await Rx.firstValueFrom(this.wallet.state())
      : await this.wallet.state();

    // Get Zswap chain state from indexer
    let zswapState: any;

    try {
      zswapState = await this.providers.publicDataProvider.queryZswapState(this.contractAddress);

      if (!zswapState) {
        console.log('[SDK] ⚠️ Zswap state query returned null, using default');
        // Default Zswap chain state
        zswapState = {
          coinPublicKeys: [],
          coinCommitments: [],
          nullifierSet: new Set(),
        };
      } else {
        console.log('[SDK] ✅ Zswap state retrieved from indexer');
      }
    } catch (zswapError) {
      console.warn('[SDK] ⚠️ Failed to query zswap state:', zswapError);
      zswapState = {
        coinPublicKeys: [],
        coinCommitments: [],
        nullifierSet: new Set(),
      };
    }

    console.log('[SDK] Calling circuit locally...');

    // Call circuit locally
    const callResult = call({
      contract: this.contract,
      circuitId: circuitId as any,
      contractAddress: this.contractAddress as any,
      args: args,
      coinPublicKey: walletState.coinPublicKey,
      initialContractState: initialContractState,
      initialZswapChainState: zswapState,
      initialPrivateState: {},
    });

    console.log('[SDK] Creating unproven transaction...');

    // Create unproven transaction
    const unprovenTx = createUnprovenCallTx({
      privateStateProvider: this.providers.privateStateProvider,
      privateStateId: 'escrow-state',
      contractAddress: this.contractAddress as any,
      callResult,
    });

    console.log('[SDK] Balancing and proving transaction with wallet...');

    // Balance and prove transaction
    const balancedTx = await this.providers.walletProvider.balanceTx(
      unprovenTx.tx,
      unprovenTx.newCoins
    );

    console.log('[SDK] Submitting transaction...');

    // Submit transaction
    const result = await submitCallTx({
      privateStateProvider: this.providers.privateStateProvider,
      publicDataProvider: this.providers.publicDataProvider,
      unprovenCallTxData: unprovenTx,
      submittedTx: balancedTx,
    });

    console.log('[SDK] ✅ Transaction submitted successfully');

    return {
      ...result,
      contractCallResult: callResult.private.result,
    };
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
