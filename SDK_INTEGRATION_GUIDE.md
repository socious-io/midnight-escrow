# Midnight Escrow SDK - Integration Guide for Webapp

## ✅ SDK is Ready

The SDK has been successfully created at `/home/jeyem/Socious/midnight-escrow/sdk/`

## Installation in Your Webapp

### Option 1: Install from Local Path (Recommended for Development)

In your webapp directory:

```bash
npm install file:../midnight-escrow/sdk
```

Or if your webapp is not in the same parent directory:

```bash
npm install file:/home/jeyem/Socious/midnight-escrow/sdk
```

### Option 2: Publish to npm (For Production)

1. Navigate to SDK directory and publish:
```bash
cd /home/jeyem/Socious/midnight-escrow/sdk
npm publish --access public
```

2. Then in your webapp:
```bash
npm install @socious/midnight-escrow-sdk
```

## Usage in Your Webapp

### 1. Import the SDK

```typescript
import { EscrowClient } from '@socious/midnight-escrow-sdk';
import type {
  CreateEscrowParams,
  CreateEscrowResult,
  ReleaseEscrowParams,
  ReleaseEscrowResult,
} from '@socious/midnight-escrow-sdk';
```

### 2. Initialize Client

```typescript
const client = new EscrowClient(
  {
    indexer: 'https://indexer.testnet-02.midnight.network/api/v1/graphql',
    node: 'https://rpc.testnet-02.midnight.network',
    proofServer: 'https://midnight-proofserver.socious.io',
    proofTimeout: 900000, // 15 minutes
  },
  '02001d976090bdef12bed284747f7c2a02c7346332cad3eaae5a8d247341b8cc2716', // Contract address
  '/home/jeyem/Socious/midnight-escrow/contract/src/managed/escrow' // Path to compiled contract
);
```

### 3. Connect Wallet

```typescript
// Connect with organization's wallet
await client.connect({
  seed: process.env.ORG_WALLET_SEED // From your backend/env
});

// Check balance
const balance = await client.getBalance();
console.log(`Organization wallet: ${balance.address}`);
console.log(`Balance: ${balance.balance} tDUST`);
```

### 4. Create Escrow (Organization creates escrow for contributor)

```typescript
async function createEscrowForContributor(
  contributorAddress: string,
  amount: bigint
) {
  const result = await client.createEscrow({
    contributorAddress, // Contributor's Midnight address
    amount, // Amount in tDUST (e.g., 10_000n)
  });

  if (result.success) {
    console.log(`✅ Escrow created!`);
    console.log(`Escrow ID: ${result.escrowId}`);
    console.log(`Proof generation took: ${result.proofTime}s`);

    // Save escrowId to your database
    return result.escrowId;
  } else {
    console.error(`❌ Failed: ${result.error}`);
    throw new Error(result.error);
  }
}
```

### 5. Release Escrow (Organization releases payment to contributor)

```typescript
async function releaseEscrowToContributor(escrowId: number) {
  const result = await client.releaseEscrow({
    escrowId,
  });

  if (result.success) {
    console.log(`✅ Escrow ${escrowId} released!`);
    console.log(`Proof generation took: ${result.proofTime}s`);
    return true;
  } else {
    console.error(`❌ Failed: ${result.error}`);
    throw new Error(result.error);
  }
}
```

### 6. Complete Integration Example

