import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider, DEFAULT_CONFIG } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { Transaction as ZswapTransaction } from '@midnight-ntwrk/zswap';
import { DAppConnectorWalletAPI, DAppConnectorWalletState } from '@midnight-ntwrk/dapp-connector-api';
import { Transaction } from '@midnight-ntwrk/ledger';
import { getLedgerNetworkId, getZswapNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {createBalancedTx } from '@midnight-ntwrk/midnight-js-types';

const CONFIG = {
  indexer: 'https://indexer.testnet-02.midnight.network/api/v1/graphql',
  indexerWS: 'wss://indexer.testnet-02.midnight.network/api/v1/graphql/ws',
  node: 'https://rpc.testnet-02.midnight.network',
  proofServer: 'https://midnight-proofserver.socious.io',
  proofTimeout: 900000,
};

export async function createProviders(wallet: DAppConnectorWalletAPI, walletState: DAppConnectorWalletState, proverServerUri?: string) {

  const publicDataProvider = indexerPublicDataProvider(CONFIG.indexer, CONFIG.indexerWS);
  
  // Replace NodeZkConfigProvider with FetchZkConfigProvider for browser compatibility
  const zkConfigBaseURL = `/zkir`; // You need to host your ZK artifacts on a web server
  const zkConfigProvider = new FetchZkConfigProvider(zkConfigBaseURL, fetch);

  DEFAULT_CONFIG.timeout = CONFIG.proofTimeout;
  const proofProvider = httpClientProofProvider(proverServerUri || CONFIG.proofServer);
  
  const privateStateProvider = await levelPrivateStateProvider({
    privateStateStoreName: 'escrow-state'
  });

  const walletProvider = {
    coinPublicKey: walletState.coinPublicKey,
    encryptionPublicKey: walletState.encryptionPublicKey,
    balanceTx: async (tx: any, newCoins: any) => {
      console.log('balanceTx: Starting');
      const balanced = await wallet.balanceTransaction(
        ZswapTransaction.deserialize(tx.serialize(getLedgerNetworkId()), getZswapNetworkId()),
        newCoins,
      );
      console.log('balanceTx: Transaction balanced');
      const proved = await wallet.proveTransaction(balanced);
      console.log('balanceTx: Transaction proved');
      const deserialized = Transaction.deserialize(proved.serialize(getZswapNetworkId()), getLedgerNetworkId());
      console.log('balanceTx: Transaction deserialized');
      const finalTx = createBalancedTx(deserialized);
      console.log('balanceTx: Finished');
      return finalTx;
    },
    submitTx: async (tx: any) => wallet.submitTransaction(tx),
  };

  return {
    publicDataProvider,
    zkConfigProvider,
    proofProvider,
    privateStateProvider,
    walletProvider,
    midnightProvider: walletProvider,
  };
}