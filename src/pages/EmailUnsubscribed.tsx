import { useSearchParams } from 'react-router-dom';

/**
 * EmailUnsubscribed — success page shown after the email-unsubscribe edge
 * function flips the flag. Public route (no auth). The `type` query param
 * reflects which marketing stream was unsubscribed so we can tailor the copy.
 */

type Scope = 'daily_brief' | 'weekly_recap';

const SCOPE_LABEL: Record<Scope, string> = {
  daily_brief: 'daily brief',
  weekly_recap: 'weekly recap',
};

export default function EmailUnsubscribed() {
  const [params] = useSearchParams();
  const typeRaw = params.get('type');
  const scope: Scope | null =
    typeRaw === 'daily_brief' || typeRaw === 'weekly_recap' ? typeRaw : null;
  const label = scope ? SCOPE_LABEL[scope] : 'that email';

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--color-bg, #F0EDE8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-4)',
      }}
    >
      <div
        style={{
          maxWidth: 480,
          width: '100%',
          background: 'var(--color-surface, #FFFBF5)',
          border: '3px solid var(--black, #0A0A0A)',
          borderRadius: 6,
          padding: 'var(--space-6) var(--space-5)',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            background: 'var(--green-primary, #0FE68C)',
            border: '2px solid var(--black, #0A0A0A)',
            borderRadius: '50%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: 20,
            marginBottom: 'var(--space-3)',
          }}
          aria-hidden="true"
        >
          ✓
        </div>
        <h1
          className="vela-heading-md"
          style={{ margin: 0, marginBottom: 'var(--space-2)' }}
        >
          You&rsquo;ve been unsubscribed
        </h1>
        <p
          className="vela-body-sm vela-text-muted"
          style={{ margin: 0, marginBottom: 'var(--space-5)' }}
        >
          No more {label}s from Vela. Signal alerts, trade proposals, and
          account emails will keep coming as normal.
        </p>
        <a
          href="/account"
          className="vela-btn vela-btn-primary"
          style={{ textDecoration: 'none', display: 'inline-block' }}
        >
          Manage all email preferences
        </a>
      </div>
    </div>
  );
}
