// src/pages/AdminDashboard.tsx
//
// Live business dashboard. Gated by an allowlist of privy_did values, both
// client-side (this file) and server-side (edge fn). Server-side is the real
// enforcement boundary — the client-side gate is UX polish so non-admins get
// bounced instead of seeing a 404 flash.
//
// Data comes from one call to the admin-dashboard-data edge fn. Sections read
// their slices from that response. Curated sections (highlights, notes) are
// deferred; the GSC / Shipped-this-week panels are deferred pending a Deno
// service-account JWT implementation.
//
// Design tweaks: src/styles/admin-dashboard.css
// Section layout: rearrange the components below.
// New section: add a query in the backend + a component in AdminSections.tsx.

import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import { useAuthContext } from '../contexts/AuthContext';
import type { DashboardResponse } from '../lib/adminDashboardClient';
import { fetchAdminDashboard } from '../lib/adminDashboardClient';
import { FIXTURE_DASHBOARD } from '../lib/adminDashboardFixtures';
import {
  AssetScoreboardSection,
  CarryoverSection,
  ChartsSection,
  CohortFunnelSection,
  HighlightsSection,
  KpisSection,
  LlmCostSection,
  MonthlyReturnsSection,
  NotesSection,
  OpenPositionsSection,
  PositionConcentrationSection,
  RevenueBreakdownSection,
  ShippedSection,
  SubscriptionRisksSection,
  TraderCumulativePnlSection,
  UserOverviewSection,
  VelocitySection,
} from '../components/admin/AdminSections';
import PageLoader from '../components/PageLoader';
import '../styles/admin-dashboard.css';

// Hardcoded allowlist. Same value as server-side ADMIN_DASHBOARD_ALLOWLIST.
// Two-source-of-truth is deliberate: the server is the enforcement boundary,
// the client is UX. Migrate to profiles.is_admin when we have a second admin.
const ADMIN_PRIVY_DIDS = new Set<string>(['did:privy:cmlwg3b6n04xk0dl7g2ufaw8z']);

// Max time to wait for the Supabase token exchange after Privy authenticates.
// If exchange doesn't complete in this window (network failure, expired Privy
// token, 500 from auth-exchange), we surface an error UI instead of spinning
// forever. Value is intentionally generous — normal exchange is <2s.
const TOKEN_EXCHANGE_TIMEOUT_MS = 12_000;

