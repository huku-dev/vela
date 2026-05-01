import { useEffect, useMemo, useState } from 'react';
import { useTrading } from './useTrading';
import type { TradeProposal } from '../types';

/** Banner urgency tiers. 'neutral' is reserved for view_only mode (no countdown). */
export type BannerUrgency = 'normal' | 'urgent' | 'critical' | 'neutral';

export interface PendingBannerState {
  /** Number of pending proposals. */
  count: number;
  /** Primary label rendered in the banner. */
  label: string;
  /** Pre-formatted countdown ("1h 04m" / "47m" / "9m 12s"), or null for view_only. */
  countdownText: string | null;
  /** Visual urgency tier. */
  urgency: BannerUrgency;
}

/**
 * Returns banner state for the global pending-proposals banner, or null when
 * the banner should not render (no pending proposals, full_auto user, or
 * preferences not yet loaded).
 *
 * Tick rate is automatic: 1s when the soonest proposal is in the last 10
 * minutes (sec-by-sec countdown), 60s otherwise.
 */
export function usePendingProposalsCountdown(): PendingBannerState | null {
  const { proposals, preferences } = useTrading();

  // Tick state — increments on every interval tick to force re-render so
  // `Date.now()` re-evaluates against current proposals.
  const [, setTickKey] = useState(0);

  // Filter to proposals that are pending AND not yet expired. expires_at is
  // a Postgres timestamptz (UTC ISO) so Date.parse is unambiguous. We
  // re-evaluate this every render so a proposal whose expires_at passes
  // between ticks falls out of the list immediately on the next render
  // rather than rendering "expired" or "0m 00s".
  const now = Date.now();
  const pending = useMemo(
    () =>
      proposals.filter(
        p => p.status === 'pending' && new Date(p.expires_at).getTime() > now
      ),
    [proposals, now]
  );

  const soonest = useMemo<TradeProposal | null>(() => {
    if (pending.length === 0) return null;
    return [...pending].sort(
      (a, b) =>
        new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime()
    )[0];
  }, [pending]);

  const soonestMs = soonest ? new Date(soonest.expires_at).getTime() : 0;
  const msUntilSoonest = soonestMs - now;

  // Cadence: pre-emptively switch to 1s for the last 11 minutes, not 10.
  // The +1m buffer means we never sit on a stale 60s tick inside the
  // critical zone (would otherwise show stale countdown for up to 59s
  // after crossing the boundary).
  const useFastTick = soonest !== null && msUntilSoonest <= 11 * 60_000;

  useEffect(() => {
    if (!soonest) return;
    const interval = useFastTick ? 1_000 : 60_000;
    const id = window.setInterval(() => setTickKey(k => k + 1), interval);
    return () => window.clearInterval(id);
  }, [soonest, useFastTick]);

  // Suppress for users who can't act, or who don't need to.
  // full_auto: proposals auto-execute, banner adds no value.
  // preferences === null: still loading, render nothing rather than flash.
  if (!preferences) return null;
  if (preferences.mode === 'full_auto') return null;
  if (pending.length === 0 || !soonest) return null;

  // ── view_only branch: no countdown, neutral copy ──────────────────────
  if (preferences.mode === 'view_only') {
    const word = pending.length === 1 ? 'signal' : 'signals';
    return {
      count: pending.length,
      label: `${pending.length} ${word} pending review`,
      countdownText: null,
      urgency: 'neutral',
    };
  }

  // ── semi_auto branch: full urgency ladder ─────────────────────────────
  const urgency: BannerUrgency =
    msUntilSoonest <= 10 * 60_000
      ? 'critical'
      : msUntilSoonest <= 60 * 60_000
        ? 'urgent'
        : 'normal';

  const countdownText = formatCountdown(msUntilSoonest);

  let label: string;
  if (pending.length === 1) {
    // asset_id is the lowercase ticker; uppercase matches assets.symbol exactly.
    // side is uppercased for consistency with TradeProposalCard / failure-toast
    // copy elsewhere in the app ("AAPL LONG", "GOLD SHORT").
    label = `${soonest.asset_id.toUpperCase()} · ${soonest.side.toUpperCase()} pending`;
  } else {
    label = `${pending.length} trades pending`;
  }

  return { count: pending.length, label, countdownText, urgency };
}

/**
 * Format milliseconds remaining as a human countdown.
 * - > 60m: "Xh YYm" (e.g. "2h 41m"), zero-padded minutes
 * - 1m–60m: "Mm" (e.g. "47m")
 * - < 1m: "Mm SSs" with seconds (e.g. "0m 47s")
 * - <= 0: "expired" (caller should typically have filtered already)
 */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'expired';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  // Critical: <= 10 minutes → show seconds for live ticking
  if (totalSeconds <= 10 * 60) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  // Urgent: < 60 minutes → minutes only
  if (hours === 0) {
    return `${minutes}m`;
  }
  // Normal: hours + zero-padded minutes
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}
