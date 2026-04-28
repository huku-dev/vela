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
}

const HOURS_48 = 48 * 60 * 60 * 1000;

export default function WhatsMoving({ assetSymbol, assetName }: WhatsMovingProps) {
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
      const { data, error } = await supabaseClient
        .from('news_cache')
        .select('id, title, source, published_at, ai_classification')
        .contains('relevant_assets', [symbolLower])
        .gte('published_at', cutoff)
        .order('published_at', { ascending: false })
        .limit(10);
      if (cancelled) return;
      if (error) {
        console.warn('[WhatsMoving] news_cache read failed:', error.message);
        setRows([]);
        return;
      }
      setRows((data ?? []) as NewsRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [assetSymbol, supabaseClient]);

  if (rows === null) return null; // initial fetch
  if (rows.length === 0) return null; // hide section when empty

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
        What&apos;s moving {assetName}
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
  const catalyst =
    Array.isArray(row.ai_classification?.catalysts) && row.ai_classification.catalysts.length > 0
      ? String(row.ai_classification.catalysts[0])
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
            fontSize: 11,
            color: 'var(--color-text-muted)',
          }}
        >
          <span>{row.source}</span>
          {catalyst && (
            <>
              <span>·</span>
              <span>{catalyst}</span>
            </>
          )}
          <span>·</span>
          <span>{formatTimeAgo(row.published_at)}</span>
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
