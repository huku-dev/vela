import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useNavigate } from 'react-router-dom';
import SignalChip from './SignalChip';
import PriceArrow from './PriceArrow';
import { getCoinIcon, formatPrice, stripAssetPrefix } from '../lib/helpers';
import type { AssetDashboard } from '../types';

interface SignalCardProps {
  data: AssetDashboard;
}

export default function SignalCard({ data }: SignalCardProps) {
  const navigate = useNavigate();
  const { asset, signal, brief, priceData } = data;

  const price = priceData?.price ?? signal?.price_at_signal;
  const iconUrl = getCoinIcon(asset.coingecko_id);

  return (
    <Card>
      <CardActionArea
        onClick={() => navigate(`/asset/${asset.id}`)}
        sx={{ '&:hover .chevron': { transform: 'translateX(3px)' } }}
      >
        <CardContent sx={{ p: 2.5 }}>
          {/* Top row */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
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

            {/* Name */}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                sx={{ fontWeight: 700, fontSize: '1rem', color: '#1A1A1A', lineHeight: 1.2 }}
              >
                {asset.symbol}
              </Typography>
              <Typography sx={{ fontSize: '0.75rem', color: '#6B7280', lineHeight: 1.3 }}>
                {asset.name}
              </Typography>
            </Box>

            {/* Price + arrow */}
            <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
              <Typography
                sx={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontWeight: 600,
                  fontSize: '0.95rem',
                  color: '#1A1A1A',
                  lineHeight: 1.2,
                }}
              >
                {formatPrice(price)}
              </Typography>
              {priceData?.change24h != null && (
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
                  <PriceArrow change24h={priceData.change24h} />
                  <Typography
                    sx={{
                      fontFamily: '"JetBrains Mono", monospace',
                      fontWeight: 600,
                      fontSize: '0.65rem',
                      color: priceData.change24h >= 0 ? '#15803D' : '#DC2626',
                      lineHeight: 1,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {Math.abs(priceData.change24h).toFixed(1)}%
                  </Typography>
                </Box>
              )}
            </Box>

            {/* Signal chip */}
            <SignalChip color={signal?.signal_color || 'grey'} size="small" />

            {/* Chevron */}
            <ChevronRightIcon
              className="chevron"
              sx={{
                color: '#9CA3AF',
                fontSize: '1.2rem',
                transition: 'transform 0.15s ease',
                flexShrink: 0,
              }}
            />
          </Box>

          {/* Headline */}
          {brief?.headline && (
            <Typography
              sx={{
                fontSize: '0.82rem',
                color: '#6B7280',
                lineHeight: 1.5,
                mt: 1.5,
                pt: 1.5,
                borderTop: '2px solid #E5E7EB',
              }}
            >
              {stripAssetPrefix(brief.headline, asset.symbol)}
            </Typography>
          )}
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
