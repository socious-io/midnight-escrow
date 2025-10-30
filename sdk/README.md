# Midnight Escrow SDK

TypeScript SDK for interacting with the Midnight blockchain escrow smart contract.

## Installation

### From local path (during development)

```bash
npm install file:../midnight-escrow/sdk
```

### From npm (once published)

```bash
npm install @socious/midnight-escrow-sdk
```

## Requirements

- Node.js 18+
- Midnight contract deployed on TestNet
- Wallet seed (hex string)

## Usage

### 1. Initialize the Client

```typescript
import { EscrowClient } from '@socious/midnight-escrow-sdk';

const config = {
  indexer: 'https://indexer.testnet-02.midnight.network/api/v1/graphql',
  node: 'https://rpc.testnet-02.midnight.network',
  proofServer: 'https://midnight-proofserver.socious.io',
  proofTimeout: 900000, // 15 minutes
};

const contractAddress = '02001d976090bdef12bed284747f7c2a02c7346332cad3eaae5a8d247341b8cc2716';
const zkConfigPath = '/path/to/contract/src/managed/escrow';

const client = new EscrowClient(config, contractAddress, zkConfigPath);
```

### 2. Connect Wallet

```typescript
await client.connect({
  seed: 'your-wallet-seed-hex-string'
});

// Get wallet balance
const balance = await client.getBalance();
console.log(`Balance: ${balance.balance} tDUST`);
console.log(`Address: ${balance.address}`);
```

### 3. Create Escrow

```typescript
const result = await client.createEscrow({
  contributorAddress: 'mn_shield-addr_test1...',
  amount: 10_000n, // Amount in tDUST
});

if (result.success) {
  console.log(`Escrow created! ID: ${result.escrowId}`);
  console.log(`Proof time: ${result.proofTime}s`);
} else {
  console.error(`Failed: ${result.error}`);
}
```

### 4. Release Escrow

```typescript
const result = await client.releaseEscrow({
  escrowId: 1,
});

if (result.success) {
  console.log(`Escrow ${result.escrowId} released!`);
  console.log(`Proof time: ${result.proofTime}s`);
} else {
  console.error(`Failed: ${result.error}`);
}
```

### 5. Get Contract State

```typescript
const state = await client.getEscrowState();
console.log(`Last escrow ID: ${state.lastEscrowId}`);
```

### 6. Disconnect

```typescript
await client.disconnect();
```

## Complete Example

```typescript
import { EscrowClient } from '@socious/midnight-escrow-sdk';

async function main() {
  const client = new EscrowClient(
    {
      indexer: 'https://indexer.testnet-02.midnight.network/api/v1/graphql',
      node: 'https://rpc.testnet-02.midnight.network',
      proofServer: 'https://midnight-proofserver.socious.io',
    },
    '02001d976090bdef12bed284747f7c2a02c7346332cad3eaae5a8d247341b8cc2716',
    './contract/src/managed/escrow'
  );

  try {
    // Connect
    await client.connect({
      seed: process.env.WALLET_SEED!
    });

    console.log('Connected!');
    const balance = await client.getBalance();
    console.log(`Balance: ${balance.balance} tDUST`);

    // Create escrow
    console.log('Creating escrow...');
    const createResult = await client.createEscrow({
      contributorAddress: 'mn_shield-addr_test1...',
      amount: 10_000n,
    });

    if (!createResult.success) {
      throw new Error(createResult.error);
    }

    console.log(`✅ Escrow ${createResult.escrowId} created in ${createResult.proofTime}s`);

    // Release escrow
    console.log('Releasing escrow...');
    const releaseResult = await client.releaseEscrow({
      escrowId: createResult.escrowId,
    });

    if (!releaseResult.success) {
      throw new Error(releaseResult.error);
    }

    console.log(`✅ Escrow released in ${releaseResult.proofTime}s`);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.disconnect();
  }
}

main();
```

## API Reference

### `EscrowClient`

#### Constructor

```typescript
constructor(
  config: MidnightConfig,
  contractAddress: string,
  zkConfigPath: string
)
```

#### Methods

- `connect(walletConfig: WalletConfig): Promise<void>`
- `getBalance(): Promise<WalletBalance>`
- `getEscrowState(): Promise<EscrowState>`
- `createEscrow(params: CreateEscrowParams): Promise<CreateEscrowResult>`
- `releaseEscrow(params: ReleaseEscrowParams): Promise<ReleaseEscrowResult>`
- `disconnect(): Promise<void>`

## Types

### `MidnightConfig`

```typescript
{
  indexer: string;
  indexerWS?: string;
  node: string;
  proofServer: string;
  proofTimeout?: number;
}
```

### `CreateEscrowParams`

```typescript
{
  contributorAddress: string;
  amount: bigint;
}
```

### `CreateEscrowResult`

```typescript
{
  escrowId: number;
  proofTime: number;
  success: boolean;
  error?: string;
}
```

### `ReleaseEscrowParams`

```typescript
{
  escrowId: number;
}
```

### `ReleaseEscrowResult`

```typescript
{
  escrowId: number;
  proofTime: number;
  success: boolean;
  error?: string;
}
```

## Known Issues

- **Proof server timeouts**: The release functionality may timeout due to proof server instability (related to [GitHub issue #63](https://github.com/midnightntwrk/community-hub/issues/63))
- **Proof generation time**: Creating escrows takes ~3-5 minutes for proof generation
- **Single coin limitation**: Currently the contract receives entire coins, which may cause issues if you have only one coin available

## License

MIT
