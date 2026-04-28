// src/components/MergedSignalCard.tsx
//
// Merged Signal + WPS card for asset-detail-v2.
//
// Replaces the legacy "Tier 1 Key Signal" + "Where Price Stands" pair on
// the asset detail page. Single card with:
//   1. Signal pill (top, color-coded with diamond dot)
//   2. Verdict line (Space Grotesk, position-aware lede)
//   3. Reason paragraph (signal_explanation_plain from Phase 1, or fallback)
//   4. 3-up stats row (Last 24H / Last 7D / 7D Range)
//   5. "What would change" paragraph with named price levels
//   6. "View signal history" footer link (subtle dotted underline)
//
// Voice rules (locked, see docs/product-briefs/asset-detail-v2.md):
//   - No em dashes
//   - Buy / Short / Wait (never green / red / amber)
//   - Direction-neutral framing
//   - Excitement attaches to user's P&L, not market direction

import React, { useEffect, useState } from 'react';
import { Card } from './VelaComponents';
import { plainEnglish, parsePriceSegments } from '../lib/helpers';

type SignalColor = 'green' | 'red' | 'grey';

interface AssetPositionLite {
  side: 'long' | 'short';
  entry_price: number;
  current_price?: number | null;
  unrealized_pnl_pct?: number | null;
}

interface BriefLite {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  detail?: any;
  summary?: string;
  headline?: string;
}

interface MergedSignalCardProps {
  signalColor: SignalColor;
  nearConfirmation?: boolean;
  assetName: string;
  hlSymbol: string;
  price: number | null | undefined;
  change24h: number | null | undefined;
  brief: BriefLite | null | undefined;
  position?: AssetPositionLite;
  /** Number of signal-color changes in the past 30 days. Footer renders
   * "View signal history (N changes in 30 days)" when N >= 1. */
  historyCount?: number;
  onHistoryClick?: () => void;
  /** Indicators block from `brief.detail.indicators` (or top-level signal
   * row) used as the fallback source for "what would change" when the
   * brief doesn't carry it explicitly. */
  indicators?: {
    ema_9: number;
    ema_21: number;
    sma_50_daily: number;
  };
}

