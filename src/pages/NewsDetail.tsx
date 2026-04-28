// src/pages/NewsDetail.tsx
//
// News detail page (asset-detail-v2 Phase 3 minimal). Reached by tapping
// any row in the asset detail page's "What's moving" section.
//
// Layout:
//   1. Back link to the parent asset
//   2. News headline (Space Grotesk, large)
//   3. Source meta row (source · catalyst · relative time)
//   4. "The story" card    (AI-generated factual summary)
//   5. "Vela's read" card  (sentiment + interpretation)
//   6. "Read full article" link (always works, regardless of LLM status)
//
// Deferred (not in minimal Phase 3):
//   - Asset price strip
//   - "More on {asset} today" related stories list
//   - Share button + bottom-sheet preview (Phase 4)
//   - Free-tier locked variant (Phase 5)
//
// Empty/fail state: when LLM generation fails or both fields are null,
// the two LLM cards collapse to a single calm message. The "Read full
// article" link still works so the user has a path forward.

import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useAuthContext } from '../contexts/AuthContext';
import { Card } from '../components/VelaComponents';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

interface NewsRowMeta {
  id: string;
  title: string;
  source: string;
  url: string;
  published_at: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ai_classification: any;
}

interface DetailResponse {
  status: string;
  summary: string | null;
  vela_take: { sentiment?: string; vela_take?: string } | null;
}

