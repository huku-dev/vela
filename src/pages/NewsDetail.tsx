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
import { useDashboard } from '../hooks/useData';
import { Card } from '../components/VelaComponents';
import VelaLogo from '../components/VelaLogo';
import WhatsMoving from '../components/WhatsMoving';
import { formatPrice, getCoinIcon } from '../lib/helpers';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

interface NewsRowMeta {
  id: string;
  title: string;
  source: string;
  url: string;
  published_at: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ai_classification: any;
  summary: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vela_take: any;
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
  // Asset metadata + live price for the price strip. Reuses the dashboard
  // hook so we don't duplicate fetches.
  const { data: dashboardData } = useDashboard();
  const dashboardEntry = assetSymbol
    ? dashboardData.find(d => d.asset.symbol.toUpperCase() === assetSymbol.toUpperCase())
    : undefined;
  const asset = dashboardEntry?.asset;
  const livePrice = dashboardEntry?.priceData?.price;
  const change24h = dashboardEntry?.priceData?.change24h;
  // Coerce empty string to null so the JSX img branch only fires when
  // we actually have a URL. getCoinIcon returns "" for unknown
  // coingecko_ids; with `??` that empty string would propagate and
  // <img src=""> would fire a request for the page URL itself.
  const iconUrl =
    asset?.icon_url || (asset?.coingecko_id ? getCoinIcon(asset.coingecko_id) : null) || null;

