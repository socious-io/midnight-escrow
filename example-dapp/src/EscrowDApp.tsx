import { useState } from 'react';
import { EscrowClient } from 'midnight-escrow/sdk/src';

// Get contract address from environment variable
const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS;

if (!CONTRACT_ADDRESS) {
  throw new Error('VITE_CONTRACT_ADDRESS is not set in .env file');
}

// Configuration from env
const MIDNIGHT_CONFIG = {
  indexer: import.meta.env.VITE_INDEXER_URL || 'https://indexer.testnet-02.midnight.network/api/v1/graphql',
  indexerWS: import.meta.env.VITE_INDEXER_WS || 'wss://indexer.testnet-02.midnight.network/api/v1/graphql/ws',
  node: import.meta.env.VITE_NODE_URL || 'https://rpc.testnet-02.midnight.network',
  proofServer: import.meta.env.VITE_PROOF_SERVER || 'https://midnight-proofserver.socious.io',
  proofTimeout: 900000,
};

export default function EscrowDApp() {
  const [connected, setConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');
  const [balance, setBalance] = useState('0');
  const [escrowClient, setEscrowClient] = useState<EscrowClient | null>(null);
  const [lastEscrowId, setLastEscrowId] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Form inputs
  const [dustAmount, setDustAmount] = useState('');
  const [contributorAddress, setContributorAddress] = useState('');
  const [releaseEscrowId, setReleaseEscrowId] = useState('');

  const connectWallet = async () => {
    setLoading(true);
    setError('');

    try {
      console.log('[1/5] Checking for Midnight Lace wallet...');
      const midnight = (window as any).midnight;
      if (!midnight?.mnLace) {
        throw new Error('Midnight Lace wallet not found. Please install Lace wallet extension.');
      }
      console.log('[1/5] ✅ Midnight Lace wallet found');

      console.log('[2/5] Enabling wallet (requesting user permission)...');
      const laceAPI = await midnight.mnLace.enable();
      console.log('[2/5] ✅ Wallet enabled, API obtained');

      console.log('[3/5] Getting wallet state...');
      const state = await laceAPI.state();
      setWalletAddress(state.address);
      console.log('[3/5] ✅ Wallet shielded address:', state.address);

      console.log('[4/5] Creating EscrowClient with Lace wallet...');
      const client = new EscrowClient(MIDNIGHT_CONFIG, CONTRACT_ADDRESS, '/escrow-contract');
      await client.connect({ type: 'lace', laceAPI });
      console.log('[4/5] ✅ EscrowClient connected');

      console.log('[5/5] Getting wallet balance...');
      const balanceInfo = await client.getBalance();
      setBalance(balanceInfo.balance.toString());
      console.log('[5/5] ✅ Balance:', balanceInfo.balance);

      console.log('[5/5] Getting contract state...');
      const escrowState = await client.getEscrowState();
      setLastEscrowId(escrowState.lastEscrowId);
      console.log('[5/5] ✅ Last escrow ID:', escrowState.lastEscrowId);

      setEscrowClient(client);
      setConnected(true);

      console.log('✅✅✅ CONNECTION COMPLETE! ✅✅✅');
    } catch (err: any) {
      setError(err.message || 'Failed to connect wallet');
      console.error('Connection error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateEscrow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!escrowClient) return;

    setLoading(true);
    setError('');

    try {
      // Validate inputs
      if (!dustAmount || !contributorAddress) {
        throw new Error('DUST amount and contributor address are required');
      }

      const amount = BigInt(dustAmount);
      if (amount <= 0n) {
        throw new Error('DUST amount must be greater than 0');
      }

      console.log('Creating escrow with params:', {
        contributorAddress,
        amount: amount.toString(),
      });

      // Create escrow using new SDK
      const result = await escrowClient.createEscrow({
        contributorAddress,
        amount,
      });

      if (!result.success) {
        throw new Error(result9.error || 'Failed to create escrow');
      }

      alert(
        `Escrow created successfully!\nEscrow ID: ${result.escrowId}\nProof time: ${result.proofTime.toFixed(2)}s`
      );

      // Update state
      const escrowState = await escrowClient.getEscrowState();
      setLastEscrowId(escrowState.lastEscrowId);

      const balanceInfo = await escrowClient.getBalance();
      setBalance(balanceInfo.balance.toString());

      // Clear form
      setDustAmount('');
      setContributorAddress('');
    } catch (err: any) {
      setError(err.message || 'Failed to create escrow');
      console.error('Create escrow error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleReleaseEscrow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!escrowClient) return;

    setLoading(true);
    setError('');

    try {
      if (!releaseEscrowId) {
        throw new Error('Escrow ID is required');
      }

      const escrowId = Number(releaseEscrowId);
      if (isNaN(escrowId) || escrowId < 0) {
        throw new Error('Invalid escrow ID');
      }

      console.log('Releasing escrow:', escrowId);

      const result = await escrowClient.releaseEscrow({ escrowId });

      if (!result.success) {
        throw new Error(result.error || 'Failed to release escrow');
      }

      alert(`Escrow released successfully!\nEscrow ID: ${escrowId}\nProof time: ${result.proofTime.toFixed(2)}s`);

      // Update state
      const balanceInfo = await escrowClient.getBalance();
      setBalance(balanceInfo.balance.toString());

      // Clear form
      setReleaseEscrowId('');
    } catch (err: any) {
      setError(err.message || 'Failed to release escrow');
      console.error('Release escrow error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Midnight Escrow DApp</h1>
      <p style={{ color: '#666', marginBottom: '30px' }}>
        Using local SDK from <code>midnight-escrow</code> package
      </p>

      {error && (
        <div
          style={{
            backgroundColor: '#fee',
            color: '#c00',
            padding: '10px',
            borderRadius: '4px',
            marginBottom: '20px',
          }}
        >
          {error}
        </div>
      )}

      {!connected ? (
        <div>
          <p>Connect your Lace wallet to interact with the escrow contract.</p>
          <button
            onClick={connectWallet}
            disabled={loading}
            style={{
              padding: '10px 20px',
              fontSize: '16px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            {loading ? 'Connecting...' : 'Connect Lace Wallet'}
          </button>
        </div>
      ) : (
        <div>
          <div
            style={{
              backgroundColor: '#e7f3ff',
              padding: '15px',
              borderRadius: '4px',
              marginBottom: '20px',
            }}
          >
            <div style={{ marginBottom: '10px' }}>
              <strong>Shielded Address:</strong>{' '}
              <span style={{ fontFamily: 'monospace', fontSize: '12px', wordBreak: 'break-all' }}>
                {walletAddress}
              </span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(walletAddress);
                  alert('Shielded address copied to clipboard!');
                }}
                style={{
                  marginLeft: '10px',
                  padding: '5px 10px',
                  fontSize: '12px',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: 'pointer',
                }}
              >
                Copy
              </button>
            </div>
            <div style={{ marginBottom: '10px' }}>
              <strong>Balance:</strong> {balance} tDUST (smallest units)
            </div>
            <div style={{ marginBottom: '10px' }}>
              <strong>Contract:</strong>{' '}
              <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{CONTRACT_ADDRESS}</span>
            </div>
            <div>
              <strong>Last Escrow ID:</strong> {lastEscrowId}
            </div>
          </div>

          {/* Create Escrow Form */}
          <div
            style={{
              border: '1px solid #ddd',
              padding: '20px',
              borderRadius: '8px',
              marginBottom: '30px',
            }}
          >
            <h2>Create New Escrow</h2>
            <form onSubmit={handleCreateEscrow}>
              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                  DUST Amount (required) *
                </label>
                <input
                  type="number"
                  value={dustAmount}
                  onChange={(e) => setDustAmount(e.target.value)}
                  placeholder="e.g., 1000"
                  required
                  style={{
                    width: '100%',
                    padding: '8px',
                    fontSize: '14px',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                  }}
                />
                <small>Enter amount in smallest units (1 DUST = 1,000,000,000 smallest units)</small>
              </div>

              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                  Contributor Address (required) *
                </label>
                <input
                  type="text"
                  value={contributorAddress}
                  onChange={(e) => setContributorAddress(e.target.value)}
                  placeholder="mn1... (Midnight Shielded Address)"
                  required
                  style={{
                    width: '100%',
                    padding: '8px',
                    fontSize: '14px',
                    fontFamily: 'monospace',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                  }}
                />
                <small style={{ color: '#28a745' }}>
                  ✅ Use your wallet's SHIELDED ADDRESS (mn1...) to receive funds.
                  <br />
                  You can use the address shown above.
                </small>
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  padding: '10px 20px',
                  fontSize: '16px',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  width: '100%',
                }}
              >
                {loading ? 'Creating... (this may take 3-5 minutes for proof generation)' : 'Create Escrow'}
              </button>
            </form>
          </div>

          {/* Release Escrow Form */}
          <div
            style={{
              border: '1px solid #ddd',
              padding: '20px',
              borderRadius: '8px',
              marginBottom: '30px',
            }}
          >
            <h2>Release Escrow</h2>
            <form onSubmit={handleReleaseEscrow}>
              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                  Escrow ID (required) *
                </label>
                <input
                  type="number"
                  value={releaseEscrowId}
                  onChange={(e) => setReleaseEscrowId(e.target.value)}
                  placeholder="e.g., 0"
                  required
                  style={{
                    width: '100%',
                    padding: '8px',
                    fontSize: '14px',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                  }}
                />
                <small>Enter the escrow ID to release (0-based index)</small>
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  padding: '10px 20px',
                  fontSize: '16px',
                  backgroundColor: '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  width: '100%',
                }}
              >
                {loading ? 'Releasing... (this may take 3-5 minutes for proof generation)' : 'Release Escrow'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
