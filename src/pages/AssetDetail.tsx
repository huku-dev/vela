import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
import { useAssetDetail } from '../hooks/useData';
import {
  breakIntoParagraphs,
  formatPrice,
  getCoinIcon,
  stripAssetPrefix,
  groupBriefsBySignalState,
} from '../lib/helpers';
import type { SignalColor, BriefGroup } from '../types';

const signalTitles: Record<SignalColor, string> = {
  green: 'Buy Signal',
  red: 'Exit Signal',
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
  const { asset, signal, brief, recentBriefs, priceData, signalLookup, loading } = useAssetDetail(assetId!);

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

      {/* Tier 1: Key Signal — signal color as section title */}
      {brief && (
        <Card
          sx={{
            mb: 2,
            backgroundColor: signalBg[signalColor],
            border: '2.5px solid #1A1A1A',
            boxShadow: '4px 4px 0px #1A1A1A',
          }}
        >
          <CardContent sx={{ p: 2.5 }}>
            <Typography
              sx={{
                fontWeight: 800,
                fontSize: '0.65rem',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: '#6B7280',
                mb: 0.75,
              }}
            >
              Key Signal — {signalTitles[signalColor]}
            </Typography>
            <Typography
              sx={{ fontWeight: 700, fontSize: '1.05rem', color: '#1A1A1A', lineHeight: 1.5 }}
            >
              {stripAssetPrefix(brief.headline, asset.symbol)}
            </Typography>
          </CardContent>
        </Card>
      )}

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
                <SubLabel>Technical Analysis</SubLabel>
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
                      {value as string}
                    </Box>
                  ))}
                </Box>
              </Box>
            )}

            <Divider />

            {/* Market Context — with Fear & Greed gauge */}
            {detail.market_context && (
              <Box sx={{ mb: 2 }}>
                <SubLabel>Market Context</SubLabel>

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
                      {value as string}
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

                // Derive Plain English descriptions
                const trendLabel =
                  currentPrice > ema9 && currentPrice > ema21
                    ? 'Above short & medium averages'
                    : currentPrice > ema9
                      ? 'Above short-term, below medium-term average'
                      : currentPrice > ema21
                        ? 'Below short-term, above medium-term average'
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
                  rsi >= 70 ? '#DC2626' : rsi >= 60 ? '#15803D' : rsi >= 40 ? '#6B7280' : rsi >= 30 ? '#92400E' : '#DC2626';

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

                return (
                  <Box sx={{ mb: 2 }}>
                    <SubLabel>Indicators</SubLabel>
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
                        label="Momentum"
                        description={`${rsiLabel} (${rsi.toFixed(0)})`}
                        color={rsiColor}
                        tooltip="Measures buying vs selling pressure on a 0-100 scale. Above 70 means overbought (may pull back), below 30 means oversold (may bounce)."
                      />

                      <IndicatorRow
                        label="Trend strength"
                        description={`${adxLabel} (${adx.toFixed(0)})`}
                        color={adxColor}
                        tooltip="Measures how strong the current trend is, regardless of direction. Above 25 means a clear trend exists; below 15 means the market is drifting sideways."
                      />

                      <IndicatorRow
                        label="Longer-term trend"
                        description={`${smaLabel} (${smaDist >= 0 ? '+' : ''}${smaDist.toFixed(1)}%)`}
                        color={smaColor}
                        tooltip="Compares the current price to its 50-day average. Being above it generally indicates a healthy medium-term trend; being below may signal weakness."
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
                        {detail.what_would_change}
                      </Typography>
                    )}
                  </Box>
                );
              })()}
          </AccordionDetails>
        </Accordion>
      )}

      {/* Recent Updates — grouped by signal state */}
      {recentBriefs.length > 1 &&
        (() => {
          const groups = groupBriefsBySignalState(
            recentBriefs.slice(1),
            signalLookup as Record<string, SignalColor>,
            signalColor
          );
          if (!groups.length) return null;
          return (
            <Box sx={{ mt: 3 }}>
              <SectionLabel sx={{ px: 0.5, mb: 1.5 }}>Recent Updates</SectionLabel>
              {groups.map((group, gi) => (
                <RecentUpdateGroup
                  key={gi}
                  group={group}
                  symbol={asset.symbol}
                  defaultExpanded={gi === 0}
                />
              ))}
            </Box>
          );
        })()}

      {/* Timestamp — use latest brief date (more meaningful than signal creation date) */}
      {brief && (
        <Typography sx={{ textAlign: 'center', mt: 3, color: '#9CA3AF', fontSize: '0.68rem' }}>
          Last updated: {new Date(brief.created_at).toLocaleString()}
        </Typography>
      )}
    </Box>
  );
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
const groupColorMap: Record<SignalColor, { border: string; bg: string; text: string; label: string }> = {
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

function daysBetween(start: string, end: string): number {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)));
}

