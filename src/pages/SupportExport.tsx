/**
 * SupportExport — one-off support page to let a specific user export the
 * private key for a Privy embedded wallet that Vela's backend can't sign
 * transactions for (e.g. wallets provisioned without a delegated
 * authorization key).
 *
 * Deployment life:
 * - Wire the /support/export route in AuthShell.tsx.
 * - Deploy.
 * - Send the user the URL. Privy's export modal reveals the key one time.
 * - Delete this file + the route after the user confirms extraction.
 *
 * Gated on ALLOWED_DID so no one else can trigger the flow.
 */
import { useState } from 'react';
import { useExportWallet } from '@privy-io/react-auth';
import { useAuthContext } from '../contexts/AuthContext';

// Bademosi Yele — stuck wallet 2026-07-11.
const ALLOWED_DID = 'did:privy:cmnj2730v02k90dldwj3daqoy';
const TARGET_ADDRESS = '0xAC72F84A45123613c36729e9C5E883D1F2c02Fc4';

export default function SupportExport() {
  const { user } = useAuthContext();
  const { exportWallet } = useExportWallet();
  const [error, setError] = useState<string | null>(null);

  const authorized = user?.privyDid === ALLOWED_DID;

  async function handleExport() {
    setError(null);
    try {
      await exportWallet({ address: TARGET_ADDRESS });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  }

  return (
    <div
      style={{
        maxWidth: 520,
        margin: '0 auto',
        padding: 'var(--space-6) var(--space-5)',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <h1 className="vela-heading-lg" style={{ marginBottom: 'var(--space-3)' }}>
        Export wallet key
      </h1>

      {!authorized ? (
        <div
          className="vela-card"
          style={{ padding: 'var(--space-5)', textAlign: 'center' }}
        >
          <p className="vela-body-sm vela-text-muted">
            This page is not available to your account.
          </p>
        </div>
      ) : (
        <div className="vela-card" style={{ padding: 'var(--space-5)' }}>
          <p className="vela-body-sm" style={{ marginBottom: 'var(--space-3)' }}>
            Wallet: <code>{TARGET_ADDRESS.slice(0, 6)}...{TARGET_ADDRESS.slice(-4)}</code>
          </p>
          <p
            className="vela-body-sm vela-text-muted"
            style={{ marginBottom: 'var(--space-4)', lineHeight: 1.6 }}
          >
            Click below to reveal the private key one time. Copy it directly
            into MetaMask&apos;s import screen. Anyone with this key can move
            the funds, so treat it like a password.
          </p>
          <button
            onClick={handleExport}
            className="vela-btn vela-btn-primary vela-btn-sm"
            style={{ width: '100%' }}
          >
            Reveal private key
          </button>
          {error && (
            <p
              className="vela-body-sm"
              style={{
                marginTop: 'var(--space-3)',
                color: 'var(--color-error)',
                textAlign: 'center',
              }}
            >
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