export default function MergedSignalCard({
  signalColor,
  nearConfirmation,
  assetName,
  hlSymbol,
  price,
  change24h,
  brief,
  position,
  historyCount = 0,
  onHistoryClick,
  indicators,
}: MergedSignalCardProps) {
  const [range7d, setRange7d] = useState<{ high: number; low: number } | null>(null);
  const [change7d, setChange7d] = useState<number | null>(null);

  useEffect(() => {
    if (!hlSymbol || !price) return;
    let cancelled = false;
    fetch7dRange(hlSymbol).then(r => {
      if (cancelled || !r) return;
      const midRange = (r.high + r.low) / 2;
      if (price > 0 && midRange > 0 && Math.abs(price - midRange) / price < 5) {
        setRange7d(r);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [hlSymbol, price]);

  useEffect(() => {
    if (!hlSymbol || !price) return;
    let cancelled = false;
    (async () => {
      try {
        const now = Date.now();
        const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
        const res = await fetch('https://api.hyperliquid.xyz/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'candleSnapshot',
            req: { coin: hlSymbol, interval: '1d', startTime: sevenDaysAgo, endTime: now },
          }),
        });
        if (cancelled || !res.ok) return;
        const candles = await res.json();
        if (cancelled) return;
        if (Array.isArray(candles) && candles.length > 0) {
          const openPrice = parseFloat(candles[0].o);
          if (openPrice > 0) {
            const pct = ((price - openPrice) / openPrice) * 100;
            if (Math.abs(pct) < 1000) setChange7d(pct);
          }
        }
      } catch {
        /* silent */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hlSymbol, price]);

  const verdictText = buildVerdict(signalColor, assetName, position);
  const reasonText = buildReason(brief);
  const wwcText: string =
    brief?.detail?.what_would_change ||
    (indicators && price != null ? buildWhatWouldChangeFallback(indicators, price) : '');

  return (
    <Card style={{ marginBottom: 'var(--space-4)' }}>
      <SignalPill color={signalColor} nearConfirmation={nearConfirmation} />

      <div
        style={{
          fontFamily: "'Space Grotesk', system-ui, sans-serif",
          fontSize: 'var(--text-lg)',
          fontWeight: 700,
          lineHeight: 'var(--leading-snug)',
          letterSpacing: '-0.02em',
          color: 'var(--color-text-primary)',
          marginBottom: 'var(--space-2)',
        }}
      >
        {verdictText}
      </div>

      {reasonText && (
        <p
          style={{
            fontSize: 'var(--text-sm)',
            lineHeight: 1.55,
            color: 'var(--color-text-secondary)',
            marginBottom: 'var(--space-4)',
          }}
        >
          {reasonText}
        </p>
      )}

      <StatsRow change24h={change24h} change7d={change7d} range7d={range7d} />

      {wwcText && (
        <p
          className="vela-body-sm"
          style={{
            color: 'var(--color-text-secondary)',
            lineHeight: 1.6,
            borderTop: '1px solid var(--gray-200)',
            paddingTop: 'var(--space-3)',
            marginTop: 'var(--space-3)',
          }}
        >
          {parsePriceSegments(plainEnglish(wwcText)).map((seg, i) =>
            seg.type === 'price' ? (
              <strong key={i} className="vela-mono" style={{ fontWeight: 600 }}>
                {seg.value}
              </strong>
            ) : (
              <React.Fragment key={i}>{seg.value}</React.Fragment>
            )
          )}
        </p>
      )}

      {historyCount >= 1 && onHistoryClick && (
        // Wrapper holds the divider so the inner <button>'s `border:none`
        // reset can't wipe it. The earlier impl set borderTop on the button
        // and then `border: none` later in the same style block, which
        // overrode the borderTop and dropped the divider entirely.
        <div
          style={{
            marginTop: 'var(--space-3)',
            paddingTop: 'var(--space-3)',
            borderTop: '1px solid var(--gray-200)',
          }}
        >
          <button
            type="button"
            onClick={onHistoryClick}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontSize: 'var(--text-xs)',
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              textAlign: 'left',
            }}
          >
            <span
              style={{
                textDecoration: 'underline',
                textDecorationColor: 'var(--gray-300)',
                textUnderlineOffset: '3px',
              }}
            >
              View signal history ({historyCount} change{historyCount === 1 ? '' : 's'} in 30 days)
            </span>
            <span
              style={{
                fontFamily: "'Space Grotesk', system-ui, sans-serif",
                color: 'var(--color-text-secondary)',
                fontWeight: 700,
              }}
            >
              ›
            </span>
          </button>
        </div>
      )}
    </Card>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function SignalPill({
  color,
  nearConfirmation,
}: {
  color: SignalColor;
  nearConfirmation?: boolean;
}) {
  const palette =
    color === 'green'
      ? { bg: 'var(--green-light)', text: 'var(--green-dark)', dot: 'var(--color-signal-buy)' }
      : color === 'red'
        ? { bg: 'var(--red-light)', text: 'var(--red-dark)', dot: 'var(--color-signal-sell)' }
        : { bg: 'var(--amber-light)', text: 'var(--amber-dark)', dot: 'var(--color-signal-wait)' };
  const label = color === 'green' ? 'Buy' : color === 'red' ? 'Short' : 'Wait';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        padding: '2px var(--space-2)',
        border: 'var(--border-medium) solid var(--color-border-default)',
        borderRadius: 'var(--radius-sm)',
        fontFamily: "'Inter', system-ui, sans-serif",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        marginBottom: 'var(--space-3)',
        background: palette.bg,
        color: palette.text,
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          transform: 'rotate(45deg)',
          background: palette.dot,
        }}
      />
      {label}
      {nearConfirmation ? ' (forming)' : ''}
    </span>
  );
}

function StatsRow({
  change24h,
  change7d,
  range7d,
}: {
  change24h: number | null | undefined;
  change7d: number | null;
  range7d: { high: number; low: number } | null;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--space-2)',
        marginBottom: 'var(--space-3)',
      }}
    >
      <Stat label="Last 24H" value={change24h} kind="pct" />
      <Stat label="Last 7D" value={change7d} kind="pct" />
      <Stat
        label="7D range"
        value={range7d ? `${compactPrice(range7d.low)}–${compactPrice(range7d.high)}` : null}
        kind="range"
      />
    </div>
  );
}

