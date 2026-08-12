import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * EmailUnsubscribe — confirmation page ("Are you sure?") for one-click
 * marketing-email unsubscribe. Public route (no auth). Rendered when the
 * email-unsubscribe edge function redirects here after HMAC verification.
 *
 * Flow:
 *   1. User clicks Unsubscribe link in an email footer.
 *   2. Edge function verifies HMAC (GET-safe, no DB mutation) → 302 here
 *      with u/s/e/t query params intact.
 *   3. This page renders "Are you sure?" with a POST form that submits
 *      the same params back to the edge function.
 *   4. Edge function verifies HMAC again, flips the flag, redirects to
 *      /email/unsubscribed?type=<scope>.
 *
 * If the edge function couldn't verify the link, it redirects here with
 * ?error=<code> instead of the token params — we show a friendly message.
 */

type Scope = 'daily_brief' | 'weekly_recap';

const SCOPE_LABEL: Record<Scope, string> = {
  daily_brief: 'daily brief',
  weekly_recap: 'weekly recap',
};

const ERROR_COPY: Record<string, { title: string; body: string }> = {
  malformed: {
    title: 'Link is no longer valid',
    body: 'This unsubscribe link is missing information or is malformed. You can manage your email preferences directly in your account settings.',
  },
  expired: {
    title: 'Link has expired',
    body: 'This unsubscribe link could not be verified — it may have expired or been altered. You can manage your email preferences directly in your account settings.',
  },
  server: {
    title: 'Something went wrong',
    body: 'We could not process your request. Please try again in a moment, or manage your email preferences directly in your account settings.',
  },
};

function getEdgeUnsubscribeUrl(): string {
  // Same origin as the edge function that sent us here — resolved from Vite env.
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (supabaseUrl) return `${supabaseUrl}/functions/v1/email-unsubscribe`;
  // Fallback: prod URL. Staging users authenticated via the staging edge
  // function will already be on staging URLs at this point.
  return 'https://dikybxkubbaabnshnreh.supabase.co/functions/v1/email-unsubscribe';
}

export default function EmailUnsubscribe() {
  const [params] = useSearchParams();
  const [submitting, setSubmitting] = useState(false);

  const errorCode = params.get('error');
  const scopeRaw = params.get('s');
  const scope: Scope | null =
    scopeRaw === 'daily_brief' || scopeRaw === 'weekly_recap' ? scopeRaw : null;

  const label = scope ? SCOPE_LABEL[scope] : 'this list';

  // Build the POST-back URL preserving the four token params. Only rendered
  // when the edge function passed us a well-formed signed link (all four
  // params present) — an error page path never renders the form.
  const postUrl = useMemo(() => {
    const u = params.get('u');
    const s = params.get('s');
    const e = params.get('e');
    const t = params.get('t');
    if (!u || !s || !e || !t) return null;
    const qs = new URLSearchParams({ u, s, e, t });
    return `${getEdgeUnsubscribeUrl()}?${qs.toString()}`;
  }, [params]);

  const errorCopy = errorCode ? ERROR_COPY[errorCode] ?? ERROR_COPY.expired : null;

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
        {errorCopy ? (
          <>
            <h1
              className="vela-heading-md"
              style={{ margin: 0, marginBottom: 'var(--space-2)' }}
            >
              {errorCopy.title}
            </h1>
            <p
              className="vela-body-sm vela-text-muted"
              style={{ margin: 0, marginBottom: 'var(--space-5)' }}
            >
              {errorCopy.body}
            </p>
            <a
              href="/account"
              className="vela-btn vela-btn-primary"
              style={{ textDecoration: 'none', display: 'inline-block' }}
            >
              Open account settings
            </a>
          </>
        ) : postUrl ? (
          <>
            <h1
              className="vela-heading-md"
              style={{ margin: 0, marginBottom: 'var(--space-2)' }}
            >
              Unsubscribe from Vela&rsquo;s {label}?
            </h1>
            <p
              className="vela-body-sm vela-text-muted"
              style={{ margin: 0, marginBottom: 'var(--space-5)' }}
            >
              You&rsquo;ll stop receiving Vela&rsquo;s {label}. Signal alerts, trade
              proposals, and account emails will keep coming as normal.
            </p>
            <form method="POST" action={postUrl} style={{ display: 'block' }}>
              <button
                type="submit"
                disabled={submitting}
                onClick={() => setSubmitting(true)}
                className="vela-btn vela-btn-primary"
                style={{
                  display: 'inline-block',
                  marginBottom: 'var(--space-2)',
                  minWidth: 200,
                  cursor: submitting ? 'wait' : 'pointer',
                }}
              >
                {submitting ? 'Unsubscribing…' : 'Yes, unsubscribe'}
              </button>
            </form>
            <a
              href="/account"
              className="vela-body-sm"
              style={{
                color: 'var(--color-text-muted, #666)',
                textDecoration: 'underline',
              }}
            >
              Cancel
            </a>
          </>
        ) : (
          <>
            <h1
              className="vela-heading-md"
              style={{ margin: 0, marginBottom: 'var(--space-2)' }}
            >
              Link is no longer valid
            </h1>
            <p
              className="vela-body-sm vela-text-muted"
              style={{ margin: 0, marginBottom: 'var(--space-5)' }}
            >
              This unsubscribe link is missing information. You can manage
              your email preferences directly in your account settings.
            </p>
            <a
              href="/account"
              className="vela-btn vela-btn-primary"
              style={{ textDecoration: 'none', display: 'inline-block' }}
            >
              Open account settings
            </a>
          </>
        )}
      </div>
    </div>
  );
}