function RecentUpdateGroup({
  group,
  symbol,
  defaultExpanded,
}: {
  group: BriefGroup;
  symbol: string;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  const colors = group.signalColor ? groupColorMap[group.signalColor] : groupColorMap.grey;
  const isSignalChange = group.type === 'signal_change';
  const days = daysBetween(group.dateRange[0], group.dateRange[1]);
  const count = group.briefs.length;

  // The first brief in a signal_change group is the change event itself
  const leadBrief = group.briefs[0];

  return (
    <Box
      sx={{
        mb: 1.5,
        borderRadius: '8px',
        border: isSignalChange ? '2px solid #1A1A1A' : '1.5px solid #E5E7EB',
        borderLeft: `4px solid ${colors.border}`,
        boxShadow: isSignalChange ? '3px 3px 0px #1A1A1A' : 'none',
        overflow: 'hidden',
        backgroundColor: '#FFFFFF',
      }}
    >
      {/* Group header — always visible, clickable to expand */}
      <Box
        onClick={() => setExpanded(!expanded)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          p: 1.5,
          cursor: 'pointer',
          '&:hover': { backgroundColor: '#FAFAFA' },
          transition: 'background-color 0.15s',
        }}
      >
        {/* Signal badge */}
        <Box
          sx={{
            fontSize: '0.6rem',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: colors.text,
            backgroundColor: colors.bg,
            border: `1.5px solid ${colors.border}`,
            borderRadius: '4px',
            px: 0.75,
            py: 0.25,
            lineHeight: 1.3,
            flexShrink: 0,
          }}
        >
          {colors.label}
        </Box>

        {/* Group title */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            sx={{
              fontSize: '0.78rem',
              fontWeight: isSignalChange ? 700 : 600,
              color: '#1A1A1A',
              lineHeight: 1.4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {isSignalChange
              ? stripAssetPrefix(leadBrief.headline, symbol)
              : count === 1
                ? stripAssetPrefix(leadBrief.headline, symbol)
                : `${count} updates over ${days} day${days !== 1 ? 's' : ''}`}
          </Typography>
          <Typography sx={{ fontSize: '0.62rem', color: '#9CA3AF', mt: 0.15 }}>
            {formatDateRange(group.dateRange[0], group.dateRange[1])}
          </Typography>
        </Box>

        {/* Expand/collapse chevron */}
        {count > 1 && (
          <ExpandMoreIcon
            sx={{
              fontSize: '1rem',
              color: '#9CA3AF',
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
              flexShrink: 0,
            }}
          />
        )}
      </Box>

      {/* Expanded content — latest summary + timeline */}
      {expanded && (
        <Box sx={{ borderTop: '1px solid #E5E7EB' }}>
          {/* Latest analysis — the most recent brief's summary */}
          {leadBrief.summary && (
            <Box sx={{ px: 1.5, pt: 1.25, pb: count > 1 ? 0.5 : 1.25 }}>
              <Typography
                sx={{
                  fontSize: '0.74rem',
                  color: '#374151',
                  lineHeight: 1.6,
                }}
              >
                {leadBrief.summary}
              </Typography>
            </Box>
          )}

          {/* Timeline — compact list of all updates in this group */}
          {count > 1 && (
            <Box sx={{ px: 1.5, pb: 1 }}>
              <Typography
                sx={{
                  fontSize: '0.6rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: '#9CA3AF',
                  mt: 0.75,
                  mb: 0.5,
                }}
              >
                Timeline
              </Typography>
              {group.briefs.map((b, bi) => (
                <Box
                  key={b.id}
                  sx={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 1,
                    py: 0.5,
                    borderBottom:
                      bi < group.briefs.length - 1 ? '1px solid #F3F4F6' : 'none',
                  }}
                >
                  <Typography
                    sx={{
                      fontSize: '0.62rem',
                      color: '#9CA3AF',
                      flexShrink: 0,
                      minWidth: 56,
                    }}
                  >
                    {new Date(b.created_at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: '0.72rem',
                      color: '#1A1A1A',
                      fontWeight: bi === 0 ? 600 : 400,
                      lineHeight: 1.4,
                      flex: 1,
                    }}
                  >
                    {stripAssetPrefix(b.headline, symbol)}
                    {b.brief_type === 'signal_change' && (
                      <Box
                        component="span"
                        sx={{
                          ml: 0.75,
                          fontSize: '0.55rem',
                          fontWeight: 700,
                          color: colors.text,
                          textTransform: 'uppercase',
                          verticalAlign: 'middle',
                        }}
                      >
                        Signal change
                      </Box>
                    )}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