```typescript
import { EscrowClient } from '@socious/midnight-escrow-sdk';

class EscrowService {
  private client: EscrowClient;
  private connected: boolean = false;

  constructor() {
    this.client = new EscrowClient(
      {
        indexer: process.env.MIDNIGHT_INDEXER!,
        node: process.env.MIDNIGHT_NODE!,
        proofServer: process.env.MIDNIGHT_PROOF_SERVER!,
      },
      process.env.MIDNIGHT_CONTRACT_ADDRESS!,
      process.env.MIDNIGHT_ZK_CONFIG_PATH!
    );
  }

  async connect() {
    if (this.connected) return;

    await this.client.connect({
      seed: process.env.ORG_WALLET_SEED!,
    });

    this.connected = true;
    console.log('Midnight escrow client connected');
  }

  async createEscrow(contributorAddress: string, amountInTDust: number) {
    await this.connect();

    const result = await this.client.createEscrow({
      contributorAddress,
      amount: BigInt(amountInTDust),
    });

    if (!result.success) {
      throw new Error(`Failed to create escrow: ${result.error}`);
    }

    return {
      escrowId: result.escrowId,
      proofTime: result.proofTime,
    };
  }

  async releaseEscrow(escrowId: number) {
    await this.connect();

    const result = await this.client.releaseEscrow({ escrowId });

    if (!result.success) {
      throw new Error(`Failed to release escrow: ${result.error}`);
    }

    return {
      success: true,
      proofTime: result.proofTime,
    };
  }

  async getBalance() {
    await this.connect();
    return await this.client.getBalance();
  }

  async disconnect() {
    if (this.connected) {
      await this.client.disconnect();
      this.connected = false;
    }
  }
}

export const escrowService = new EscrowService();
```

## Environment Variables Needed in Your Webapp

```env
# Midnight Network Configuration
MIDNIGHT_INDEXER=https://indexer.testnet-02.midnight.network/api/v1/graphql
MIDNIGHT_NODE=https://rpc.testnet-02.midnight.network
MIDNIGHT_PROOF_SERVER=https://midnight-proofserver.socious.io

# Contract Configuration
MIDNIGHT_CONTRACT_ADDRESS=02001d976090bdef12bed284747f7c2a02c7346332cad3eaae5a8d247341b8cc2716
MIDNIGHT_ZK_CONFIG_PATH=/path/to/contract/src/managed/escrow

# Organization Wallet (Backend only - NEVER expose to frontend)
ORG_WALLET_SEED=your-organization-wallet-seed-hex
```

## Important Notes

### Security
- ⚠️ **NEVER expose wallet seed to frontend/client-side**
- Run escrow operations from your backend API only
- Only organization wallet should create/release escrows

### Performance
- Creating escrow takes ~3-5 minutes (ZK proof generation)
- Release escrow may timeout due to proof server issues (known bug)
- Show loading states to users during operations

### Error Handling
- Always check `result.success` before proceeding
- Handle timeouts gracefully (proof server issues)
- Log `result.error` for debugging

## API Flow Example

```
Frontend (Webapp)           Backend API                Midnight SDK
     |                           |                           |
     |-- POST /create-escrow --> |                           |
     |   (contributor, amount)   |                           |
     |                           |-- client.createEscrow --> |
     |                           |   (3-5 min wait)          |
     |                           |<-- result {escrowId} ---- |
     |<-- { escrowId } ----------|                           |
     |                           |                           |
     |-- POST /release-escrow -> |                           |
     |   (escrowId)              |                           |
     |                           |-- client.releaseEscrow -> |
     |                           |   (3-5 min wait)          |
     |                           |<-- result {success} ----- |
     |<-- { success } -----------|                           |
```

## SDK Files Location

```
/home/jeyem/Socious/midnight-escrow/sdk/
├── dist/              # Compiled JavaScript (ready to use)
│   ├── index.js
│   ├── index.d.ts
│   ├── client.js
│   ├── client.d.ts
│   ├── types.js
│   └── types.d.ts
├── src/               # TypeScript source
│   ├── index.ts
│   ├── client.ts
│   └── types.ts
├── package.json
├── tsconfig.json
└── README.md
```

## Next Steps

1. Install SDK in your webapp: `npm install file:../midnight-escrow/sdk`
2. Create backend API endpoints for create/release escrow
3. Integrate with your existing payment flow
4. Add loading states and error handling
5. Test on Midnight TestNet

## Support

- SDK README: `/home/jeyem/Socious/midnight-escrow/sdk/README.md`
- Contract: `/home/jeyem/Socious/midnight-escrow/contract/src/escrow.compact`
- Known issues: GitHub issue #63 (proof server timeouts on `send()` transactions)