function Stat({
  label,
  value,
  kind,
}: {
  label: string;
  value: number | string | null | undefined;
  kind: 'pct' | 'range';
}) {
  const color =
    kind === 'pct' && typeof value === 'number'
      ? value >= 0
        ? 'var(--green-dark)'
        : 'var(--red-dark)'
      : 'var(--color-text-primary)';
  const display =
    value == null
      ? '-'
      : kind === 'pct' && typeof value === 'number'
        ? `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
        : (value as string);

  return (
    <div
      style={{
        flex: 1,
        padding: 'var(--space-2)',
        background: 'var(--gray-50)',
        borderRadius: 'var(--radius-sm)',
        textAlign: 'center',
      }}
    >
      <span
        style={{
          display: 'block',
          fontSize: 10,
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          marginBottom: 2,
        }}
      >
        {label}
      </span>
      <span
        className="vela-mono"
        style={{
          fontWeight: 700,
          fontSize: 14,
          color,
          whiteSpace: 'nowrap',
        }}
      >
        {display}
      </span>
    </div>
  );
}

// ── Pure helpers ──────────────────────────────────────────────────────

function buildVerdict(
  signalColor: SignalColor,
  assetName: string,
  position?: AssetPositionLite
): string {
  if (position) {
    const pct = position.unrealized_pnl_pct ?? 0;
    const direction = position.side === 'long' ? 'long' : 'short';
    const verb = pct >= 0 ? 'up' : 'down';
    return `Your ${direction} is ${verb} ${Math.abs(pct).toFixed(1)}%.`;
  }
  const action = signalColor === 'green' ? 'Buy' : signalColor === 'red' ? 'Short' : 'Wait';
  return `Vela has flipped ${assetName} to ${action}.`;
}

function buildReason(brief: BriefLite | null | undefined): string {
  if (!brief) return '';
  // Phase 1 backend writes the 3-sentence "why the flip" copy here.
  const explanation = brief.detail?.signal_explanation_plain;
  if (typeof explanation === 'string' && explanation.trim().length > 0) {
    return explanation.trim();
  }
  // Fallback to existing brief summary while signal_explanation propagates
  // through running assets. Strips any leading asset-name prefix (matches
  // legacy behavior on the live page).
  return (brief.summary ?? '').trim();
}

function buildWhatWouldChangeFallback(
  indicators: { ema_9: number; ema_21: number; sma_50_daily: number },
  price: number
): string {
  // Plain-English fallback when brief.detail.what_would_change is missing.
  // Mirrors the spec's bidirectional framing without naming RSI/EMA.
  const sma = indicators.sma_50_daily;
  const ema21 = indicators.ema_21;
  const upLevel = Math.max(price * 1.04, ema21 * 1.02);
  const downLevel = Math.min(price * 0.96, sma * 0.98);
  return `If price drops below $${formatLevel(downLevel)}, the setup gets weaker. If it pushes above $${formatLevel(upLevel)}, the move strengthens.`;
}

function formatLevel(p: number): string {
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}

function compactPrice(p: number): string {
  if (p >= 1000) return `$${(p / 1000).toFixed(1)}K`;
  if (p >= 1) return `$${p.toFixed(2)}`;
  return `$${p.toFixed(4)}`;
}

async function fetch7dRange(symbol: string): Promise<{ high: number; low: number } | null> {
  try {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'candleSnapshot',
        req: { coin: symbol, interval: '1h', startTime: sevenDaysAgo, endTime: now },
      }),
    });
    if (!res.ok) return null;
    const candles = await res.json();
    if (!Array.isArray(candles) || candles.length === 0) return null;
    const highs = candles.map((c: { h: string }) => parseFloat(c.h));
    const lows = candles.map((c: { l: string }) => parseFloat(c.l));
    return { high: Math.max(...highs), low: Math.min(...lows) };
  } catch {
    return null;
  }
}
