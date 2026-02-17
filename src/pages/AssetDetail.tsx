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
import { breakIntoParagraphs, formatPrice, indicatorLabels, getCoinIcon } from '../lib/helpers';
import type { SignalColor } from '../types';

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
  const { asset, signal, brief, recentBriefs, priceData, loading } = useAssetDetail(assetId!);

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

        <Box sx={{ textAlign: 'right' }}>
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
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                justifyContent: 'flex-end',
                mt: 0.25,
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
              {brief.headline}
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

            {/* Indicators — with spelled-out labels */}
            {indicators && (
              <Box sx={{ mb: 2 }}>
                <SubLabel>Indicators</SubLabel>
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: '0.73rem',
                    p: 1.5,
                    backgroundColor: '#F9FAFB',
                    border: '1.5px solid #E5E7EB',
                    borderRadius: '8px',
                  }}
                >
                  {Object.entries(indicators).map(([key, value]) => {
                    const label = indicatorLabels[key] || key;
                    const formatted =
                      (value as number) >= 1000
                        ? `$${(value as number).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                        : (value as number) < 100
                          ? (value as number).toFixed(1)
                          : `$${(value as number).toFixed(0)}`;
                    return (
                      <Box
                        key={key}
                        sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          color: '#374151',
                          py: 0.25,
                        }}
                      >
                        <span style={{ color: '#6B7280', fontSize: '0.68rem' }}>{label}</span>
                        <span style={{ fontWeight: 600 }}>{formatted}</span>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            )}

            {/* What would change */}
            {detail.what_would_change && (
              <Box>
                <SubLabel>What would change this signal</SubLabel>
                <Typography sx={{ fontSize: '0.82rem', color: '#374151', lineHeight: 1.6 }}>
                  {detail.what_would_change}
                </Typography>
              </Box>
            )}
          </AccordionDetails>
        </Accordion>
      )}

      {/* Recent Updates */}
      {recentBriefs.length > 1 && (
        <Box sx={{ mt: 3 }}>
          <SectionLabel sx={{ px: 0.5, mb: 1.5 }}>Recent Updates</SectionLabel>
          {recentBriefs.slice(1).map(b => (
            <Card key={b.id} sx={{ mb: 1.5 }}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Typography
                  sx={{ fontSize: '0.82rem', color: '#1A1A1A', fontWeight: 600, mb: 0.5 }}
                >
                  {b.headline}
                </Typography>
                <Typography sx={{ fontSize: '0.65rem', color: '#9CA3AF' }}>
                  {new Date(b.created_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {' · '}
                  {b.brief_type === 'signal_change' ? 'Signal change' : 'Update'}
                </Typography>
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      {/* Timestamp */}
      {signal && (
        <Typography sx={{ textAlign: 'center', mt: 3, color: '#9CA3AF', fontSize: '0.68rem' }}>
          Last signal: {new Date(signal.timestamp).toLocaleString()}
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
