/**
 * Terms of Service — static legal page.
 * Accessible without login (outside OnboardingGate).
 * Content is placeholder — replace with lawyer-reviewed copy before production launch.
 */
export default function Terms() {
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
        Terms of Service
      </h1>
      <p className="vela-body-sm vela-text-muted" style={{ marginBottom: 'var(--space-8)' }}>
        Last updated: February 2026
      </p>

      <div className="vela-stack vela-stack-lg">
        <section>
          <h2 className="vela-heading-md" style={{ marginBottom: 'var(--space-2)' }}>
            1. Acceptance of Terms
          </h2>
          <p className="vela-body-base vela-text-secondary">
            By accessing or using Vela (&quot;the Service&quot;), you agree to be bound by these
            Terms of Service. If you do not agree, do not use the Service. You must be at least 18
            years old to use Vela.
          </p>
        </section>

        <section>
          <h2 className="vela-heading-md" style={{ marginBottom: 'var(--space-2)' }}>
            2. Description of Service
          </h2>
          <p className="vela-body-base vela-text-secondary">
            Vela is a crypto market intelligence platform that monitors cryptocurrency markets and
            surfaces trading signals. Vela provides analysis, not financial advice. All signals and
            recommendations are informational and should not be treated as investment advice.
          </p>
        </section>

        <section>
          <h2 className="vela-heading-md" style={{ marginBottom: 'var(--space-2)' }}>
            3. Not Financial Advice
          </h2>
          <p
            className="vela-body-base"
            style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}
          >
            Vela does not provide financial, investment, legal, or tax advice. All content, signals,
            and analysis provided through the Service are for informational purposes only.
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
            <li>Past performance does not guarantee future results.</li>
            <li>
              Cryptocurrency markets are highly volatile and you may lose some or all of your
              investment.
            </li>
            <li>
              You should consult a qualified financial advisor before making trading decisions.
            </li>
            <li>
              Paper trading results are simulated and may not reflect actual trading performance.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="vela-heading-md" style={{ marginBottom: 'var(--space-2)' }}>
            4. User Responsibility
          </h2>
          <p className="vela-body-base vela-text-secondary">
            You are solely responsible for your trading decisions. Vela presents opportunities and
            analysis, but you approve every trade. Vela never auto-trades without your explicit
            consent and configuration.
          </p>
        </section>

        <section>
          <h2 className="vela-heading-md" style={{ marginBottom: 'var(--space-2)' }}>
            5. Account &amp; Security
          </h2>
          <p className="vela-body-base vela-text-secondary">
            You are responsible for maintaining the security of your account credentials and wallet
            private keys. Vela is not responsible for unauthorized access to your account. You agree
            to notify us immediately of any unauthorized use.
          </p>
        </section>

        <section>
          <h2 className="vela-heading-md" style={{ marginBottom: 'var(--space-2)' }}>
            6. Subscription &amp; Payments
          </h2>
          <p className="vela-body-base vela-text-secondary">
            Paid subscriptions are billed monthly or annually through Stripe. You may cancel at any
            time through your account settings. Refunds are handled on a case-by-case basis. Trade
            fees are charged as a percentage of each executed trade and are non-refundable.
          </p>
        </section>

        <section>
          <h2 className="vela-heading-md" style={{ marginBottom: 'var(--space-2)' }}>
            7. Limitation of Liability
          </h2>
          <p className="vela-body-base vela-text-secondary">
            To the maximum extent permitted by law, Vela and its operators shall not be liable for
            any indirect, incidental, special, consequential, or punitive damages, including but not
            limited to loss of profits, data, or trading losses, arising from your use of the
            Service.
          </p>
        </section>

        <section>
          <h2 className="vela-heading-md" style={{ marginBottom: 'var(--space-2)' }}>
            8. Modifications
          </h2>
          <p className="vela-body-base vela-text-secondary">
            We reserve the right to modify these Terms at any time. Material changes will be
            communicated via email or in-app notification. Continued use of the Service after
            changes constitutes acceptance.
          </p>
        </section>

        <section>
          <h2 className="vela-heading-md" style={{ marginBottom: 'var(--space-2)' }}>
            9. Contact
          </h2>
          <p className="vela-body-base vela-text-secondary">
            Questions about these Terms? Contact us at{' '}
            <a
              href="mailto:support@vela.trade"
              style={{ color: 'var(--color-text-secondary)', textDecoration: 'underline' }}
            >
              support@vela.trade
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
