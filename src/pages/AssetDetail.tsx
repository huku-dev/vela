import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Card, Alert, LoadingSpinner } from '../components/VelaComponents';
import SignalChip from '../components/SignalChip';
import PriceArrow from '../components/PriceArrow';
import FearGreedGauge from '../components/FearGreedGauge';
import TradeProposalCard from '../components/TradeProposalCard';
import { useAssetDetail } from '../hooks/useData';
import { useTrading } from '../hooks/useTrading';
import { useAuthContext } from '../contexts/AuthContext';
import {
  breakIntoParagraphs,
  formatPrice,
  getCoinIcon,
  stripAssetPrefix,
  groupBriefsBySignalState,
  parsePriceSegments,
  plainEnglish,
} from '../lib/helpers';
import type { SignalColor, BriefGroup } from '../types';

const signalTitles: Record<SignalColor, string> = {
  green: 'Buy signal',
  red: 'Exit signal',
  grey: 'Wait',
};

const signalBg: Record<SignalColor, string> = {
  green: 'var(--mint-100)',
  red: 'var(--red-light)',
  grey: 'var(--sky-100)',
};

export default function AssetDetail() {
  const { assetId } = useParams<{ assetId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { asset, signal, brief, recentBriefs, priceData, signalLookup, loading } = useAssetDetail(
    assetId!
  );
  const { isAuthenticated } = useAuthContext();
  const { proposals, acceptProposal, declineProposal } = useTrading();

  // Email redirect result banner
  const resultParam = searchParams.get('result');
  const [actionBanner, setActionBanner] = useState<string | null>(null);

  useEffect(() => {
    if (resultParam) {
      if (resultParam === 'approved') {
        setActionBanner('Trade approved and executing');
      } else if (resultParam === 'declined') {
        setActionBanner('Trade proposal declined');
      } else if (resultParam === 'error') {
        setActionBanner(
          'Unable to process trade action. The proposal may have expired or already been handled.'
        );
      }
      // Clear query params
      searchParams.delete('result');
      searchParams.delete('proposal');
      searchParams.delete('error');
      setSearchParams(searchParams, { replace: true });
      // Auto-dismiss after 5 seconds
      setTimeout(() => setActionBanner(null), 5000);
    }
  }, [resultParam, searchParams, setSearchParams]);

  // Get pending proposals for this asset
  const pendingProposals = isAuthenticated
    ? proposals.filter(p => p.asset_id === assetId && p.status === 'pending')
    : [];

  if (loading && !asset) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 'var(--space-16)' }}>
        <LoadingSpinner size={28} />
      </div>
    );
  }

  if (!asset) {
    return (
      <div style={{ padding: 'var(--space-6)' }}>
        <p style={{ color: 'var(--color-error)' }}>Asset not found</p>
      </div>
    );
  }

  const price = priceData?.price ?? signal?.price_at_signal;
  const change24h = priceData?.change24h;
  const signalColor = signal?.signal_color || 'grey';
  const detail = brief?.detail;

  // Extract fear/greed from market context string if available
  const fearGreedMatch = detail?.market_context?.fear_greed?.match(/(\d+)/);
  const fearGreedValue = fearGreedMatch ? parseInt(fearGreedMatch[1], 10) : null;
  const fearGreedLabel =
    detail?.market_context?.fear_greed?.match(
      /extreme fear|fear|neutral|greed|extreme greed/i
    )?.[0] || '';

  // Parse summary into paragraphs
  const summaryParagraphs = breakIntoParagraphs(brief?.summary || '', 2);
  const iconUrl = getCoinIcon(asset.coingecko_id);

  return (
    <div
      style={{
        padding: 'var(--space-4)',
        paddingBottom: 'var(--space-20)',
        maxWidth: 600,
        margin: '0 auto',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-6)',
          marginTop: 'var(--space-2)',
        }}
      >
        <button
          onClick={() => navigate('/')}
          aria-label="Go back"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'var(--border-medium) solid var(--color-border-default)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-xs)',
            width: 36,
            height: 36,
            background: 'var(--color-bg-surface)',
            cursor: 'pointer',
            transition:
              'transform var(--motion-fast) var(--motion-ease-out), box-shadow var(--motion-fast) var(--motion-ease-out)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M9 2L4 7L9 12"
              style={{ stroke: 'var(--color-text-primary)' }}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {/* Asset icon */}
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            border: 'var(--border-medium) solid var(--color-border-default)',
            overflow: 'hidden',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'var(--gray-100)',
          }}
        >
          {iconUrl ? (
            <img
              src={iconUrl}
              alt={asset.symbol}
              width={36}
              height={36}
              style={{ objectFit: 'cover', borderRadius: '50%' }}
              onError={e => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <span
              style={{
                fontWeight: 800,
                fontSize: 'var(--text-base)',
                color: 'var(--color-text-primary)',
              }}
            >
              {asset.symbol.charAt(0)}
            </span>
          )}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <h1 className="vela-heading-xl" style={{ fontSize: 'var(--text-xl)' }}>
              {asset.symbol}
            </h1>
            <SignalChip color={signalColor} size="small" />
          </div>
          <span className="vela-body-sm vela-text-muted" style={{ fontSize: 'var(--text-xs)' }}>
            {asset.name}
          </span>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <span
            className="vela-mono"
            style={{
              fontWeight: 'var(--weight-bold)',
              fontSize: '1.1rem',
              color: 'var(--color-text-primary)',
              lineHeight: 1.2,
              display: 'block',
            }}
          >
            {formatPrice(price)}
          </span>
          {change24h != null && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
                justifyContent: 'flex-end',
                marginTop: 2,
                whiteSpace: 'nowrap',
              }}
            >
              <PriceArrow change24h={change24h} />
              <span
                className="vela-mono"
                style={{
                  fontWeight: 'var(--weight-semibold)',
                  fontSize: '0.7rem',
                  color: change24h >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
                  lineHeight: 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {Math.abs(change24h).toFixed(1)}% 24h
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Email action result banner */}
      {actionBanner && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert
            variant={actionBanner.includes('approved') ? 'success' : 'info'}
            onDismiss={() => setActionBanner(null)}
          >
            {actionBanner.includes('approved') ? '✅' : '❌'} {actionBanner}
          </Alert>
        </div>
      )}

      {/* Pending trade proposals */}
      {pendingProposals.map(proposal => (
        <div key={proposal.id} style={{ marginBottom: 'var(--space-4)' }}>
          <TradeProposalCard
            proposal={proposal}
            assetSymbol={asset.symbol}
            onAccept={acceptProposal}
            onDecline={declineProposal}
          />
        </div>
      ))}

      {/* Tier 1: Key Signal — expandable with signal history */}
      {brief &&
        (() => {
          const signalGroups =
            recentBriefs.length > 1
              ? groupBriefsBySignalState(
                  recentBriefs.slice(1),
                  signalLookup as Record<string, SignalColor>,
                  signalColor
                )
              : [];
          const hasHistory = signalGroups.length > 0;

          return (
            <SignalHistoryCard
              signalColor={signalColor}
              headline={stripAssetPrefix(brief.headline, asset.symbol)}
              groups={signalGroups}
              hasHistory={hasHistory}
              symbol={asset.symbol}
            />
          );
        })()}

      {/* Tier 2: What's happening — with paragraph breaks */}
      {summaryParagraphs.length > 0 && (
        <Card style={{ marginBottom: 'var(--space-4)' }}>
          <SectionLabel>What&apos;s happening</SectionLabel>
          {summaryParagraphs.map((para, i) => (
            <p
              key={i}
              className="vela-body-sm"
              style={{
                color: 'var(--color-text-secondary)',
                lineHeight: 1.7,
                marginBottom: i < summaryParagraphs.length - 1 ? 'var(--space-3)' : 0,
              }}
            >
              {para}
            </p>
          ))}
        </Card>
      )}

      {/* Tier 3: Why we think this — collapsible */}
      {detail && (
        <WhyWeThinkThis
          detail={detail}
          brief={brief}
          recentBriefs={recentBriefs}
          price={price}
          fearGreedValue={fearGreedValue}
          fearGreedLabel={fearGreedLabel}
        />
      )}

      {/* Timestamp — show signal check recency + brief age */}
      {(signal || brief) && (
        <p
          className="vela-body-sm vela-text-muted"
          style={{ textAlign: 'center', marginTop: 'var(--space-6)', fontSize: '0.68rem' }}
        >
          {signal && <>Signal checked {formatTimeAgo(signal.created_at)}</>}
          {signal && brief && ' · '}
          {brief && <>Analysis written {formatTimeAgo(brief.created_at)}</>}
        </p>
      )}
    </div>
  );
}

