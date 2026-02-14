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
import Divider from '@mui/material/Divider';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SignalChip from '../components/SignalChip';
import { useAssetDetail } from '../hooks/useData';

export default function AssetDetail() {
  const { assetId } = useParams<{ assetId: string }>();
  const navigate = useNavigate();
  const { asset, signal, brief, recentBriefs, loading } = useAssetDetail(assetId!);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
        <CircularProgress size={32} sx={{ color: 'text.secondary' }} />
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

  const price = signal?.price_at_signal;
  const formattedPrice = price
    ? price >= 1000
      ? `$${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
      : `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
    : '—';

  const detail = brief?.detail;
  const indicators = detail?.indicators;

  return (
    <Box sx={{ p: 2, pb: 10, maxWidth: 600, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3, mt: 1 }}>
        <IconButton onClick={() => navigate('/')} size="small" sx={{ color: 'text.secondary' }}>
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5" sx={{ color: 'text.primary' }}>
            {asset.symbol}
          </Typography>
          <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
            {asset.name}
          </Typography>
        </Box>
        <Box sx={{ textAlign: 'right' }}>
          <SignalChip color={signal?.signal_color || 'grey'} />
          <Typography
            variant="body2"
            sx={{
              mt: 0.5,
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: '0.85rem',
              color: 'text.primary',
            }}
          >
            {formattedPrice}
          </Typography>
        </Box>
      </Box>

      {/* Tier 1: Headline (always visible) */}
      {brief && (
        <Card sx={{ mb: 2 }}>
          <CardContent sx={{ p: 2.5 }}>
            <Typography
              variant="body1"
              sx={{
                color: 'text.primary',
                fontWeight: 600,
                fontSize: '1rem',
                lineHeight: 1.5,
              }}
            >
              {brief.headline}
            </Typography>
          </CardContent>
        </Card>
      )}

      {/* Tier 2: Summary */}
      {brief?.summary && (
        <Card sx={{ mb: 2 }}>
          <CardContent sx={{ p: 2.5 }}>
            <Typography
              variant="overline"
              sx={{ color: 'text.secondary', fontSize: '0.65rem', letterSpacing: '0.12em', display: 'block', mb: 1 }}
            >
              What's happening
            </Typography>
            <Typography
              variant="body2"
              sx={{ color: 'text.secondary', fontSize: '0.85rem', lineHeight: 1.7 }}
            >
              {brief.summary}
            </Typography>
          </CardContent>
        </Card>
      )}

      {/* Tier 3: Nerd Mode (collapsible) */}
      {detail && (
        <Accordion
          sx={{
            mb: 2,
            backgroundImage: 'none',
            backgroundColor: 'background.paper',
            border: '1px solid rgba(255,255,255,0.06)',
            '&:before': { display: 'none' },
            borderRadius: '16px !important',
          }}
        >
          <AccordionSummary
            expandIcon={<ExpandMoreIcon sx={{ color: 'text.secondary' }} />}
            sx={{ px: 2.5 }}
          >
            <Typography variant="overline" sx={{ color: 'text.secondary', fontSize: '0.65rem', letterSpacing: '0.12em' }}>
              Why we think this
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 2.5, pt: 0 }}>
            {/* Signal Breakdown */}
            {detail.signal_breakdown && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 600, display: 'block', mb: 1 }}>
                  Signal Breakdown
                </Typography>
                {Object.entries(detail.signal_breakdown).map(([key, value]) => (
                  <Typography
                    key={key}
                    variant="body2"
                    sx={{ fontSize: '0.8rem', color: 'text.secondary', mb: 0.5, lineHeight: 1.6 }}
                  >
                    {value as string}
                  </Typography>
                ))}
              </Box>
            )}

            <Divider sx={{ borderColor: 'rgba(255,255,255,0.04)', my: 1.5 }} />

            {/* Market Context */}
            {detail.market_context && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 600, display: 'block', mb: 1 }}>
                  Market Context
                </Typography>
                {Object.entries(detail.market_context).map(([key, value]) => (
                  <Typography
                    key={key}
                    variant="body2"
                    sx={{ fontSize: '0.8rem', color: 'text.secondary', mb: 0.5, lineHeight: 1.6 }}
                  >
                    {value as string}
                  </Typography>
                ))}
              </Box>
            )}

            <Divider sx={{ borderColor: 'rgba(255,255,255,0.04)', my: 1.5 }} />

            {/* Raw Indicator Values */}
            {indicators && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 600, display: 'block', mb: 1 }}>
                  Indicators
                </Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 1,
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: '0.75rem',
                  }}
                >
                  <IndicatorRow label="EMA(9)" value={indicators.ema_9} />
                  <IndicatorRow label="EMA(21)" value={indicators.ema_21} />
                  <IndicatorRow label="RSI(14)" value={indicators.rsi_14} decimals={1} />
                  <IndicatorRow label="ADX" value={indicators.adx_4h} decimals={1} />
                  <IndicatorRow label="SMA(50d)" value={indicators.sma_50_daily} />
                </Box>
              </Box>
            )}

            {/* What Would Change */}
            {detail.what_would_change && (
              <Box>
                <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 600, display: 'block', mb: 1 }}>
                  What would change this signal
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ fontSize: '0.8rem', color: 'text.secondary', lineHeight: 1.6 }}
                >
                  {detail.what_would_change}
                </Typography>
              </Box>
            )}
          </AccordionDetails>
        </Accordion>
      )}

      {/* Brief History */}
      {recentBriefs.length > 1 && (
        <Box sx={{ mt: 3 }}>
          <Typography
            variant="overline"
            sx={{ color: 'text.secondary', fontSize: '0.65rem', letterSpacing: '0.12em', display: 'block', mb: 1.5, px: 0.5 }}
          >
            Recent Updates
          </Typography>
          {recentBriefs.slice(1).map((b) => (
            <Card key={b.id} sx={{ mb: 1.5 }}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Typography variant="body2" sx={{ fontSize: '0.8rem', color: 'text.primary', fontWeight: 500, mb: 0.5 }}>
                  {b.headline}
                </Typography>
                <Typography variant="caption" sx={{ color: 'rgba(148,163,184,0.5)', fontSize: '0.7rem' }}>
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

      {/* Signal timestamp */}
      {signal && (
        <Typography
          variant="caption"
          sx={{ display: 'block', textAlign: 'center', mt: 3, color: 'rgba(148,163,184,0.4)', fontSize: '0.7rem' }}
        >
          Last signal: {new Date(signal.timestamp).toLocaleString()}
        </Typography>
      )}
    </Box>
  );
}

function IndicatorRow({
  label,
  value,
  decimals = 0,
}: {
  label: string;
  value: number;
  decimals?: number;
}) {
  const formatted =
    value >= 1000
      ? `$${value.toLocaleString(undefined, { maximumFractionDigits: decimals })}`
      : value < 100
        ? value.toFixed(decimals || 1)
        : `$${value.toFixed(decimals)}`;

  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', color: 'text.secondary', py: 0.25 }}>
      <span style={{ opacity: 0.6 }}>{label}</span>
      <span>{formatted}</span>
    </Box>
  );
}
