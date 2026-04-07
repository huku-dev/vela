import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/VelaComponents';
import SignalChip from '../components/SignalChip';
import { useDashboard } from '../hooks/useData';
import { breakIntoParagraphs, formatPrice, getCoinIcon } from '../lib/helpers';
import type { SignalColor } from '../types';

// ── Market Pulse indicator config ──

interface MarketPulseEntry {
  value: number;
  label: string;
}

interface MarketPulseData {
  fetchedAt?: string;
  cryptoSentiment?: MarketPulseEntry;
  stockMarketFear?: MarketPulseEntry;
  interestRates?: MarketPulseEntry;
  dollarStrength?: MarketPulseEntry;
  overallMood?: MarketPulseEntry;
}

const PULSE_INDICATORS = [
  {
    key: 'cryptoSentiment' as const,
    label: 'Crypto sentiment',
    info: 'Measures how optimistic or fearful crypto investors are feeling, on a scale from 0 (extreme fear) to 100 (extreme greed). Based on volatility, momentum, social media, and surveys.',
  },
  {
    key: 'stockMarketFear' as const,
    label: 'Stock market fear',
    info: 'The VIX index measures how much volatility stock market investors expect over the next 30 days. Lower numbers mean calmer markets. Above 30 signals significant fear.',
  },
  {
    key: 'interestRates' as const,
    label: 'Interest rates (10Y)',
    info: 'The yield on US 10-year Treasury bonds. Higher rates make borrowing more expensive and can weigh on stocks and crypto. Lower rates tend to support riskier assets.',
  },
  {
    key: 'dollarStrength' as const,
    label: 'US dollar strength',
    info: 'The Dollar Index (DXY) measures the US dollar against major currencies. A stronger dollar can pressure commodities and international stocks. A weaker dollar tends to help gold and crypto.',
  },
  {
    key: 'overallMood' as const,
    label: 'Overall market mood',
    info: 'CNN Fear & Greed Index combines seven market signals into a single score from 0 (extreme fear) to 100 (extreme greed). Covers stocks, bonds, and options sentiment.',
  },
];

// Determine color for market pulse value labels
function pulseColor(key: string, value: number): string {
  switch (key) {
    case 'cryptoSentiment':
    case 'overallMood':
      if (value >= 55) return 'var(--color-status-buy-text)';
      if (value <= 35) return 'var(--color-status-sell-text)';
      return 'var(--color-text-primary)';
    case 'stockMarketFear':
      // VIX: low = calm (green), high = fear (red)
      if (value <= 20) return 'var(--color-status-buy-text)';
      if (value >= 30) return 'var(--color-status-sell-text)';
      return 'var(--color-text-primary)';
    case 'dollarStrength':
      // DXY: weakening can be bullish for assets
      if (value <= 100) return 'var(--color-status-buy-text)';
      if (value >= 105) return 'var(--color-status-sell-text)';
      return 'var(--color-text-primary)';
    default:
      return 'var(--color-text-primary)';
  }
}

// ── Info tooltip component (reuses existing pattern from TradeConfirmationSheet) ──

function InfoIcon({ tooltip }: { tooltip: string }) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <span
        role="button"
        tabIndex={0}
        title={tooltip}
        onClick={e => {
          e.stopPropagation();
          setShowTooltip(!showTooltip);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            setShowTooltip(!showTooltip);
          }
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 16,
          height: 16,
          borderRadius: '50%',
          border: '1.5px solid var(--gray-300)',
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--color-text-muted)',
          cursor: 'help',
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        i
      </span>
      {showTooltip && (
        <span
          className="vela-body-xs"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--ink)',
            color: 'var(--white)',
            padding: '8px 12px',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-xs)',
            lineHeight: 1.4,
            width: 220,
            zIndex: 10,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          }}
        >
          {tooltip}
        </span>
      )}
    </span>
  );
}

// ── Page component ──