export default function NewsDetail() {
  const { newsId } = useParams<{ newsId: string }>();
  const [searchParams] = useSearchParams();
  const assetSymbol = searchParams.get('asset') ?? '';
  const navigate = useNavigate();
  // news_cache has RLS `TO authenticated`; the bare anon client returns
  // zero rows. Pull the JWT-bearing client from auth context.
  const { getToken, supabaseClient } = useAuthContext();

  const [meta, setMeta] = useState<NewsRowMeta | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // Fetch the row meta (always succeeds even when LLM is unavailable so
  // the headline + source + Read-full-article link always render).
  useEffect(() => {
    if (!newsId || !supabaseClient) return;
    // Reset state on route change so the previous article doesn't flash
    // under the new URL while fetches resolve.
    setMeta(null);
    setDetail(null);
    setLoading(true);
    setFailed(false);

    let cancelled = false;
    (async () => {
      const { data, error } = await supabaseClient
        .from('news_cache')
        .select('id, title, source, url, published_at, ai_classification')
        .eq('id', newsId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.warn('[NewsDetail] news_cache meta read failed:', error.message);
        return;
      }
      if (data) setMeta(data as NewsRowMeta);
    })();
    return () => {
      cancelled = true;
    };
  }, [newsId, supabaseClient]);

  // Fetch (or trigger generation of) summary + vela_take.
  useEffect(() => {
    if (!newsId || !supabaseClient) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          setFailed(true);
          setLoading(false);
          return;
        }
        // Resolve symbol -> UUID for the asset_id field. The edge fn
        // expects a UUID; we keep symbol in the URL for human-readable
        // routes and look it up here.
        let assetUuid: string | undefined;
        if (assetSymbol) {
          const { data: assetRow } = await supabaseClient
            .from('assets')
            .select('id')
            .eq('symbol', assetSymbol.toUpperCase())
            .eq('enabled', true)
            .maybeSingle();
          assetUuid = assetRow?.id;
        }

        const res = await fetch(`${SUPABASE_URL}/functions/v1/news-detail-generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ news_cache_id: newsId, asset_id: assetUuid }),
        });
        if (cancelled) return;
        if (!res.ok) {
          setFailed(true);
          setLoading(false);
          return;
        }
        const data = (await res.json()) as DetailResponse;
        setDetail(data);
        setLoading(false);
      } catch {
        if (!cancelled) {
          setFailed(true);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [newsId, assetSymbol, getToken, supabaseClient]);

  if (!newsId) {
    return (
      <div style={{ padding: 'var(--space-6)' }}>
        <p style={{ color: 'var(--color-error)' }}>News article not found</p>
      </div>
    );
  }

  const summary = detail?.summary ?? null;
  const velaTake = detail?.vela_take ?? null;
  const showCards = !!summary || !!velaTake;
  const showFallback = !loading && !showCards;

  const catalyst =
    Array.isArray(meta?.ai_classification?.catalysts) &&
    meta!.ai_classification.catalysts.length > 0
      ? String(meta!.ai_classification.catalysts[0])
      : null;

  return (
    <div
      style={{
        padding: 'var(--space-4)',
        paddingBottom: 'var(--space-20)',
        maxWidth: 600,
        margin: '0 auto',
      }}
    >
      {/* Back link */}
      <button
        type="button"
        onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          background: 'none',
          border: 'none',
          padding: 0,
          marginBottom: 'var(--space-4)',
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
          color: 'var(--color-text-secondary)',
          cursor: 'pointer',
        }}
      >
        <span style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", fontWeight: 700 }}>‹</span>
        Back
      </button>

      {/* Headline */}
      <h1
        style={{
          fontFamily: "'Space Grotesk', system-ui, sans-serif",
          fontSize: 'var(--text-xl)',
          fontWeight: 700,
          lineHeight: 1.2,
          letterSpacing: '-0.02em',
          marginBottom: 'var(--space-2)',
          color: 'var(--color-text-primary)',
        }}
      >
        {meta?.title ?? 'Loading…'}
      </h1>

      {/* Source meta row */}
      {meta && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            flexWrap: 'wrap',
            fontSize: 11,
            color: 'var(--color-text-muted)',
            marginBottom: 'var(--space-4)',
          }}
        >
          <span>{meta.source}</span>
          {catalyst && (
            <>
              <span>·</span>
              <span>{catalyst}</span>
            </>
          )}
          <span>·</span>
          <span>{formatTimeAgo(meta.published_at)}</span>
        </div>
      )}

      {/* "The story" card */}
      {summary && (
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
            The story
          </div>
          <p
            style={{
              fontSize: 'var(--text-sm)',
              lineHeight: 1.6,
              color: 'var(--color-text-primary)',
              margin: 0,
            }}
          >
            {summary}
          </p>
        </Card>
      )}

      {/* "Vela's read" card */}
      {velaTake?.vela_take && (
        <Card
          style={{
            marginBottom: 'var(--space-4)',
            background: 'var(--mint-50)',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginBottom: 'var(--space-2)',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                background: 'var(--green-primary)',
                border: '1px solid var(--color-border-default)',
                transform: 'rotate(45deg)',
              }}
            />
            Vela&apos;s read
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              fontSize: 'var(--text-base)',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              marginBottom: 'var(--space-2)',
            }}
          >
            <SentimentDot sentiment={velaTake.sentiment ?? 'neutral'} />
            <span>{capitalize(velaTake.sentiment ?? 'neutral')} for {assetSymbol || 'this asset'}.</span>
          </div>
          <p
            style={{
              fontSize: 'var(--text-sm)',
              lineHeight: 1.6,
              color: 'var(--color-text-primary)',
              margin: 0,
            }}
          >
            {velaTake.vela_take}
          </p>
        </Card>
      )}

      {/* Empty / fail state — collapsed single message */}
      {showFallback && (
        <Card style={{ marginBottom: 'var(--space-4)' }}>
          <p style={{ fontWeight: 700, fontSize: 'var(--text-base)', margin: 0, marginBottom: 'var(--space-2)' }}>
            Vela&apos;s read isn&apos;t ready yet.
          </p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
            Try again in a minute. The full article is one tap away below.
          </p>
        </Card>
      )}

      {/* Loading state — keep it calm */}
      {loading && !failed && !showCards && (
        <Card style={{ marginBottom: 'var(--space-4)' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
            Reading the article…
          </p>
        </Card>
      )}

      {/* Read full article link — always works regardless of LLM status */}
      {meta?.url && (
        <a
          href={meta.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
            padding: 'var(--space-3) var(--space-4)',
            border: 'var(--border-medium) solid var(--color-border-default)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-bg-surface)',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            textDecoration: 'none',
            marginTop: 'var(--space-2)',
          }}
        >
          Read full article on {meta.source} <span aria-hidden>↗</span>
        </a>
      )}
    </div>
  );
}

function SentimentDot({ sentiment }: { sentiment: string }) {
  const color =
    sentiment === 'bullish'
      ? 'var(--green-primary)'
      : sentiment === 'bearish'
        ? 'var(--red-primary)'
        : 'var(--gray-300)';
  return (
    <span
      aria-hidden
      style={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: color,
        border: '1.5px solid var(--color-border-default)',
        flexShrink: 0,
      }}
    />
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