  const [meta, setMeta] = useState<NewsRowMeta | null>(null);
  // Distinct from meta itself: flips true after the meta query resolves
  // regardless of result. Lets the page distinguish "still fetching" from
  // "fetched and empty" so we can render a not-found terminal instead of
  // a perpetual "Loading…" placeholder.
  const [metaLoaded, setMetaLoaded] = useState(false);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch the row meta (always succeeds even when LLM is unavailable so
  // the headline + source + Read-full-article link always render).
  useEffect(() => {
    if (!newsId || !supabaseClient) return;
    // Reset state on route change so the previous article doesn't flash
    // under the new URL while fetches resolve.
    setMeta(null);
    setMetaLoaded(false);
    setDetail(null);
    setLoading(true);

    let cancelled = false;
    (async () => {
      const { data, error } = await supabaseClient
        .from('news_cache')
        .select('id, title, source, url, published_at, ai_classification, summary, vela_take')
        .eq('id', newsId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.warn('[NewsDetail] news_cache meta read failed:', error.message);
      } else if (data) {
        const row = data as NewsRowMeta;
        setMeta(row);
        // Short-circuit: when the LLM-generated fields are already
        // persisted on the row, render directly without a round-trip
        // to news-detail-generate. The edge function would itself
        // short-circuit on cache hit, but skipping the call entirely
        // saves the JWT auth + network round-trip (~1-2s "Loading
        // article…" flash on every visit, including for old briefs
        // linked from Telegram).
        if (row.summary && row.vela_take) {
          setDetail({
            status: 'cached',
            summary: row.summary,
            vela_take: row.vela_take,
          });
          setLoading(false);
        }
      }
      // Always flip metaLoaded once the query settles so the not-found
      // terminal can render when data is null without keeping the page
      // stuck on a loader.
      setMetaLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [newsId, supabaseClient]);

  // Fetch (or trigger generation of) summary + vela_take.
  // Wait for the meta query above to settle so we know whether the row
  // is cached. The first useEffect sets detail directly on cache hit;
  // we only need this effect for cache misses (LLM generation needed).
  useEffect(() => {
    if (!newsId || !supabaseClient) return;
    if (!metaLoaded) return;
    if (!meta) return; // not found — render-time terminal handles UX
    if (meta.summary && meta.vela_take) return; // cached, already rendered
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) {
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
          setLoading(false);
          return;
        }
        const data = (await res.json()) as DetailResponse;
        setDetail(data);
        setLoading(false);
      } catch {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [newsId, assetSymbol, getToken, supabaseClient, metaLoaded, meta]);

  if (!newsId) {
    return <NotFoundView onBack={() => navigate('/')} />;
  }

  // States:
  //   metaLoaded=false                -> still fetching the row → pulse loader
  //   metaLoaded=true && meta===null  -> terminal not-found
  //   metaLoaded=true && meta!==null  -> render the page (LLM status drives the cards inside)
  if (!metaLoaded) {
    return <PageLoadingView />;
  }
  if (metaLoaded && meta === null) {
    return (
      <NotFoundView onBack={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))} />
    );
  }

  const summary = detail?.summary ?? null;
  const velaTake = detail?.vela_take ?? null;
  const showCards = !!summary || !!velaTake;
  const showFallback = !loading && !showCards;

  const catalyst =
    Array.isArray(meta?.ai_classification?.catalysts) &&
    meta!.ai_classification.catalysts.length > 0
      ? capitalize(String(meta!.ai_classification.catalysts[0]))
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
      {/* Back link — parent-asset-aware ("Back to Bitcoin") per wireframe.
          Falls back to bare "Back" when no asset symbol is available. */}
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
        <span style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", fontWeight: 700 }}>
          ‹
        </span>
        Back{asset?.name ? ` to ${asset.name}` : ''}
      </button>

      {/* Headline */}
      <h1
        style={{
          fontFamily: "'Space Grotesk', system-ui, sans-serif",
          fontSize: 'var(--text-xl)',
          fontWeight: 700,
          lineHeight: 'var(--leading-snug)',
          letterSpacing: '-0.02em',
          marginBottom: 'var(--space-2)',
          color: 'var(--color-text-primary)',
        }}
      >
        {meta!.title}
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
            marginBottom: 'var(--space-3)',
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

      {/* Asset price strip — anchors the news to the parent asset's
          current state. Full-width per wireframe (.news-asset-strip):
          icon + name on the left, price + 24h pushed to the right via
          margin-left:auto. */}
      {asset && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-2) var(--space-3)',
            border: 'var(--border-medium) solid var(--color-border-default)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-bg-surface)',
            marginBottom: 'var(--space-4)',
          }}
        >
          {iconUrl ? (
            <img
              src={iconUrl}
              alt=""
              width={22}
              height={22}
              style={{
                borderRadius: '50%',
                flex: '0 0 22px',
                border: '1.5px solid var(--color-border-default)',
              }}
              onError={e => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            // Brand-gradient monogram fallback when icon URL is missing.
            <span
              aria-hidden
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                border: '1.5px solid var(--color-border-default)',
                background: 'linear-gradient(135deg, #f7931a, #ffb84d)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: "'Space Grotesk', system-ui, sans-serif",
                fontWeight: 900,
                fontSize: 'var(--text-2xs)',
                color: 'var(--white)',
                flex: '0 0 22px',
              }}
            >
              {asset.symbol.charAt(0)}
            </span>
          )}
          <span
            style={{
              fontFamily: "'Space Grotesk', system-ui, sans-serif",
              fontWeight: 700,
              fontSize: 'var(--text-sm)',
            }}
          >
            {asset.name}
          </span>
          {livePrice != null && (
            <span
              className="vela-mono"
              style={{
                fontSize: 'var(--text-sm)',
                fontWeight: 700,
                marginLeft: 'auto',
              }}
            >
              {formatPrice(livePrice)}
            </span>
          )}
          {change24h != null && (
            <span
              className="vela-mono"
              style={{
                fontSize: 'var(--text-2xs)',
                fontWeight: 600,
                color: change24h >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
              }}
            >
              {change24h >= 0 ? '+' : ''}
              {change24h.toFixed(1)}%
            </span>
          )}
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

      {/* "Vela's read" card — lavender background per wireframe
          (.vela-take-card matches the in-app "What Vela is doing"
          pattern). Iris uses --vela-signal-green, no border. */}
      {velaTake?.vela_take && (
        <Card
          style={{
            marginBottom: 'var(--space-4)',
            background: 'var(--lavender-50)',
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
                background: 'var(--vela-signal-green)',
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
            <span>
              {capitalize(velaTake.sentiment ?? 'neutral')} for{' '}
              {asset?.name || assetSymbol || 'this asset'}.
            </span>
          </div>
          <p
            style={{
              fontSize: 'var(--text-sm)',
              lineHeight: 'var(--leading-relaxed)',
              color: 'var(--color-text-primary)',
              margin: 0,
            }}
          >
            {velaTake.vela_take}
          </p>
        </Card>
      )}

      {/* Empty / fail state — centered layout per wireframe. Vela diamond
          sits prominently above the headline (in a soft tile), signalling
          "off, not alarming" without dominating the card. The "More on X"
          section below still renders since it has no LLM dependency. */}
      {showFallback && (
        <Card style={{ marginBottom: 'var(--space-4)' }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              padding: 'var(--space-3) var(--space-4)',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: 'var(--gray-100)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 'var(--space-3)',
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  background: 'var(--gray-300)',
                  transform: 'rotate(45deg)',
                  display: 'inline-block',
                }}
              />
            </span>
            <p
              style={{
                fontWeight: 700,
                fontSize: 'var(--text-base)',
                margin: 0,
                marginBottom: 'var(--space-1)',
              }}
            >
              Vela&apos;s read isn&apos;t ready yet.
            </p>
            <p
              style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-secondary)',
                margin: 0,
                maxWidth: 280,
              }}
            >
              Try again in a minute. The full article is one tap away below.
            </p>
          </div>
        </Card>
      )}

      {/* Read full article — full-width primary dark CTA per wireframe
          (.read-full). Always works regardless of LLM status. */}
      {meta?.url && (
        <a
          href={meta.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-1)',
            width: '100%',
            padding: 'var(--space-3)',
            border: 'var(--border-medium) solid var(--color-border-default)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-sm)',
            background: 'var(--color-text-primary)',
            fontSize: 'var(--text-sm)',
            fontWeight: 700,
            letterSpacing: '0.02em',
            color: 'var(--white)',
            textDecoration: 'none',
            marginTop: 'var(--space-2)',
          }}
        >
          Read full article on {meta.source} <span aria-hidden>↗</span>
        </a>
      )}

      {/* "More on {asset} today" — same WhatsMoving primitive as the
          asset detail page, with the current article excluded. Renders
          regardless of LLM status (no per-article dependency). */}
      {assetSymbol && asset && (
        <div style={{ marginTop: 'var(--space-6)' }}>
          <WhatsMoving
            assetSymbol={assetSymbol}
            assetName={asset.name}
            title={`More on ${asset.name} today`}
            excludeId={newsId}
          />
        </div>
      )}
    </div>
  );
}