export default function DailyBrief() {
  const navigate = useNavigate();
  const { data, digest, loading } = useDashboard();

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
        <span className="vela-body-sm vela-text-muted">Loading brief...</span>
      </div>
    );
  }

  if (!digest) {
    return (
      <div style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
        <span className="vela-body-sm vela-text-muted">No daily brief available yet.</span>
      </div>
    );
  }

  const digestText = digest.summary || digest.context || '';
  const paragraphs = breakIntoParagraphs(digestText);
  const briefDate = new Date(digest.created_at).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  // Market pulse from embedded detail (Option C: snapshot at generation time)
  const marketPulse: MarketPulseData =
    (digest.detail as { marketPulse?: MarketPulseData })?.marketPulse ?? {};
  const hasPulse = Object.keys(marketPulse).some(
    k => k !== 'fetchedAt' && marketPulse[k as keyof MarketPulseData]
  );
  const pulseAge = marketPulse.fetchedAt
    ? Math.round((Date.now() - new Date(marketPulse.fetchedAt).getTime()) / (1000 * 60 * 60))
    : null;

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      {/* ← Back */}
      <span
        className="vela-body-sm"
        role="button"
        tabIndex={0}
        onClick={() => navigate('/')}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') navigate('/');
        }}
        style={{
          cursor: 'pointer',
          color: 'var(--color-text-muted)',
          display: 'inline-block',
          marginBottom: 'var(--space-4)',
        }}
      >
        &larr; Back
      </span>

      {/* Heading */}
      <h1
        className="vela-heading-lg"
        style={{ marginBottom: 'var(--space-1)', fontFamily: "'Space Grotesk', sans-serif" }}
      >
        Daily Brief
      </h1>
      <span
        className="vela-body-sm vela-text-muted"
        style={{ display: 'block', marginBottom: 'var(--space-5)' }}
      >
        {briefDate}
      </span>

      {/* Narrative paragraphs */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        {paragraphs.map((p, i) => (
          <p
            key={i}
            className="vela-body-sm"
            style={{
              color: 'var(--color-text-secondary)',
              lineHeight: 1.7,
              marginBottom: i < paragraphs.length - 1 ? 'var(--space-4)' : 0,
            }}
          >
            {p}
          </p>
        ))}
      </div>

      {/* Market Pulse */}
      {hasPulse && (
        <Card style={{ marginBottom: 'var(--space-6)', padding: 0, overflow: 'hidden' }}>
          <div
            style={{
              padding: 'var(--space-3) var(--space-4)',
              borderBottom: '2px solid var(--ink)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span
              className="vela-label-sm"
              style={{
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 700,
              }}
            >
              Market Pulse
            </span>
            {pulseAge != null && (
              <span className="vela-body-xs vela-text-muted">
                {pulseAge < 1
                  ? 'Just now'
                  : pulseAge < 24
                    ? `${pulseAge}h ago`
                    : `${Math.round(pulseAge / 24)}d ago`}
              </span>
            )}
          </div>
          <div>
            {PULSE_INDICATORS.map((indicator, idx) => {
              const entry = marketPulse[indicator.key];
              if (!entry) return null;
              return (
                <div
                  key={indicator.key}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: 'var(--space-3) var(--space-4)',
                    borderBottom:
                      idx < PULSE_INDICATORS.length - 1 ? '1px solid var(--gray-200)' : 'none',
                  }}
                >
                  <span
                    className="vela-body-sm"
                    style={{
                      color: 'var(--color-text-secondary)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    {indicator.label}
                    <InfoIcon tooltip={indicator.info} />
                  </span>
                  <span
                    className="vela-body-sm"
                    style={{
                      fontWeight: 600,
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 'var(--text-sm)',
                      color: pulseColor(indicator.key, entry.value),
                    }}
                  >
                    {entry.label}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Signal Summary */}
      {data.length > 0 && (
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <span
            className="vela-label-sm"
            style={{
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 700,
              display: 'block',
              marginBottom: 'var(--space-3)',
            }}
          >
            Signal Summary
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {data.map(item => (
              <div
                key={item.asset.id}
                onClick={() => navigate(`/asset/${item.asset.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') navigate(`/asset/${item.asset.id}`);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: 'var(--white)',
                  border: '2px solid var(--ink)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: '2px 2px 0 var(--ink)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {(() => {
                    const iconUrl = item.asset.icon_url ?? (item.asset.coingecko_id ? getCoinIcon(item.asset.coingecko_id) : null);
                    return iconUrl ? (
                      <img
                        src={iconUrl}
                        alt={item.asset.symbol}
                        width={20}
                        height={20}
                        style={{ borderRadius: '50%', flexShrink: 0 }}
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <span
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          background: 'var(--gray-200)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 10,
                          fontWeight: 700,
                          color: 'var(--color-text-muted)',
                          flexShrink: 0,
                        }}
                      >
                        {item.asset.symbol.slice(0, 2)}
                      </span>
                    );
                  })()}
                  <span
                    style={{
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  >
                    {item.asset.name}
                  </span>
                  <span className="vela-body-xs vela-text-muted" style={{ fontSize: 11 }}>
                    {item.asset.symbol}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {item.priceData && (
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      {formatPrice(item.priceData.price)}
                    </span>
                  )}
                  {item.signal && (
                    <SignalChip color={item.signal.signal_color as SignalColor} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