export default function AdminDashboard() {
  const { isAuthenticated, isLoading, user, getToken, logout } = useAuthContext();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  // Fixtures is a DEV-only design-iteration toggle. In prod builds the param
  // is ignored and the real fetch runs, so a public visitor can never render
  // the dashboard by tacking ?fixtures=1 onto the URL.
  const useFixtures = import.meta.env.DEV && params.get('fixtures') === '1';

  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exchangeTimedOut, setExchangeTimedOut] = useState(false);

  // Auth gate has three states:
  //   1. Privy is still initializing (isLoading true) → show loader.
  //   2. Privy resolved, user is not signed in → bounce to /login.
  //   3. Privy resolved, signed in, waiting for token exchange (user null) → loader.
  //   4. Fully signed in → check allowlist; bounce non-admins to /.
  // Server-side allowlist is the real enforcement boundary; this gate is UX.
  const isSignedIn = !isLoading && isAuthenticated;
  const userLoaded = isSignedIn && !!user;
  const isAdmin = userLoaded && ADMIN_PRIVY_DIDS.has(user!.privyDid);

  // Detect token-exchange stall. If Privy reports authenticated but the
  // Supabase JWT never lands (fetch fail, 500, expired Privy token), user
  // stays null forever. Surface as an error instead of an infinite spinner.
  useEffect(() => {
    if (!isSignedIn || userLoaded) {
      setExchangeTimedOut(false);
      return;
    }
    const t = window.setTimeout(() => {
      setExchangeTimedOut(true);
    }, TOKEN_EXCHANGE_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [isSignedIn, userLoaded]);

  // Session Replay is configured globally with maskAllText: false. This page
  // renders every user's balance and PnL in the DOM, so we pause replay on
  // mount. Deliberately do NOT restart on unmount — main.tsx uses
  // replaysSessionSampleRate: 0.1, so most sessions run in buffer mode; a
  // blanket .start() would force-enable full-session recording that the
  // sample rate had excluded. Tradeoff: no replay for the rest of this
  // page-load once the admin visits /admin. Next page-load re-samples.
  useEffect(() => {
    const replay = Sentry.getReplay?.();
    if (!replay) return;
    try {
      replay.stop();
    } catch {
      // Replay not initialized (e.g. DEV, no DSN) — no-op.
    }
  }, []);

  useEffect(() => {
    // Don't fire until we know the caller is an admin (userLoaded + allowlist
    // match). Prevents a null-token fetch during the auth-exchange window
    // and prevents wasted fetches from a non-admin who's about to be
    // redirected.
    if (!isAdmin) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (useFixtures) {
          if (!cancelled) setData(FIXTURE_DASHBOARD);
          return;
        }
        const payload = await fetchAdminDashboard(getToken);
        if (!cancelled) setData(payload);
      } catch (err) {
        console.error('[admin-dashboard]', err);
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, getToken, useFixtures]);

  if (isLoading) return <PageLoader />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!user) {
    if (exchangeTimedOut) return <ExchangeStalledError onLogout={logout} />;
    return <PageLoader />;
  }
  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="admin-dash">
      <h1>Vela Business Dashboard</h1>
      <p className="ad-subtitle">
        Live snapshot{data ? ` as of ${formatWhen(data.generatedAt)}` : ''}. Data from Supabase.
        {useFixtures && ' (fixtures mode)'}
      </p>

      {loading && <PageLoader />}
      {error && <div className="ad-error">Failed to load dashboard: {error}</div>}

      {data && (
        <>
          <KpisSection kpis={data.kpis} />

          <HighlightsSection items={data.curated.highlights} />
          <ShippedSection github={data.github} />
          <VelocitySection github={data.github} />

          <RevenueBreakdownSection rows={data.revenueBreakdown} mrr={data.kpis.mrr} />
          {data.subscriptionRisks && <SubscriptionRisksSection risks={data.subscriptionRisks} />}
          {data.llmCosts && <LlmCostSection data={data.llmCosts} />}
          <CohortFunnelSection rows={data.cohortFunnel} />
          {/* Daily platform PnL bar chart. Kept alongside the per-trader
              cumulative view because they answer different questions: the
              bars show "did the platform net win or lose that day", the
              cumulative view shows "who's up, who's down, who's improving". */}
          <ChartsSection
            pnlSeries7d={data.pnlSeries7d}
            pnlSeries30d={data.pnlSeries30d}
            pnlSeries90d={data.pnlSeries90d}
          />
          {/* Monthly returns table: platform-level summary of return on capital
              traded, month by month with year-over-year rows. Sits above the
              per-trader breakdown so the highest-altitude view comes first. */}
          {data.monthlyReturns && <MonthlyReturnsSection data={data.monthlyReturns} />}
          {data.traderCumulativePnl30d && (
            <TraderCumulativePnlSection
              rows={data.traderCumulativePnl30d}
              totalUsers={data.kpis.totalUsers}
            />
          )}
          {data.assetScoreboard30d && <AssetScoreboardSection rows={data.assetScoreboard30d} />}
          <UserOverviewSection rows={data.userOverview} />
          <PositionConcentrationSection rows={data.positionConcentration} />
          <OpenPositionsSection rows={data.openPositions} />

          <CarryoverSection
            nextUp={data.curated.carryoverNextUp ?? data.curated.carryoverInProgress ?? []}
            needsAttention={
              data.curated.carryoverNeedsAttention ?? data.curated.carryoverNeedsStatus ?? []
            }
          />
          <NotesSection notes={data.curated.notes} />

          <p className="ad-timestamp">Generated: {data ? formatFullWhen(data.generatedAt) : '-'}</p>
        </>
      )}
    </div>
  );
}

/**
 * Shown when Privy authenticates but the Supabase token exchange never
 * completes (network, 500, expired Privy session). Offers a sign-out + retry
 * so the user isn't stuck on an infinite spinner.
 */
function ExchangeStalledError({ onLogout }: { onLogout: () => Promise<void> }) {
  return (
    <div className="admin-dash">
      <h1>Vela Business Dashboard</h1>
      <div className="ad-error" style={{ marginTop: 24 }}>
        Signed in, but couldn&rsquo;t sync your session with Supabase. Sign out and back in to
        retry.
        <div style={{ marginTop: 12 }}>
          <button
            onClick={() => {
              void onLogout();
            }}
            style={{
              padding: '6px 14px',
              background: 'var(--ad-red-dark)',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} · ${time}`;
}

function formatFullWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