function PageLoadingView() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-4)',
        paddingTop: 'var(--space-16)',
      }}
    >
      <VelaLogo variant="mark" size={48} pulse />
      <span className="vela-body-sm vela-text-muted">Loading article…</span>
    </div>
  );
}

function NotFoundView({ onBack }: { onBack: () => void }) {
  return (
    <div
      style={{
        padding: 'var(--space-6)',
        maxWidth: 600,
        margin: '0 auto',
      }}
    >
      <button
        type="button"
        onClick={onBack}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          background: 'none',
          border: 'none',
          padding: 0,
          marginBottom: 'var(--space-6)',
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
          color: 'var(--color-text-secondary)',
          cursor: 'pointer',
        }}
      >
        <span style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", fontWeight: 700 }}>
          ‹
        </span>
        Back
      </button>
      <h1
        style={{
          fontFamily: "'Space Grotesk', system-ui, sans-serif",
          fontSize: 'var(--text-lg)',
          fontWeight: 700,
          marginBottom: 'var(--space-2)',
          color: 'var(--color-text-primary)',
        }}
      >
        Article not found
      </h1>
      <p
        style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-secondary)',
          margin: 0,
        }}
      >
        This article may have been removed or the link is wrong. Try the home page for the latest
        news.
      </p>
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
