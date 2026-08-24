/**
 * SupportExport — one-off support page to let a specific user export the
 * private key for a Vela-controlled Privy server wallet.
 *
 * Deployment life:
 * - Wire the /support/export route in AuthShell.tsx.
 * - Deploy.
 * - Send the URL to the user. Privy's export modal reveals the key one time.
 * - Delete this file + the route after the user confirms extraction.
 *
 * Gated on ALLOWED_DID so no one else can trigger the flow.
 *
 * 2026-08-24 — created for user `cmnage` who is stuck due to Hyperliquid
 * cumulative exchange-action rate limit. The Vela-owned server wallet holds
 * her funds; she needs the private key to place a manual taker trade on
 * HL native UI. Whether this works at all depends on Privy allowing the
 * client-side useExportWallet hook to authorize server wallets with no
 * owner_id — an open question this page is designed to answer.
 */
import { useState } from 'react';
import { useExportWallet } from '@privy-io/react-auth';
import { useAuthContext } from '../contexts/AuthContext';

const ALLOWED_DID = 'did:privy:cmnage16b01d30cl2ip76nlrx';
const TARGET_ADDRESS = '0x73b209F38f5EDEE329898D72f4b00c1FA458ed67';

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
