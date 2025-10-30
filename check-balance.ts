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

async function checkBalance(seed: string, label: string) {
  console.log(`\n🔍 Checking balance for ${label}...`);

  const wallet = await WalletBuilder.buildFromSeed(
    CONFIG.indexer,
    CONFIG.indexerWS,
    CONFIG.proofServer,
    CONFIG.node,
    seed,
    getZswapNetworkId(),
    'error',
  );

  wallet.start();

  // Wait for sync
  await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.filter((state) => state.syncProgress?.synced === true),
      Rx.take(1),
    )
  );

  const state = await Rx.firstValueFrom(wallet.state());
  console.log(`  Address: ${state.address}`);
  console.log(`  Balance: ${(state.balances[nativeToken()] ?? 0n).toString()} tDUST`);
  console.log(`  Available coins: ${state.availableCoins.length}`);

  await wallet.close();
  return state.balances[nativeToken()] ?? 0n;
}

async function main() {
  setNetworkId(NetworkId.TestNet);

  const orgSeed = process.env.WALLET_SEED;
  const contributorSeed = process.env.CONTRIBUTOR_SEED;

  if (!orgSeed) {
    console.error('❌ WALLET_SEED not set');
    process.exit(1);
  }

  await checkBalance(orgSeed, 'Organization');

  if (contributorSeed) {
    await checkBalance(contributorSeed, 'Contributor');
  } else {
    console.log('\n⚠️  CONTRIBUTOR_SEED not set in .env - cannot check contributor balance');
    console.log('   Add CONTRIBUTOR_SEED to .env to verify the transfer');
  }
}

main().catch(console.error);
