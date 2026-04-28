// src/components/WhatsMoving.tsx
//
// Asset-detail-v2 "What's moving" section. Replaces the legacy
// WhatsMovingSection that read from `brief.detail.events_moving_markets`.
// Per spec, this reads news_cache directly so the section reflects the
// live news pipeline rather than stale Sonnet-extracted snapshots from
// the last brief generation.
//
// Each row is fully tappable and routes to /news/:newsId for the news
// detail page (Phase 3). Without the tap affordance the news_summary +
// news_vela_take LLM investment goes unused.
//
// Visual cues stack three signals so users discover the tap:
//   1. Subtle gray-300 underline on the headline (3px offset)
//   2. Trailing right chevron via inline span on the right
//   3. Hover lifts row background to mint-50, chevron slides 2px right

import { useEffect, useState } from 'react';
import { Card } from './VelaComponents';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '../contexts/AuthContext';

interface NewsRow {
  id: string;
  title: string;
  source: string;
  published_at: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ai_classification: any;
}

interface WhatsMovingProps {
  assetSymbol: string;
  assetName: string;
  /** Override section label. Defaults to "What's moving {assetName}". The
   * news detail page passes "More on {assetName} today" to render the
   * related-stories list. */
  title?: string;
  /** Exclude a single news_cache_id from the result set. Used by the
   * news detail page so the article being viewed doesn't appear in its
   * own related-stories list. */
  excludeId?: string;
}

const HOURS_48 = 48 * 60 * 60 * 1000;
const ROW_LIMIT = 10;

export default function WhatsMoving({
  assetSymbol,
  assetName,
  title,
  excludeId,
}: WhatsMovingProps) {
  const [rows, setRows] = useState<NewsRow[] | null>(null);
  const navigate = useNavigate();
  // news_cache has RLS `TO authenticated`; the bare anon client returns
  // zero rows. Pull the JWT-bearing client from auth context.
  const { supabaseClient } = useAuthContext();

  useEffect(() => {
    if (!supabaseClient) return;
    let cancelled = false;
    (async () => {
      const symbolLower = assetSymbol.toLowerCase();
      const cutoff = new Date(Date.now() - HOURS_48).toISOString();
      // When excludeId is set, fetch one extra row so we still hit
      // ROW_LIMIT after filtering.
      const fetchLimit = excludeId ? ROW_LIMIT + 1 : ROW_LIMIT;
      const { data, error } = await supabaseClient
        .from('news_cache')
        .select('id, title, source, published_at, ai_classification')
        .contains('relevant_assets', [symbolLower])
        .gte('published_at', cutoff)
        .order('published_at', { ascending: false })
        .limit(fetchLimit);
      if (cancelled) return;
      if (error) {
        console.warn('[WhatsMoving] news_cache read failed:', error.message);
        setRows([]);
        return;
      }
      const filtered = (data ?? []).filter((r: NewsRow) => r.id !== excludeId).slice(0, ROW_LIMIT);
      setRows(filtered as NewsRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [assetSymbol, excludeId, supabaseClient]);

  if (rows === null) return null; // initial fetch
  if (rows.length === 0) return null; // hide section when empty

  const sectionTitle = title ?? `What's moving ${assetName}`;

  return (
    <Card style={{ marginBottom: 'var(--space-4)' }}>
      <div
        className="vela-label-sm"
        style={{
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--color-text-muted)',
          fontSize: 11,
          fontWeight: 600,
          marginBottom: 'var(--space-2)',
        }}
      >
        {sectionTitle}
      </div>
      <div style={{ margin: '0 calc(var(--space-2) * -1)' }}>
        {rows.map((row, idx) => (
          <Row
            key={row.id}
            row={row}
            isLast={idx === rows.length - 1}
            onClick={() => navigate(`/news/${row.id}?asset=${assetSymbol}`)}
          />
        ))}
      </div>
    </Card>
  );
}

function Row({ row, isLast, onClick }: { row: NewsRow; isLast: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const sentiment: 'bull' | 'bear' | 'neut' = (() => {
    const s = row.ai_classification?.sentiment;
    if (s === 'bullish') return 'bull';
    if (s === 'bearish') return 'bear';
    return 'neut';
  })();
  // Catalyst is stored lowercase in the DB; capitalize for display per
  // wireframe (e.g. "Flows", "Leadership", not "flows" / "leadership").
  const catalyst =
    Array.isArray(row.ai_classification?.catalysts) && row.ai_classification.catalysts.length > 0
      ? capitalize(String(row.ai_classification.catalysts[0]))
      : null;
  const sentimentColor =
    sentiment === 'bull'
      ? 'var(--green-primary)'
      : sentiment === 'bear'
        ? 'var(--red-primary)'
        : 'var(--gray-300)';

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: '12px 1fr 14px',
        alignItems: 'start',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-2)',
        margin: 0,
        width: '100%',
        textAlign: 'left',
        borderTop: 'none',
        borderRight: 'none',
        borderLeft: 'none',
        borderBottom: isLast ? 'none' : '1px solid var(--gray-200)',
        background: hovered ? 'var(--mint-50)' : 'transparent',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        transition: 'background-color 120ms ease',
        position: 'relative',
        font: 'inherit',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          marginTop: 6,
          background: sentimentColor,
          border: '1px solid var(--color-border-default)',
        }}
      />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            lineHeight: 1.35,
            marginBottom: 'var(--space-1)',
            textDecoration: 'underline',
            textDecorationColor: hovered ? 'var(--color-text-primary)' : 'var(--gray-300)',
            textUnderlineOffset: '3px',
            textDecorationThickness: '1px',
            transition: 'text-decoration-color 120ms ease',
          }}
        >
          {row.title}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            flexWrap: 'wrap',
            fontSize: 'var(--text-2xs)',
            color: 'var(--color-text-muted)',
          }}
        >
          <span
            style={{
              maxWidth: 140,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {row.source}
          </span>
          {catalyst && (
            <>
              <span>·</span>
              <span>{catalyst}</span>
            </>
          )}
          {/* Time pushed to the right edge of the meta row per wireframe. */}
          <span style={{ marginLeft: 'auto' }}>{formatTimeAgo(row.published_at)}</span>
        </div>
      </div>
      <span
        aria-hidden
        style={{
          fontFamily: "'Space Grotesk', system-ui, sans-serif",
          fontWeight: 700,
          fontSize: 18,
          color: hovered ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
          alignSelf: 'start',
          marginTop: 2,
          transform: hovered ? 'translateX(2px)' : 'translateX(0)',
          transition: 'transform 120ms ease, color 120ms ease',
        }}
      >
        ›
      </span>
    </button>
  );
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

function formatTimeAgo(dateStr: string): string {
  const ageMs = Date.now() - new Date(dateStr).getTime();
  const minutes = ageMs / 60_000;
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${Math.floor(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = hours / 24;
  return `${Math.floor(days)}d ago`;
}
