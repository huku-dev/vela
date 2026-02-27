/**
 * Privacy Policy — static legal page.
 * Accessible without login (outside OnboardingGate).
 * Content is placeholder — replace with lawyer-reviewed copy before production launch.
 */
export default function Privacy() {
  return (
    <div
      style={{
        maxWidth: 600,
        margin: '0 auto',
        padding: 'var(--space-6) var(--space-4)',
        paddingBottom: 'var(--space-20)',
      }}
    >
      <a
        href="/"
        className="vela-body-sm"
        style={{
          color: 'var(--color-text-muted)',
          textDecoration: 'none',
          display: 'inline-block',
          marginBottom: 'var(--space-6)',
        }}
      >
        &larr; Back to Vela
      </a>

      <h1 className="vela-heading-xl" style={{ marginBottom: 'var(--space-2)' }}>
        Privacy Policy
      </h1>
      <p className="vela-body-sm vela-text-muted" style={{ marginBottom: 'var(--space-8)' }}>
        Last updated: February 2026
      </p>

      <div className="vela-stack vela-stack-lg">
        <section>
          <h2 className="vela-heading-md" style={{ marginBottom: 'var(--space-2)' }}>
            1. Information We Collect
          </h2>
          <p className="vela-body-base vela-text-secondary">We collect the following data:</p>
          <ul
            className="vela-body-base vela-text-secondary"
            style={{
              paddingLeft: 'var(--space-5)',
              marginTop: 'var(--space-2)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
            }}
          >
            <li>
              <strong>Account information:</strong> Email address (provided during signup via Privy
              authentication).
            </li>
            <li>
              <strong>Wallet address:</strong> Your Ethereum wallet address, used to connect to
              trading services.
            </li>
            <li>
              <strong>Trading preferences:</strong> Your chosen trading mode, position size, stop
              loss settings, and notification preferences.
            </li>
            <li>
              <strong>Usage data:</strong> Pages visited, features used, and interaction patterns to
              improve the Service.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="vela-heading-md" style={{ marginBottom: 'var(--space-2)' }}>
            2. How We Use Your Data
          </h2>
          <ul
            className="vela-body-base vela-text-secondary"
            style={{
              paddingLeft: 'var(--space-5)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
            }}
          >
            <li>To provide and maintain the Service (signals, trade proposals, notifications).</li>
            <li>To process subscription payments via Stripe.</li>
            <li>To send trading alerts via email and Telegram (if enabled).</li>
            <li>To improve the Service based on usage patterns.</li>
            <li>To comply with legal obligations.</li>
          </ul>
        </section>

        <section>
          <h2 className="vela-heading-md" style={{ marginBottom: 'var(--space-2)' }}>
            3. Third-Party Services
          </h2>
          <p className="vela-body-base vela-text-secondary">
            Vela integrates with the following third-party services that may process your data:
          </p>
          <ul
            className="vela-body-base vela-text-secondary"
            style={{
              paddingLeft: 'var(--space-5)',
              marginTop: 'var(--space-2)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
            }}
          >
            <li>
              <strong>Privy</strong> — Authentication and wallet management.
            </li>
            <li>
              <strong>Supabase</strong> — Database and backend services (data stored securely with
              row-level security).
            </li>
            <li>
              <strong>Stripe</strong> — Payment processing for subscriptions.
            </li>
            <li>
              <strong>Hyperliquid</strong> — Trade execution on the exchange.
            </li>
            <li>
              <strong>CoinGecko</strong> — Market data and pricing information.
            </li>
            <li>
              <strong>Sentry</strong> — Error tracking and performance monitoring (no personal data
              sent).
            </li>
          </ul>
        </section>

        <section>
          <h2 className="vela-heading-md" style={{ marginBottom: 'var(--space-2)' }}>
            4. Data Storage &amp; Security
          </h2>
          <p className="vela-body-base vela-text-secondary">
            Your data is stored in Supabase (PostgreSQL) with row-level security policies that
            ensure users can only access their own data. All connections use TLS encryption. Wallet
            private keys are managed by Privy using Trusted Execution Environments (TEE) and are
            never accessible to Vela.
          </p>
        </section>

        <section>
          <h2 className="vela-heading-md" style={{ marginBottom: 'var(--space-2)' }}>
            5. Data Retention &amp; Deletion
          </h2>
          <p className="vela-body-base vela-text-secondary">
            You can delete your account at any time from the Account settings page. Account deletion
            is scheduled and completed within 30 days. Upon deletion, all personal data is removed.
            Anonymous, aggregated trading statistics may be retained.
          </p>
        </section>

        <section>
          <h2 className="vela-heading-md" style={{ marginBottom: 'var(--space-2)' }}>
            6. Cookies
          </h2>
          <p className="vela-body-base vela-text-secondary">
            Vela uses essential cookies for authentication (via Privy) and session management. We do
            not use advertising or tracking cookies. Third-party services (Google Fonts) may set
            their own cookies.
          </p>
        </section>

        <section>
          <h2 className="vela-heading-md" style={{ marginBottom: 'var(--space-2)' }}>
            7. We Do Not Sell Your Data
          </h2>
          <p
            className="vela-body-base"
            style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}
          >
            Vela does not sell, rent, or share your personal data with third parties for marketing
            purposes. Period.
          </p>
        </section>

        <section>
          <h2 className="vela-heading-md" style={{ marginBottom: 'var(--space-2)' }}>
            8. Your Rights
          </h2>
          <p className="vela-body-base vela-text-secondary">You have the right to:</p>
          <ul
            className="vela-body-base vela-text-secondary"
            style={{
              paddingLeft: 'var(--space-5)',
              marginTop: 'var(--space-2)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
            }}
          >
            <li>Access the personal data we hold about you.</li>
            <li>Request correction of inaccurate data.</li>
            <li>Request deletion of your data (via Account settings).</li>
            <li>Withdraw consent for optional data processing (e.g., notifications).</li>
          </ul>
        </section>

        <section>
          <h2 className="vela-heading-md" style={{ marginBottom: 'var(--space-2)' }}>
            9. Contact
          </h2>
          <p className="vela-body-base vela-text-secondary">
            Questions about your privacy? Contact us at{' '}
            <a
              href="mailto:privacy@vela.trade"
              style={{ color: 'var(--color-text-secondary)', textDecoration: 'underline' }}
            >
              privacy@vela.trade
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
