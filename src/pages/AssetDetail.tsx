import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
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
  green: '#DCFCE7',
  red: '#FEE2E2',
  grey: '#DBEAFE',
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
      <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
        <CircularProgress size={28} sx={{ color: '#1A1A1A' }} />
      </Box>
    );
  }

  if (!asset) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="error">Asset not found</Typography>
      </Box>
    );
  }

  const price = priceData?.price ?? signal?.price_at_signal;
  const change24h = priceData?.change24h;
  const signalColor = signal?.signal_color || 'grey';
  const detail = brief?.detail;
  const indicators = detail?.indicators;

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
    <Box sx={{ p: 2, pb: 10, maxWidth: 600, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3, mt: 1 }}>
        <IconButton
          onClick={() => navigate('/')}
          sx={{
            border: '2px solid #1A1A1A',
            borderRadius: '8px',
            boxShadow: '2px 2px 0px #1A1A1A',
            width: 36,
            height: 36,
            '&:active': { transform: 'translate(1px, 1px)', boxShadow: '1px 1px 0px #1A1A1A' },
          }}
        >
          <ArrowBackIcon sx={{ fontSize: '1rem', color: '#1A1A1A' }} />
        </IconButton>

        {/* Asset icon */}
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            border: '2px solid #1A1A1A',
            overflow: 'hidden',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#F3F4F6',
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
            <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: '#1A1A1A' }}>
              {asset.symbol.charAt(0)}
            </Typography>
          )}
        </Box>

        <Box sx={{ flex: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="h5">{asset.symbol}</Typography>
            <SignalChip color={signalColor} size="small" />
          </Box>
          <Typography sx={{ fontSize: '0.75rem', color: '#6B7280' }}>{asset.name}</Typography>
        </Box>

        <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
          <Typography
            sx={{
              fontFamily: '"JetBrains Mono", monospace',
              fontWeight: 700,
              fontSize: '1.1rem',
              color: '#1A1A1A',
              lineHeight: 1.2,
            }}
          >
            {formatPrice(price)}
          </Typography>
          {change24h != null && (
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.5,
                justifyContent: 'flex-end',
                mt: 0.25,
                whiteSpace: 'nowrap',
              }}
            >
              <PriceArrow change24h={change24h} />
              <Typography
                sx={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontWeight: 600,
                  fontSize: '0.7rem',
                  color: change24h >= 0 ? '#15803D' : '#DC2626',
                  lineHeight: 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {Math.abs(change24h).toFixed(1)}% 24h
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

      {/* Email action result banner */}
      {actionBanner && (
        <Box
          sx={{
            mb: 2,
            p: 2,
            borderRadius: '10px',
            border: '2px solid #1A1A1A',
            boxShadow: '3px 3px 0px #1A1A1A',
            backgroundColor: actionBanner.includes('approved') ? '#DCFCE7' : '#DBEAFE',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Typography sx={{ fontWeight: 600, fontSize: '0.85rem' }}>
            {actionBanner.includes('approved') ? '✅' : '❌'} {actionBanner}
          </Typography>
          <Box
            component="button"
            onClick={() => setActionBanner(null)}
            sx={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '1rem',
              color: '#6B7280',
              p: 0,
            }}
          >
            ×
          </Box>
        </Box>
      )}

      {/* Pending trade proposals */}
      {pendingProposals.map(proposal => (
        <Box key={proposal.id} sx={{ mb: 2 }}>
          <TradeProposalCard
            proposal={proposal}
            assetSymbol={asset.symbol}
            onAccept={acceptProposal}
            onDecline={declineProposal}
          />
        </Box>
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
        <Card sx={{ mb: 2 }}>
          <CardContent sx={{ p: 2.5 }}>
            <SectionLabel>What&apos;s happening</SectionLabel>
            {summaryParagraphs.map((para, i) => (
              <Typography
                key={i}
                sx={{
                  fontSize: '0.88rem',
                  color: '#374151',
                  lineHeight: 1.7,
                  mb: i < summaryParagraphs.length - 1 ? 1.25 : 0,
                }}
              >
                {para}
              </Typography>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Tier 3: Why we think this — collapsible, with bullet points */}
      {detail && (
        <Accordion sx={{ mb: 2 }}>
          <AccordionSummary
            expandIcon={<ExpandMoreIcon sx={{ color: '#1A1A1A' }} />}
            sx={{ px: 2.5, minHeight: 48, '& .MuiAccordionSummary-content': { my: 1 } }}
          >
            <SectionLabel sx={{ mb: 0 }}>Why we think this</SectionLabel>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 2.5, pt: 0, pb: 2.5 }}>
            {/* Signal Breakdown — as bullet list */}
            {detail.signal_breakdown && Object.keys(detail.signal_breakdown).length > 0 && (
              <Box sx={{ mb: 2 }}>
                <SubLabel>Technical analysis</SubLabel>
                <Box component="ul" sx={{ m: 0, pl: 2.5, listStyle: 'disc' }}>
                  {Object.entries(detail.signal_breakdown).map(([key, value]) => (
                    <Box
                      component="li"
                      key={key}
                      sx={{
                        fontSize: '0.82rem',
                        color: '#374151',
                        mb: 0.75,
                        lineHeight: 1.6,
                        '&::marker': { color: '#1A1A1A' },
                      }}
                    >
                      {(() => {
                        const t = plainEnglish(value as string);
                        return t.charAt(0).toUpperCase() + t.slice(1);
                      })()}
                    </Box>
                  ))}
                </Box>
              </Box>
            )}

            <Divider />

            {/* Market Context — with Fear & Greed gauge */}
            {detail.market_context && (
              <Box sx={{ mb: 2 }}>
                <SubLabel>Market context</SubLabel>

                {/* Fear & Greed gauge if available */}
                {fearGreedValue != null && (
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'center',
                      my: 2,
                      p: 1.5,
                      border: '2.5px solid #1A1A1A',
                      borderRadius: '10px',
                      boxShadow: '3px 3px 0px #1A1A1A',
                      backgroundColor: '#FAFAFA',
                    }}
                  >
                    <FearGreedGauge value={fearGreedValue} label={fearGreedLabel} />
                  </Box>
                )}

                {/* Other context items as bullets */}
                <Box component="ul" sx={{ m: 0, pl: 2.5, listStyle: 'disc' }}>
                  {Object.entries(detail.market_context).map(([key, value]) => (
                    <Box
                      component="li"
                      key={key}
                      sx={{
                        fontSize: '0.82rem',
                        color: '#374151',
                        mb: 0.5,
                        lineHeight: 1.6,
                        '&::marker': { color: '#1A1A1A' },
                      }}
                    >
                      {(() => {
                        const t = value as string;
                        return t.charAt(0).toUpperCase() + t.slice(1);
                      })()}
                    </Box>
                  ))}
                </Box>
              </Box>
            )}

            <Divider />

            {/* Indicators — Plain English, relative to price */}
            {indicators &&
              (() => {
                const currentPrice = price ?? 0;
                const ema9 = indicators.ema_9;
                const ema21 = indicators.ema_21;
                const rsi = indicators.rsi_14;
                const adx = indicators.adx_4h;
                const sma50 = indicators.sma_50_daily;

                // Find oldest brief with indicators for delta comparison
                const oldestWithIndicators = [...recentBriefs]
                  .reverse()
                  .find(b => b.detail?.indicators && b.id !== brief?.id);
                const oldInd = oldestWithIndicators?.detail?.indicators;

                // Compute deltas (current - oldest)
                const rsiDelta = oldInd ? rsi - oldInd.rsi_14 : null;
                const adxDelta = oldInd ? adx - oldInd.adx_4h : null;

                // Compute timeframe label for delta context
                const deltaLabel = oldestWithIndicators
                  ? (() => {
                      const diffMs =
                        new Date(brief!.created_at).getTime() -
                        new Date(oldestWithIndicators.created_at).getTime();
                      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
                      return diffDays <= 1 ? 'vs yesterday' : `vs ${diffDays} days ago`;
                    })()
                  : null;

                // Convert "vs yesterday" → "in the last day", "vs 5 days ago" → "in the last 5 days"
                const tooltipTimeframe = deltaLabel
                  ? deltaLabel === 'vs yesterday'
                    ? 'in the last day'
                    : `in the last ${deltaLabel.replace('vs ', '').replace(' ago', '')}`
                  : null;

                // Derive Plain English descriptions
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
                    ? '#15803D'
                    : currentPrice < ema9 && currentPrice < ema21
                      ? '#DC2626'
                      : '#92400E';

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
                    ? '#DC2626'
                    : rsi >= 60
                      ? '#15803D'
                      : rsi >= 40
                        ? '#6B7280'
                        : rsi >= 30
                          ? '#92400E'
                          : '#DC2626';

                const adxLabel =
                  adx >= 50
                    ? 'Very strong trend'
                    : adx >= 25
                      ? 'Trending'
                      : adx >= 15
                        ? 'Weak trend'
                        : 'No clear trend';
                const adxColor = adx >= 25 ? '#15803D' : adx >= 15 ? '#92400E' : '#6B7280';

                const smaLabel =
                  currentPrice > sma50 ? 'Above 50-day average' : 'Below 50-day average';
                const smaColor = currentPrice > sma50 ? '#15803D' : '#DC2626';
                const smaDist = currentPrice && sma50 ? ((currentPrice - sma50) / sma50) * 100 : 0;

                // Dynamic tooltips — append current value + trend context
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
                  <Box sx={{ mb: 2 }}>
                    <Box sx={{ mb: 0.5 }}>
                      <Typography sx={{ fontWeight: 700, fontSize: '0.72rem', color: '#1A1A1A' }}>
                        Momentum indicators
                      </Typography>
                    </Box>
                    <Box
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                        p: 1.5,
                        backgroundColor: '#F9FAFB',
                        border: '1.5px solid #E5E7EB',
                        borderRadius: '8px',
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
                    </Box>
                  </Box>
                );
              })()}

            {/* Price level triggers — context-aware based on current price */}
            {indicators &&
              (() => {
                const cp = price ?? 0;
                const bullLevel = Math.max(indicators.ema_9, indicators.ema_21);
                const bearLevel = indicators.sma_50_daily;
                const aboveBull = cp > bullLevel;
                const belowBear = cp < bearLevel;

                return (
                  <Box>
                    <SubLabel>Key price levels to watch</SubLabel>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
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
                    </Box>
                    {detail.what_would_change && (
                      <Typography
                        sx={{
                          fontSize: '0.75rem',
                          color: '#6B7280',
                          lineHeight: 1.6,
                          mt: 1.5,
                          fontStyle: 'italic',
                        }}
                      >
                        {parsePriceSegments(plainEnglish(detail.what_would_change)).map((seg, i) =>
                          seg.type === 'price' ? (
                            <Box
                              component="span"
                              key={i}
                              sx={{
                                fontFamily: '"JetBrains Mono", monospace',
                                fontWeight: 600,
                                fontStyle: 'normal',
                                color: '#1A1A1A',
                                backgroundColor: '#F3F4F6',
                                borderRadius: '4px',
                                px: 0.5,
                                py: 0.1,
                              }}
                            >
                              {seg.value}
                            </Box>
                          ) : (
                            <React.Fragment key={i}>{seg.value}</React.Fragment>
                          )
                        )}
                      </Typography>
                    )}
                  </Box>
                );
              })()}
          </AccordionDetails>
        </Accordion>
      )}

      {/* Timestamp — show signal check recency + brief age */}
      {(signal || brief) && (
        <Typography sx={{ textAlign: 'center', mt: 3, color: '#9CA3AF', fontSize: '0.68rem' }}>
          {signal && <>Signal checked {formatTimeAgo(signal.created_at)}</>}
          {signal && brief && ' · '}
          {brief && <>Analysis written {formatTimeAgo(brief.created_at)}</>}
        </Typography>
      )}
    </Box>
  );
}

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

function SectionLabel({ children, sx = {} }: { children: React.ReactNode; sx?: object }) {
  return (
    <Typography
      sx={{
        fontWeight: 800,
        fontSize: '0.7rem',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: '#6B7280',
        display: 'block',
        mb: 1,
        ...sx,
      }}
    >
      {children}
    </Typography>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{ fontWeight: 700, fontSize: '0.72rem', color: '#1A1A1A', mb: 0.5 }}>
      {children}
    </Typography>
  );
}

function Divider() {
  return <Box sx={{ borderTop: '2px solid #E5E7EB', my: 1.5 }} />;
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
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography sx={{ fontSize: '0.72rem', color: '#6B7280' }}>{label}</Typography>
          <Box
            component="span"
            onClick={() => setShowTip(!showTip)}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 14,
              height: 14,
              borderRadius: '50%',
              border: '1px solid #D1D5DB',
              fontSize: '0.55rem',
              fontWeight: 700,
              color: '#9CA3AF',
              cursor: 'pointer',
              flexShrink: 0,
              '&:hover': { borderColor: '#6B7280', color: '#6B7280' },
            }}
          >
            ?
          </Box>
        </Box>
        <Typography
          sx={{
            fontSize: '0.72rem',
            fontWeight: 600,
            color,
          }}
        >
          {description}
        </Typography>
      </Box>
      {showTip && (
        <Typography
          sx={{
            fontSize: '0.65rem',
            color: '#6B7280',
            backgroundColor: '#F3F4F6',
            borderRadius: '6px',
            p: 0.75,
            mt: 0.5,
            lineHeight: 1.5,
          }}
        >
          {tooltip}
        </Typography>
      )}
    </Box>
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
  /** true = price has already crossed this level */
  active?: boolean;
}) {
  const isBull = direction === 'bullish';
  const color = isBull ? '#15803D' : '#DC2626';
  const bg = isBull ? '#DCFCE7' : '#FEE2E2';

  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1.5,
        alignItems: 'flex-start',
        p: 1.5,
        borderRadius: '10px',
        border: '2px solid #1A1A1A',
        boxShadow: '3px 3px 0px #1A1A1A',
        backgroundColor: bg,
      }}
    >
      {/* Neobrutalist direction icon — matches PriceArrow style */}
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          borderRadius: '6px',
          border: '2px solid #1A1A1A',
          backgroundColor: '#FFFFFF',
          flexShrink: 0,
          mt: 0.25,
        }}
      >
        <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
          {isBull ? (
            <polygon points="6,0 12,10 0,10" fill={color} stroke="#1A1A1A" strokeWidth="1" />
          ) : (
            <polygon points="6,10 12,0 0,0" fill={color} stroke="#1A1A1A" strokeWidth="1" />
          )}
        </svg>
      </Box>
      <Box sx={{ flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
          <Typography
            sx={{
              fontFamily: '"JetBrains Mono", monospace',
              fontWeight: 700,
              fontSize: '0.88rem',
              color: '#1A1A1A',
            }}
          >
            {level}
          </Typography>
          {active && (
            <Box
              component="span"
              sx={{
                fontSize: '0.58rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color,
                backgroundColor: '#FFFFFF',
                border: `1.5px solid ${color}`,
                borderRadius: '4px',
                px: 0.75,
                py: 0.15,
                lineHeight: 1.4,
              }}
            >
              {isBull ? 'Above' : 'Below'}
            </Box>
          )}
        </Box>
        <Typography sx={{ fontSize: '0.72rem', color: '#374151', lineHeight: 1.5 }}>
          {label}
        </Typography>
      </Box>
    </Box>
  );
}

