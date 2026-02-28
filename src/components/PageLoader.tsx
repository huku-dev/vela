import VelaLogo from './VelaLogo';

/**
 * Full-page loading spinner shown while lazy-loaded chunks download.
 * Shared between App.tsx (public routes) and AuthShell (auth routes).
 */
export default function PageLoader() {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        paddingTop: 'var(--space-20)',
        flexDirection: 'column',
        gap: 'var(--space-4)',
      }}
    >
      <VelaLogo variant="mark" size={48} pulse />
      <span className="vela-body-sm vela-text-muted">Loading...</span>
    </div>
  );
}
