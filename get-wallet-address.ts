import 'dotenv/config';
import { WalletBuilder } from '@midnight-ntwrk/wallet';
import { getZswapNetworkId, setNetworkId, NetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { nativeToken } from '@midnight-ntwrk/ledger';
import * as Rx from 'rxjs';

const CONFIG = {
  indexer: 'https://indexer.testnet-02.midnight.network/api/v1/graphql',
  indexerWS: 'wss://indexer.testnet-02.midnight.network/api/v1/graphql/ws',
  proofServer: 'https://midnight-proofserver.socious.io',
  node: 'https://rpc.testnet-02.midnight.network',
};

setNetworkId(NetworkId.TestNet);

const walletSeed = process.env.WALLET_SEED;
if (!walletSeed) {
  console.error('❌ WALLET_SEED not set in .env');
  process.exit(1);
}

console.log('🔨 Building wallet...\n');

const wallet = await WalletBuilder.buildFromSeed(
  CONFIG.indexer,
  CONFIG.indexerWS,
  CONFIG.proofServer,
  CONFIG.node,
  walletSeed,
  getZswapNetworkId(),
  'error',
);

wallet.start();

await Rx.firstValueFrom(
  wallet.state().pipe(
    Rx.filter((state) => state.syncProgress?.synced === true),
    Rx.take(1),
  )
);

const state = await Rx.firstValueFrom(wallet.state());

console.log('✅ New Wallet Created!\n');
console.log('📋 Wallet Address:');
console.log(state.address);
console.log('\n💰 Balance:', (state.balances[nativeToken()] ?? 0n).toString(), 'tDUST');
console.log('\n🚰 Use this address to request funds from the Midnight faucet');
console.log('   https://faucet.midnight.network/\n');

await wallet.close();
