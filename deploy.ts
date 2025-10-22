import 'dotenv/config';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { httpClientProofProvider, DEFAULT_CONFIG } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { WalletBuilder } from '@midnight-ntwrk/wallet';
import { getZswapNetworkId, getLedgerNetworkId, setNetworkId, NetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { nativeToken, Transaction } from '@midnight-ntwrk/ledger';
import { Transaction as ZswapTransaction } from '@midnight-ntwrk/zswap';
import { createBalancedTx } from '@midnight-ntwrk/midnight-js-types';
import { MidnightBech32m, ShieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import * as Rx from 'rxjs';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { Contract as EscrowContract, ledger as escrowLedger } from './contract/src/managed/escrow/contract/index.cjs';
import { witnesses } from './contract/src/witnesses.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG = {
  indexer: 'https://indexer.testnet-02.midnight.network/api/v1/graphql',
  indexerWS: 'wss://indexer.testnet-02.midnight.network/api/v1/graphql/ws',
  node: 'https://rpc.testnet-02.midnight.network',
  proofServer: 'https://midnight-proofserver.socious.io',
  proofTimeout: 900000,
};

const ESCROW_AMOUNT = 10_000n;
const CONTRIBUTOR_ADDRESS = 'mn_shield-addr_test1x08854vlcnjk9wtt95ejz5wk2sd8s6w8lqu0jlsryak9j58qd8qsxqrzffwamyq2z4xuj95snfj06g0p8gpggq0jc0raxq8dpg4f2y9ucqvkdw46';

function parseCoinPublicKey(address: string): Uint8Array {
  const bech32 = MidnightBech32m.parse(address);
  const shieldedAddr = ShieldedAddress.codec.decode(bech32.network, bech32);
  return Uint8Array.from(shieldedAddr.coinPublicKey.data);
}

function log(message: string, indent: number = 0) {
  console.log('  '.repeat(indent) + message);
}

async function buildWallet(seed: string) {
  log('🔨 Building wallet...');
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
  await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.filter((state) => state.syncProgress?.synced === true),
      Rx.take(1),
    )
  );

  const state = await Rx.firstValueFrom(wallet.state());
  log(`✅ Wallet: ${state.address}`, 1);
  log(`Balance: ${(state.balances[nativeToken()] ?? 0n).toString()} tDUST`, 1);
  return { wallet, state };
}

async function createProviders(wallet: any, walletState: any) {
  log('🔧 Creating providers...');

  const publicDataProvider = indexerPublicDataProvider(CONFIG.indexer, CONFIG.indexerWS);
  const zkConfigPath = path.resolve(__dirname, 'contract', 'src', 'managed', 'escrow');
  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);

  DEFAULT_CONFIG.timeout = CONFIG.proofTimeout;
  const proofProvider = httpClientProofProvider(CONFIG.proofServer);
  const privateStateProvider = await levelPrivateStateProvider({
    privateStateStoreName: 'escrow-state'
  });

  const walletProvider = {
    coinPublicKey: walletState.coinPublicKey,
    encryptionPublicKey: walletState.encryptionPublicKey,
    balanceTx: async (tx: any, newCoins: any) => {
      return wallet
        .balanceTransaction(
          ZswapTransaction.deserialize(tx.serialize(getLedgerNetworkId()), getZswapNetworkId()),
          newCoins,
        )
        .then((tx: any) => wallet.proveTransaction(tx))
        .then((zswapTx: any) => Transaction.deserialize(zswapTx.serialize(getZswapNetworkId()), getLedgerNetworkId()))
        .then(createBalancedTx);
    },
    submitTx: async (tx: any) => wallet.submitTransaction(tx),
  };

  log('✅ Providers ready');
  return {
    publicDataProvider,
    zkConfigProvider,
    proofProvider,
    privateStateProvider,
    walletProvider,
    midnightProvider: walletProvider,
  };
}

async function deployNewContract(providers: any) {
  log('📝 Deploying new contract...');
  const startTime = Date.now();

  const escrow = new EscrowContract(witnesses);
  const deployed = await deployContract(providers, {
    contract: escrow,
    privateStateId: 'escrow-state',
    initialPrivateState: {},
  });

  const contractAddress = deployed.deployTxData.public.contractAddress;
  const deployTime = ((Date.now() - startTime) / 1000).toFixed(2);

  log(`✅ Deployed in ${deployTime}s`, 1);
  log(`Address: ${contractAddress}`, 1);

  await fs.writeFile(
    './deployment.json',
    JSON.stringify({
      contractAddress,
      blockHeight: deployed.deployTxData.public.blockHeight,
      deployedAt: new Date().toISOString(),
    }, null, 2)
  );

  return contractAddress;
}

