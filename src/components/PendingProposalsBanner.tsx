import { useNavigate } from 'react-router-dom';
import { useTrading } from '../hooks/useTrading';
import VelaLogo from './VelaLogo';

export default function PendingProposalsBanner() {
  const { proposals } = useTrading();
  const navigate = useNavigate();

  const pending = proposals.filter(p => p.status === 'pending');

  if (pending.length === 0) return null;

  // Navigate to /trades which now shows all pending proposals
  const targetPath = '/trades';

  const label =
    pending.length === 1
      ? '1 trade waiting for your approval'
      : `${pending.length} trades waiting for your approval`;

  return (
    <button
      onClick={() => navigate(targetPath)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        padding: 'var(--space-3) var(--space-4)',
        backgroundColor: 'var(--color-status-yellow-bg, #fffbeb)',
        border: '2px solid var(--color-status-yellow, #f59e0b)',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        fontFamily: 'Inter, system-ui, sans-serif',
        boxShadow: '2px 2px 0 var(--black)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <VelaLogo variant="mark" size={20} pulse />
        <span
          className="vela-body-sm"
          style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}
        >
          {label}
        </span>
      </div>
      <span
        className="vela-body-sm"
        style={{ fontWeight: 600, color: 'var(--color-action-primary)' }}
      >
        View &rarr;
      </span>
    </button>
  );
}
