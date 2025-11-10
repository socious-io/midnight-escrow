import { useState } from 'react';
import { Contract } from "@midnight-escrow/contract/escrow";
import { witnesses } from "@midnight-escrow/contract";
import { createProviders } from './provider';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { connectToWallet } from './connectToWallet';
import { DAppConnectorWalletAPI, DAppConnectorWalletState, ServiceUriConfig } from '@midnight-ntwrk/dapp-connector-api';

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
  const [wallet, setWallet] = useState<DAppConnectorWalletAPI>();
  const [walletState, setWalletState] = useState<DAppConnectorWalletState>();
  const [serviceUris, setServiceUris] = useState<ServiceUriConfig>();
  const [joinedContract, setJoinedContract] = useState<Contract>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Form inputs
  const [dustAmount, setDustAmount] = useState('');
  const [contributorAddress, setContributorAddress] = useState('');
  const [releaseEscrowId, setReleaseEscrowId] = useState('');

  
  const createCoin = async (amount: bigint) => {
    const nonce = new Uint8Array(Buffer.from(suitableCoin.nonce, 'hex'));

      // Convert type (TokenType = 35-byte hex) to color (Bytes<32>)
      const typeBytes = Buffer.from(suitableCoin.type, 'hex');
      const color = new Uint8Array(typeBytes.slice(2, 34)); // Skip 2-byte prefix, take 32 bytes

      return {
        nonce: nonce,
        color: color,
        value: amount,
      };
  }
  const connectWallet = async () => {
    setLoading(true);
    setError('');

    try {
      console.log('[1/5] Connecting to Midnight Lace wallet...');
      const { wallet: laceAPI, uris } = await connectToWallet();
      console.log('[1/5] ✅ Wallet connected, API and URIs obtained');
      
      setWallet(laceAPI);
      setServiceUris(uris);

      console.log('[2/5] Getting wallet state...');
      const state = await laceAPI.state();
      setWalletState(state);
      console.log('[2/5] ✅ Wallet shielded address:', state.address);

      setConnected(true);

      console.log('✅✅✅ CONNECTION COMPLETE! ✅✅✅');

      console.log('Joining escrow contract...');
      const escrow = new Contract(witnesses);
      const providers = await createProviders(laceAPI, state, serviceUris?.proverServerUri);
      
      console.log('Service URIs:', serviceUris);
      console.log('Providers:', providers);

      const privateStateId = state.address;
      const initialPrivateState = await providers.privateStateProvider.get(privateStateId) || {};

      console.log('Attempting to join contract with address:', CONTRACT_ADDRESS);
      const joined = await findDeployedContract(providers, {
        contractAddress: CONTRACT_ADDRESS,
        contract: escrow,
        privateStateId: privateStateId,
        initialPrivateState: initialPrivateState,
      });

      console.log('Joined contract:', joined);

      setJoinedContract(joined);

    } catch (err: any) {
      setError(err.message || 'Failed to connect wallet');
      console.error('Connection error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateEscrow = async (e: React.FormEvent) => {
    e.preventDefault();

    setLoading(true);
    setError('');
    if (wallet === undefined || walletState === undefined) {
      throw new Error('Wallet is not connected');
    }

    if (!joinedContract) {
      setError('Contract not joined');
      setLoading(false);
      return;
    }

    try {
      const createResult = await joinedContract.callTx.create(
        contributorAddress,
        createCoin(BigInt(dustAmount))
      );
      console.log(`Contract escrow created result : ${createResult}`);

    } catch (err: any) {
      setError(err.message || 'An unknown error occurred');
      console.error('Create escrow error:', err);
    } finally {
      setLoading(false);
    }
  };
  const handleReleaseEscrow = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    if (!joinedContract) {
      setError('Contract not joined');
      setLoading(false);
      return;
    }
    try {
      const escrowId = BigInt(releaseEscrowId);
      await joinedContract.callTx.release(escrowId);
      alert(`Escrow released successfully! Escrow ID: ${escrowId}`);
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
                {walletState?.address}
              </span>
              <button
                onClick={() => {
                  if (walletState?.address) {
                    navigator.clipboard.writeText(walletState.address);
                    alert('Shielded address copied to clipboard!');
                  }
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