async function main() {
  console.log('🚀 Escrow Contract Deployment & Testing\n');
  setNetworkId(NetworkId.TestNet);

  const walletSeed = process.env.WALLET_SEED;
  if (!walletSeed) {
    console.error('❌ WALLET_SEED not set in .env');
    process.exit(1);
  }

  const existingContractAddress = process.env.CONTRACT_ADDRESS;

  try {
    const { wallet, state: walletState } = await buildWallet(walletSeed);
    const providers = await createProviders(wallet, walletState);

    let contractAddress: string;

    if (!existingContractAddress) {
      contractAddress = await deployNewContract(providers);

      // Update .env
      const envPath = path.resolve(__dirname, '.env');
      const envContent = await fs.readFile(envPath, 'utf-8');
      if (!envContent.includes('CONTRACT_ADDRESS=')) {
        await fs.writeFile(envPath, envContent + `\nCONTRACT_ADDRESS=${contractAddress}\n`);
      }

      console.log('\n✅ Deployment complete!');
      console.log('🔄 Restart to test contract (npm run deploy)\n');
    } else {
      contractAddress = existingContractAddress;
      log(`📍 Using contract: ${contractAddress}`);

      // Join contract
      const escrow = new EscrowContract(witnesses);
      const joined = await findDeployedContract(providers, {
        contractAddress,
        contract: escrow,
        privateStateId: 'escrow-state',
        initialPrivateState: {},
      });

      log('✅ Joined contract', 1);

      // Get contract state
      const contractState = await providers.publicDataProvider.queryContractState(contractAddress);
      const ledgerData = escrowLedger(contractState.data);

      console.log('\n📊 Contract State:');
      log(`Last escrow ID: ${ledgerData.last_escrow_id}`, 1);

      // Test create escrow
      console.log('\n🧪 Testing CREATE escrow...\n');

      const contributorPubKeyBytes = parseCoinPublicKey(CONTRIBUTOR_ADDRESS);
      const contributorPubKey = { bytes: contributorPubKeyBytes };

      log(`💰 Creating escrow for ${ESCROW_AMOUNT} tDUST...`);
      log(`⏳ Getting available coins from wallet...`, 1);

      // Get available coins from wallet state
      const availableCoins = walletState.availableCoins;
      log(`Found ${availableCoins.length} available coins`, 1);

      // Find a coin with enough balance for the escrow
      const nativeTokenType = nativeToken();
      const suitableCoin = availableCoins.find(coin =>
        coin.value >= ESCROW_AMOUNT && coin.type === nativeTokenType
      );

      if (!suitableCoin) {
        throw new Error(`No coin found with sufficient balance (need ${ESCROW_AMOUNT} tDUST)`);
      }

      log(`Selected coin with value: ${suitableCoin.value}`, 1);

      // Build CoinInfo from the QualifiedCoinInfo
      // Convert nonce from hex string to Uint8Array (Bytes<32>)
      const nonce = new Uint8Array(Buffer.from(suitableCoin.nonce, 'hex'));

      // Convert type (TokenType = 35-byte hex) to color (Bytes<32>)
      const typeBytes = Buffer.from(suitableCoin.type, 'hex');
      const color = new Uint8Array(typeBytes.slice(2, 34)); // Skip 2-byte prefix, take 32 bytes

      const coinInfo = {
        nonce: nonce,
        color: color,
        value: ESCROW_AMOUNT
      };

      log(`⏳ Generating proof...`, 1);
      const createStart = Date.now();
      const createResult = await joined.callTx.create(
        contributorPubKey,
        coinInfo
      );

      const createTime = ((Date.now() - createStart) / 1000).toFixed(2);
      log(`✅ Escrow created in ${createTime}s!`, 1);

      // Extract commitment and mt_index from the transaction
      // The transaction outputs contain the coin that was received by the contract
      const tx = createResult.public.tx;

      // Debug: log transaction structure
      console.log('Transaction keys:', Object.keys(tx));
      console.log('Transaction type:', tx.constructor?.name);

      // Try to get outputs in different ways
      let outputs = [];
      if (Array.isArray(tx.outputs)) {
        outputs = tx.outputs;
      } else if (Array.isArray(tx.zswap?.outputs)) {
        outputs = tx.zswap.outputs;
      } else if (typeof tx.outputs === 'function') {
        outputs = tx.outputs();
      }

      log(`Transaction has ${outputs.length} outputs`, 1);

      // For now, we'll need to query the indexer to get the mt_index
      // The mt_index is assigned when the transaction is finalized on-chain
      let escrowCoinCommitment = null;
      let escrowCoinMtIndex = null;

      console.log('Will need to query indexer for mt_index');

      // Get updated state
      const updatedState = await providers.publicDataProvider.queryContractState(contractAddress);
      const updatedLedger = escrowLedger(updatedState.data);
      const escrowId = updatedLedger.last_escrow_id;

      console.log(`\n✅ CREATE test complete!`);
      console.log(`Escrow ID: ${escrowId}`);

      // Test release escrow
      console.log(`\n🧪 Testing RELEASE escrow...\n`);

      log(`🔓 Releasing escrow ${escrowId} to contributor...`);
      log(`⏳ Querying contract coins...`, 1);

      // Query contract's zswap state to get the coins with mt_indexes
      log(`Waiting for transaction to be indexed...`, 1);
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds for indexer

      const [zswapState, latestContractState] = await providers.publicDataProvider.queryZSwapAndContractState(contractAddress);

      // ZswapChainState should contain the contract's coins
      console.log('ZswapChainState keys:', Object.keys(zswapState || {}));
      console.log('ZswapChainState firstFree:', zswapState?.firstFree);

      // For now, use firstFree - 1 as the mt_index of the most recent coin
      // This is a simplification - in production you'd need more robust coin tracking
      const estimatedMtIndex = (zswapState?.firstFree || 1n) - 1n;

      log(`Estimated mt_index for escrow coin: ${estimatedMtIndex}`, 1);

      // Build QualifiedCoinInfo for the escrow coin
      const qualifiedCoinInfo = {
        nonce: nonce,
        color: color,
        value: ESCROW_AMOUNT,
        mt_index: estimatedMtIndex
      };

      log(`⏳ Generating release proof...`, 1);
      const releaseStart = Date.now();

      // Call release circuit with escrow ID and the qualified coin
      const releaseResult = await joined.callTx.release(
        escrowId,
        qualifiedCoinInfo
      );

      const releaseTime = ((Date.now() - releaseStart) / 1000).toFixed(2);
      log(`✅ Escrow released in ${releaseTime}s!`, 1);

      console.log(`\n✅ RELEASE test complete!\n`);
    }

    await wallet.close();
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();