/* ── Signal color mapping for group borders & badges ── */
const groupColorMap: Record<
  SignalColor,
  { border: string; bg: string; text: string; label: string }
> = {
  green: { border: '#15803D', bg: '#DCFCE7', text: '#15803D', label: 'Buy' },
  red: { border: '#DC2626', bg: '#FEE2E2', text: '#DC2626', label: 'Sell' },
  grey: { border: '#6B7280', bg: '#DBEAFE', text: '#6B7280', label: 'Wait' },
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
 * Shows the current signal status + bold headline always visible.
 * Expands to reveal a compact timeline of previous signal states.
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
    <Card
      sx={{
        mb: 2,
        backgroundColor: signalBg[signalColor],
        cursor: hasHistory ? 'pointer' : 'default',
      }}
    >
      {/* Always-visible: signal title + bold headline */}
      <CardContent
        sx={{ p: 2.5, pb: hasHistory ? 1.5 : 2.5, '&:last-child': { pb: hasHistory ? 1.5 : 2.5 } }}
        onClick={() => hasHistory && setExpanded(!expanded)}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <SectionLabel sx={{ mb: 0 }}>Key Signal — {signalTitles[signalColor]}</SectionLabel>
          {hasHistory && (
            <ExpandMoreIcon
              sx={{
                fontSize: '1.1rem',
                color: '#9CA3AF',
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
              }}
            />
          )}
        </Box>
        <Typography
          sx={{
            mt: 1,
            fontWeight: 700,
            fontSize: '0.92rem',
            color: '#1A1A1A',
            lineHeight: 1.45,
          }}
        >
          {headline}
        </Typography>
      </CardContent>

      {/* Expandable: signal history timeline */}
      {expanded && hasHistory && (
        <Box sx={{ borderTop: '1.5px solid rgba(0,0,0,0.08)', px: 2.5, pt: 1.5, pb: 2 }}>
          <Typography
            sx={{
              fontWeight: 700,
              fontSize: '0.62rem',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: '#6B7280',
              mb: 1,
            }}
          >
            Signal history
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {groups.map((group, gi) => {
              const gc = group.signalColor ? groupColorMap[group.signalColor] : groupColorMap.grey;
              const leadBrief = group.briefs[0];
              const isFirst = gi === 0;

              return (
                <Box
                  key={gi}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    py: 0.5,
                  }}
                >
                  {/* Signal badge */}
                  <Box
                    sx={{
                      fontSize: '0.55rem',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      color: gc.text,
                      backgroundColor: gc.bg,
                      border: `1.5px solid ${gc.border}`,
                      borderRadius: '4px',
                      px: 0.75,
                      py: 0.2,
                      lineHeight: 1.3,
                      flexShrink: 0,
                      minWidth: 32,
                      textAlign: 'center',
                    }}
                  >
                    {gc.label}
                  </Box>

                  {/* Headline + date range */}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      sx={{
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        color: '#1A1A1A',
                        lineHeight: 1.35,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {stripAssetPrefix(leadBrief.headline, symbol)}
                    </Typography>
                  </Box>

                  {/* Date */}
                  <Typography
                    sx={{
                      fontSize: '0.58rem',
                      color: '#9CA3AF',
                      flexShrink: 0,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {isFirst
                      ? `${new Date(group.dateRange[0]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – Ongoing`
                      : formatDateRange(group.dateRange[0], group.dateRange[1])}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}
    </Card>
  );
}
