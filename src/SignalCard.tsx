import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useNavigate } from 'react-router-dom';
import SignalChip from './SignalChip';
import type { AssetDashboard } from '../types';

interface SignalCardProps {
  data: AssetDashboard;
}

export default function SignalCard({ data }: SignalCardProps) {
  const navigate = useNavigate();
  const { asset, signal, brief } = data;

  const price = signal?.price_at_signal;
  const formattedPrice = price
    ? price >= 1000
      ? `$${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
      : `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
    : '—';

  return (
    <Card>
      <CardActionArea onClick={() => navigate(`/asset/${asset.id}`)}>
        <CardContent sx={{ p: 2.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
            <Box>
              <Typography variant="h6" sx={{ mb: 0.25, color: 'text.primary' }}>
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
                  mt: 0.75,
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: '0.85rem',
                  color: 'text.primary',
                }}
              >
                {formattedPrice}
              </Typography>
            </Box>
          </Box>

          {brief?.headline && (
            <Typography
              variant="body2"
              sx={{
                fontSize: '0.85rem',
                color: 'text.secondary',
                lineHeight: 1.5,
                mt: 1,
                borderTop: '1px solid rgba(255,255,255,0.04)',
                pt: 1.5,
              }}
            >
              {brief.headline}
            </Typography>
          )}
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