// ── Collapsible "Why we think this" section (replaces MUI Accordion) ──

function WhyWeThinkThis({
  detail,
  brief,
  recentBriefs,
  price,
  fearGreedValue,
  fearGreedLabel,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  detail: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  brief: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recentBriefs: any[];
  price: number | undefined | null;
  fearGreedValue: number | null;
  fearGreedLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const indicators = detail?.indicators;

  return (
    <div
      className="vela-card"
      style={{ marginBottom: 'var(--space-4)', padding: 0, overflow: 'hidden' }}
    >
      {/* Collapsible header */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: 'var(--space-4) var(--space-5)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          minHeight: 48,
        }}
      >
        <SectionLabel style={{ marginBottom: 0 }}>Why we think this</SectionLabel>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          style={{
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform var(--motion-normal) var(--motion-ease-out)',
          }}
        >
          <path
            d="M3 6L8 11L13 6"
            style={{ stroke: 'var(--color-text-primary)' }}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Collapsible content */}
      {expanded && (
        <div style={{ padding: '0 var(--space-5) var(--space-5)' }}>
          {/* Signal Breakdown — as bullet list */}
          {detail.signal_breakdown && Object.keys(detail.signal_breakdown).length > 0 && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <SubLabel>Technical analysis</SubLabel>
              <ul style={{ margin: 0, paddingLeft: 'var(--space-5)', listStyle: 'disc' }}>
                {Object.entries(detail.signal_breakdown).map(([key, value]) => (
                  <li
                    key={key}
                    className="vela-body-sm"
                    style={{
                      color: 'var(--color-text-secondary)',
                      marginBottom: 'var(--space-2)',
                      lineHeight: 1.6,
                    }}
                  >
                    {(() => {
                      const t = plainEnglish(value as string);
                      return t.charAt(0).toUpperCase() + t.slice(1);
                    })()}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Divider />

          {/* Market Context — with Fear & Greed gauge */}
          {detail.market_context && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <SubLabel>Market context</SubLabel>

              {fearGreedValue != null && (
                <div
                  className="vela-card"
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    margin: 'var(--space-4) 0',
                    padding: 'var(--space-3)',
                    backgroundColor: 'var(--gray-50)',
                  }}
                >
                  <FearGreedGauge value={fearGreedValue} label={fearGreedLabel} />
                </div>
              )}

              <ul style={{ margin: 0, paddingLeft: 'var(--space-5)', listStyle: 'disc' }}>
                {Object.entries(detail.market_context).map(([key, value]) => (
                  <li
                    key={key}
                    className="vela-body-sm"
                    style={{
                      color: 'var(--color-text-secondary)',
                      marginBottom: 'var(--space-1)',
                      lineHeight: 1.6,
                    }}
                  >
                    {(() => {
                      const t = value as string;
                      return t.charAt(0).toUpperCase() + t.slice(1);
                    })()}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Divider />

          {/* Indicators — Plain English */}
          {indicators && (
            <IndicatorsSection
              indicators={indicators}
              price={price}
              brief={brief}
              recentBriefs={recentBriefs}
            />
          )}

          {/* Price level triggers */}
          {indicators && detail && (
            <PriceLevelTriggers indicators={indicators} price={price} detail={detail} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Indicators Section ──

function IndicatorsSection({
  indicators,
  price,
  brief,
  recentBriefs,
}: {
  indicators: {
    ema_9: number;
    ema_21: number;
    rsi_14: number;
    adx_4h: number;
    sma_50_daily: number;
  };
  price: number | undefined | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  brief: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recentBriefs: any[];
}) {
  const currentPrice = price ?? 0;
  const { ema_9: ema9, ema_21: ema21, rsi_14: rsi, adx_4h: adx, sma_50_daily: sma50 } =
    indicators;

  // Find oldest brief with indicators for delta comparison
  const oldestWithIndicators = [...recentBriefs]
    .reverse()
    .find(b => b.detail?.indicators && b.id !== brief?.id);
  const oldInd = oldestWithIndicators?.detail?.indicators;

  const rsiDelta = oldInd ? rsi - oldInd.rsi_14 : null;
  const adxDelta = oldInd ? adx - oldInd.adx_4h : null;

  const deltaLabel = oldestWithIndicators
    ? (() => {
        const diffMs =
          new Date(brief!.created_at).getTime() -
          new Date(oldestWithIndicators.created_at).getTime();
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
        return diffDays <= 1 ? 'vs yesterday' : `vs ${diffDays} days ago`;
      })()
    : null;

  const tooltipTimeframe = deltaLabel
    ? deltaLabel === 'vs yesterday'
      ? 'in the last day'
      : `in the last ${deltaLabel.replace('vs ', '').replace(' ago', '')}`
    : null;

  const trendLabel =
    currentPrice > ema9 && currentPrice > ema21
      ? 'Above short & medium averages'
      : currentPrice > ema9
        ? 'Above short-term but below medium-term average'
        : currentPrice > ema21
          ? 'Below short-term but above medium-term average'
          : 'Below short & medium averages';
  const trendColor =
    currentPrice > ema9 && currentPrice > ema21
      ? 'var(--green-dark)'
      : currentPrice < ema9 && currentPrice < ema21
        ? 'var(--red-dark)'
        : 'var(--amber-dark)';

  const rsiLabel =
    rsi >= 70
      ? 'Overbought'
      : rsi >= 60
        ? 'Strong'
        : rsi >= 40
          ? 'Neutral'
          : rsi >= 30
            ? 'Weak'
            : 'Oversold';
  const rsiColor =
    rsi >= 70
      ? 'var(--red-dark)'
      : rsi >= 60
        ? 'var(--green-dark)'
        : rsi >= 40
          ? 'var(--color-text-muted)'
          : rsi >= 30
            ? 'var(--amber-dark)'
            : 'var(--red-dark)';

  const adxLabel =
    adx >= 50
      ? 'Very strong trend'
      : adx >= 25
        ? 'Trending'
        : adx >= 15
          ? 'Weak trend'
          : 'No clear trend';
  const adxColor =
    adx >= 25 ? 'var(--green-dark)' : adx >= 15 ? 'var(--amber-dark)' : 'var(--color-text-muted)';

  const smaLabel = currentPrice > sma50 ? 'Above 50-day average' : 'Below 50-day average';
  const smaColor = currentPrice > sma50 ? 'var(--green-dark)' : 'var(--red-dark)';
  const smaDist = currentPrice && sma50 ? ((currentPrice - sma50) / sma50) * 100 : 0;

  const smaTooltip = (() => {
    const base =
      'Compares the current price to its 50-day average. Being above it generally indicates a healthy longer-term trend; being below may signal weakness.';
    if (smaDist !== 0) {
      const aboveBelow = smaDist > 0 ? 'above' : 'below';
      return `${base} Currently ${Math.abs(smaDist).toFixed(1)}% ${aboveBelow} the 50-day average.`;
    }
    return base;
  })();

  const rsiTooltip = (() => {
    const base =
      'Measures buying vs selling pressure on a 0-100 scale. Above 70 means overbought (may pull back), below 30 means oversold (may bounce).';
    if (rsiDelta != null && Math.abs(rsiDelta) >= 0.1 && tooltipTimeframe) {
      const direction = rsiDelta > 0 ? 'up' : 'down';
      return `${base} At ${rsi.toFixed(0)}, it's ${direction} ${Math.abs(rsiDelta).toFixed(1)} ${tooltipTimeframe}.`;
    }
    return base;
  })();

  const adxTooltip = (() => {
    const base =
      'Measures how strong the current trend is, regardless of direction. Above 25 means a clear trend exists; below 15 means the market is drifting sideways.';
    if (adxDelta != null && Math.abs(adxDelta) >= 0.1 && tooltipTimeframe) {
      const direction = adxDelta > 0 ? 'up' : 'down';
      return `${base} At ${adx.toFixed(0)}, it's ${direction} ${Math.abs(adxDelta).toFixed(1)} ${tooltipTimeframe}.`;
    }
    return base;
  })();

  return (
    <div style={{ marginBottom: 'var(--space-4)' }}>
      <div style={{ marginBottom: 'var(--space-1)' }}>
        <span className="vela-label-sm" style={{ color: 'var(--color-text-primary)' }}>
          Momentum indicators
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: 'var(--space-3)',
          backgroundColor: 'var(--gray-50)',
          border: '1.5px solid var(--gray-200)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <IndicatorRow
          label="Short-term trend"
          description={trendLabel}
          color={trendColor}
          tooltip="Compares the current price to its 9-day and 21-day moving averages. When price is above both, the short-term trend is up."
        />
        <IndicatorRow
          label="Longer-term trend"
          description={smaLabel}
          color={smaColor}
          tooltip={smaTooltip}
        />
        <IndicatorRow
          label="Momentum"
          description={`${rsiLabel} (${rsi.toFixed(0)})`}
          color={rsiColor}
          tooltip={rsiTooltip}
        />
        <IndicatorRow
          label="Trend strength"
          description={`${adxLabel} (${adx.toFixed(0)})`}
          color={adxColor}
          tooltip={adxTooltip}
        />
      </div>
    </div>
  );
}

// ── Price Level Triggers ──

function PriceLevelTriggers({
  indicators,
  price,
  detail,
}: {
  indicators: { ema_9: number; ema_21: number; sma_50_daily: number };
  price: number | undefined | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  detail: any;
}) {
  const cp = price ?? 0;
  const bullLevel = Math.max(indicators.ema_9, indicators.ema_21);
  const bearLevel = indicators.sma_50_daily;
  const aboveBull = cp > bullLevel;
  const belowBear = cp < bearLevel;

  return (
    <div>
      <SubLabel>Key price levels to watch</SubLabel>
      <div className="vela-stack" style={{ gap: 'var(--space-2)' }}>
        <TriggerCard
          direction="bullish"
          level={formatPrice(bullLevel)}
          active={aboveBull}
          label={
            aboveBull
              ? 'Price is above short-term averages — maintaining this with rising momentum could shift towards Buy'
              : 'A sustained break above short-term averages with rising momentum could shift the signal towards Buy'
          }
        />
        <TriggerCard
          direction="bearish"
          level={formatPrice(bearLevel)}
          active={belowBear}
          label={
            belowBear
              ? `Price is already ${(((bearLevel - cp) / bearLevel) * 100).toFixed(0)}% below this level — continued weakness here adds bearish pressure`
              : 'A break below the 50-day average would signal meaningful bearish pressure and could trigger a Sell'
          }
        />
      </div>
      {detail.what_would_change && (
        <p
          className="vela-body-sm"
          style={{
            color: 'var(--color-text-muted)',
            lineHeight: 1.6,
            marginTop: 'var(--space-3)',
            fontStyle: 'italic',
          }}
        >
          {parsePriceSegments(plainEnglish(detail.what_would_change)).map((seg, i) =>
            seg.type === 'price' ? (
              <span
                key={i}
                className="vela-mono"
                style={{
                  fontWeight: 'var(--weight-semibold)',
                  fontStyle: 'normal',
                  color: 'var(--color-text-primary)',
                  backgroundColor: 'var(--gray-100)',
                  borderRadius: '4px',
                  padding: '0 var(--space-1)',
                }}
              >
                {seg.value}
              </span>
            ) : (
              <React.Fragment key={i}>{seg.value}</React.Fragment>
            )
          )}
        </p>
      )}
    </div>
  );
}

// ── Helper Components ──

function formatTimeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function SectionLabel({
  children,
  style = {},
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className="vela-label-sm vela-text-muted"
      style={{
        textTransform: 'uppercase',
        display: 'block',
        marginBottom: 'var(--space-2)',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="vela-label-sm"
      style={{
        color: 'var(--color-text-primary)',
        display: 'block',
        marginBottom: 'var(--space-1)',
      }}
    >
      {children}
    </span>
  );
}

function Divider() {
  return (
    <div
      style={{
        borderTop: 'var(--border-medium) solid var(--gray-200)',
        margin: 'var(--space-3) 0',
      }}
    />
  );
}

function IndicatorRow({
  label,
  description,
  color,
  tooltip,
}: {
  label: string;
  description: string;
  color: string;
  tooltip: string;
}) {
  const [showTip, setShowTip] = React.useState(false);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <span
            className="vela-body-sm"
            style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}
          >
            {label}
          </span>
          <span
            onClick={() => setShowTip(!showTip)}
            role="button"
            tabIndex={0}
            onKeyDown={e => {
              if (e.key === 'Enter') setShowTip(!showTip);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 14,
              height: 14,
              borderRadius: '50%',
              border: '1px solid var(--gray-300)',
              fontSize: '0.55rem',
              fontWeight: 700,
              color: 'var(--gray-400)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            ?
          </span>
        </div>
        <span
          className="vela-body-sm"
          style={{
            fontSize: '0.72rem',
            fontWeight: 'var(--weight-semibold)',
            color,
          }}
        >
          {description}
        </span>
      </div>
      {showTip && (
        <p
          className="vela-body-sm"
          style={{
            fontSize: '0.65rem',
            color: 'var(--color-text-muted)',
            backgroundColor: 'var(--gray-100)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-2)',
            marginTop: 'var(--space-1)',
            lineHeight: 1.5,
          }}
        >
          {tooltip}
        </p>
      )}
    </div>
  );
}

function TriggerCard({
  direction,
  level,
  label,
  active = false,
}: {
  direction: 'bullish' | 'bearish';
  level: string;
  label: string;
  active?: boolean;
}) {
  const isBull = direction === 'bullish';
  const color = isBull ? 'var(--green-dark)' : 'var(--red-dark)';
  const bg = isBull ? 'var(--green-light)' : 'var(--red-light)';

  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--space-3)',
        alignItems: 'flex-start',
        padding: 'var(--space-3)',
        borderRadius: 'var(--radius-md)',
        border: 'var(--border-medium) solid var(--color-border-default)',
        boxShadow: 'var(--shadow-sm)',
        backgroundColor: bg,
      }}
    >
      {/* Direction icon */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          borderRadius: 'var(--radius-sm)',
          border: 'var(--border-medium) solid var(--color-border-default)',
          backgroundColor: 'var(--white)',
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
          {isBull ? (
            <polygon
              points="6,0 12,10 0,10"
              style={{ fill: color }}
              stroke="#1A1A1A"
              strokeWidth="1"
            />
          ) : (
            <polygon
              points="6,10 12,0 0,0"
              style={{ fill: color }}
              stroke="#1A1A1A"
              strokeWidth="1"
            />
          )}
        </svg>
      </div>
      <div style={{ flex: 1 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            marginBottom: 2,
          }}
        >
          <span
            className="vela-mono"
            style={{
              fontWeight: 'var(--weight-bold)',
              fontSize: '0.88rem',
              color: 'var(--color-text-primary)',
            }}
          >
            {level}
          </span>
          {active && (
            <span
              className="vela-label-sm"
              style={{
                color,
                backgroundColor: 'var(--white)',
                border: `1.5px solid ${color}`,
                borderRadius: '4px',
                padding: '1px var(--space-2)',
                lineHeight: 1.4,
                fontSize: '0.58rem',
              }}
            >
              {isBull ? 'Above' : 'Below'}
            </span>
          )}
        </div>
        <p
          className="vela-body-sm"
          style={{
            color: 'var(--color-text-secondary)',
            lineHeight: 1.5,
            fontSize: '0.72rem',
          }}
        >
          {label}
        </p>
      </div>
    </div>
  );
}

/* ── Signal color mapping for group borders & badges ── */
const groupColorMap: Record<
  SignalColor,
  { border: string; bg: string; text: string; label: string }
> = {
  green: {
    border: 'var(--green-dark)',
    bg: 'var(--green-light)',
    text: 'var(--green-dark)',
    label: 'Buy',
  },
  red: {
    border: 'var(--red-dark)',
    bg: 'var(--red-light)',
    text: 'var(--red-dark)',
    label: 'Sell',
  },
  grey: {
    border: 'var(--color-text-muted)',
    bg: 'var(--sky-100)',
    text: 'var(--color-text-muted)',
    label: 'Wait',
  },
};

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

  if (s.toDateString() === e.toDateString()) {
    return s.toLocaleDateString(undefined, opts);
  }
  return `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, opts)}`;
}

/**
 * Key Signal card with expandable signal history.
 */
function SignalHistoryCard({
  signalColor,
  headline,
  groups,
  hasHistory,
  symbol,
}: {
  signalColor: SignalColor;
  headline: string;
  groups: BriefGroup[];
  hasHistory: boolean;
  symbol: string;
}) {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div
      className="vela-card"
      style={{
        marginBottom: 'var(--space-4)',
        backgroundColor: signalBg[signalColor],
        cursor: hasHistory ? 'pointer' : 'default',
        padding: 0,
      }}
    >
      {/* Always-visible: signal title + bold headline */}
      <div
        role={hasHistory ? 'button' : undefined}
        tabIndex={hasHistory ? 0 : undefined}
        onClick={() => hasHistory && setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (hasHistory && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
        style={{
          padding: 'var(--space-5)',
          paddingBottom: hasHistory ? 'var(--space-3)' : 'var(--space-5)',
          cursor: hasHistory ? 'pointer' : 'default',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <SectionLabel style={{ marginBottom: 0 }}>
            Key Signal — {signalTitles[signalColor]}
          </SectionLabel>
          {hasHistory && (
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              style={{
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform var(--motion-normal) var(--motion-ease-out)',
              }}
            >
              <path
                d="M3 6L8 11L13 6"
                style={{ stroke: 'var(--gray-400)' }}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>
        <p
          className="vela-heading-base"
          style={{
            marginTop: 'var(--space-2)',
            fontWeight: 'var(--weight-bold)',
            fontSize: '0.92rem',
            color: 'var(--color-text-primary)',
            lineHeight: 1.45,
          }}
        >
          {headline}
        </p>
      </div>

      {/* Expandable: signal history timeline */}
      {expanded && hasHistory && (
        <div
          style={{
            borderTop: '1.5px solid rgba(0,0,0,0.08)',
            padding: 'var(--space-3) var(--space-5) var(--space-4)',
          }}
        >
          <span
            className="vela-label-sm"
            style={{
              textTransform: 'uppercase',
              color: 'var(--color-text-muted)',
              display: 'block',
              marginBottom: 'var(--space-2)',
              fontSize: '0.62rem',
            }}
          >
            Signal history
          </span>
          <div className="vela-stack" style={{ gap: 'var(--space-2)' }}>
            {groups.map((group, gi) => {
              const gc = group.signalColor
                ? groupColorMap[group.signalColor]
                : groupColorMap.grey;
              const leadBrief = group.briefs[0];
              const isFirst = gi === 0;

              return (
                <div
                  key={gi}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    padding: 'var(--space-1) 0',
                  }}
                >
                  {/* Signal badge */}
                  <span
                    style={{
                      fontSize: '0.55rem',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      color: gc.text,
                      backgroundColor: gc.bg,
                      border: `1.5px solid ${gc.border}`,
                      borderRadius: '4px',
                      padding: '2px var(--space-2)',
                      lineHeight: 1.3,
                      flexShrink: 0,
                      minWidth: 32,
                      textAlign: 'center',
                    }}
                  >
                    {gc.label}
                  </span>

                  {/* Headline */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span
                      className="vela-body-sm"
                      style={{
                        fontWeight: 'var(--weight-semibold)',
                        color: 'var(--color-text-primary)',
                        lineHeight: 1.35,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        display: 'block',
                        fontSize: '0.72rem',
                      }}
                    >
                      {stripAssetPrefix(leadBrief.headline, symbol)}
                    </span>
                  </div>

                  {/* Date */}
                  <span
                    className="vela-body-sm"
                    style={{
                      fontSize: '0.58rem',
                      color: 'var(--gray-400)',
                      flexShrink: 0,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {isFirst
                      ? `${new Date(group.dateRange[0]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – Ongoing`
                      : formatDateRange(group.dateRange[0], group.dateRange[1])}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
