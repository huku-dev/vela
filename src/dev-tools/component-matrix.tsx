/**
 * Vela Component Matrix dev tool.
 *
 * Renders every covered component across visual variants (columns) and
 * states (rows). Live controls: padding step, theme toggle, viewport
 * width simulator. Click any cell to copy its JSX combo.
 *
 * Coverage:
 *   - MergedSignalCard (real import from src/components/MergedSignalCard.tsx)
 *   - Button, Card, Badge from src/components/VelaComponents.tsx
 *
 * Pattern source: gallery example #06 "Component Variants".
 */

import React, { Suspense, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { Badge, Button, Card, LoadingSpinner } from '../components/VelaComponents';
import MergedSignalCard from '../components/MergedSignalCard';
import '../styles/vela-design-system.css';

// ── Types ─────────────────────────────────────────────────────────────

type CellPayload = {
  jsx: string;
  node: React.ReactNode;
};

type ComponentSpec = {
  name: string;
  sourcePath: string;
  propCount: number;
  variants: string[];
  states: string[];
  build: (variant: string, state: string) => CellPayload | null;
};

// ── Seeded data ───────────────────────────────────────────────────────

const SAMPLE_BRIEF_BTC = {
  detail: {
    signal_explanation_plain:
      'Vela has flipped Bitcoin to Buy. The 50-day average crossed above the 200-day average for the first time since January, and price has held above 65,000 across the last six daily closes. That mix of higher lows and a rising long-run average is what flipped the call.',
    what_would_change:
      'A daily close back below 64,200 would cancel the setup and Vela would step back to Wait. A clean push above 71,000 would extend the read.',
  },
};

const SAMPLE_BRIEF_NVDA = {
  detail: {
    signal_explanation_plain:
      'Nvidia is in Wait. Price is sitting between two named levels Vela watches: 118 acted as support twice this month, and 132 was the last failed retest. Without a daily close outside that band, neither side has earned the call.',
    what_would_change:
      'A daily close above 132 would flip Vela to Buy. A daily close below 118 would flip the read to Short.',
  },
};

const SAMPLE_POSITION_LONG = {
  side: 'long' as const,
  entry_price: 64500,
  current_price: 67200,
  unrealized_pnl_pct: 4.2,
};

// ── Component specs ───────────────────────────────────────────────────

const SPECS: ComponentSpec[] = [
  {
    name: 'MergedSignalCard',
    sourcePath: 'src/components/MergedSignalCard.tsx',
    propCount: 9,
    variants: ['Buy', 'Short', 'Wait'],
    states: ['populated', 'with-position', 'cold-start', 'history'],
    build: (variant, state) => {
      const colorMap: Record<string, 'green' | 'red' | 'grey'> = {
        Buy: 'green',
        Short: 'red',
        Wait: 'grey',
      };
      const symbolMap: Record<string, string> = {
        Buy: 'BTC',
        Short: 'NVDA',
        Wait: 'ETH',
      };
      const briefMap: Record<string, typeof SAMPLE_BRIEF_BTC | null> = {
        Buy: SAMPLE_BRIEF_BTC,
        Short: SAMPLE_BRIEF_NVDA,
        Wait: SAMPLE_BRIEF_BTC,
      };
      const priceMap: Record<string, number> = {
        Buy: 67200,
        Short: 124.5,
        Wait: 3220,
      };
      const change24Map: Record<string, number> = {
        Buy: 2.4,
        Short: -1.1,
        Wait: 0.3,
      };

      if (state === 'cold-start') {
        return {
          jsx: `<MergedSignalCard signalColor="${colorMap[variant]}" hlSymbol="${symbolMap[variant]}" price={null} change24h={null} brief={null} />`,
          node: (
            <MergedSignalCard
              signalColor={colorMap[variant]}
              hlSymbol={symbolMap[variant]}
              price={null}
              change24h={null}
              brief={null}
            />
          ),
        };
      }

      if (state === 'with-position') {
        const pos =
          variant === 'Short'
            ? { ...SAMPLE_POSITION_LONG, side: 'short' as const, unrealized_pnl_pct: -2.1 }
            : SAMPLE_POSITION_LONG;
        return {
          jsx: `<MergedSignalCard signalColor="${colorMap[variant]}" hlSymbol="${symbolMap[variant]}" price={${priceMap[variant]}} change24h={${change24Map[variant]}} brief={brief} position={position} />`,
          node: (
            <MergedSignalCard
              signalColor={colorMap[variant]}
              hlSymbol={symbolMap[variant]}
              price={priceMap[variant]}
              change24h={change24Map[variant]}
              brief={briefMap[variant]}
              position={pos}
            />
          ),
        };
      }

      if (state === 'history') {
        return {
          jsx: `<MergedSignalCard signalColor="${colorMap[variant]}" hlSymbol="${symbolMap[variant]}" price={${priceMap[variant]}} change24h={${change24Map[variant]}} brief={brief} historyCount={3} onHistoryClick={() => {}} />`,
          node: (
            <MergedSignalCard
              signalColor={colorMap[variant]}
              hlSymbol={symbolMap[variant]}
              price={priceMap[variant]}
              change24h={change24Map[variant]}
              brief={briefMap[variant]}
              historyCount={3}
              onHistoryClick={() => {}}
            />
          ),
        };
      }

      // populated
      return {
        jsx: `<MergedSignalCard signalColor="${colorMap[variant]}" hlSymbol="${symbolMap[variant]}" price={${priceMap[variant]}} change24h={${change24Map[variant]}} brief={brief} />`,
        node: (
          <MergedSignalCard
            signalColor={colorMap[variant]}
            hlSymbol={symbolMap[variant]}
            price={priceMap[variant]}
            change24h={change24Map[variant]}
            brief={briefMap[variant]}
          />
        ),
      };
    },
  },
  {
    name: 'Button',
    sourcePath: 'src/components/VelaComponents.tsx',
    propCount: 7,
    variants: ['primary', 'brand', 'secondary', 'ghost', 'buy', 'sell', 'wait'],
    states: ['default', 'disabled'],
    build: (variant, state) => {
      const label =
        variant === 'buy'
          ? 'Take signal'
          : variant === 'sell'
            ? 'Take signal'
            : variant === 'wait'
              ? 'Hold off'
              : 'Get started';
      return {
        jsx: `<Button variant="${variant}"${state === 'disabled' ? ' disabled' : ''}>${label}</Button>`,
        node: (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          <Button variant={variant as any} disabled={state === 'disabled'}>
            {label}
          </Button>
        ),
      };
    },
  },
  {
    name: 'Card',
    sourcePath: 'src/components/VelaComponents.tsx',
    propCount: 7,
    variants: ['default', 'lavender', 'mint', 'peach', 'sky', 'elevated'],
    states: ['populated', 'empty', 'compact', 'tight'],
    build: (variant, state) => {
      if (state === 'empty') {
        return {
          jsx: `<Card variant="${variant}" />`,
          node: (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            <Card variant={variant as any}>
              <span style={{ color: 'var(--color-text-muted)' }}>{/* empty */}</span>
            </Card>
          ),
        };
      }
      const compact = state === 'compact';
      const tight = state === 'tight';
      return {
        jsx: `<Card variant="${variant}"${compact ? ' compact' : ''}${tight ? ' tight' : ''}>...</Card>`,
        node: (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          <Card variant={variant as any} compact={compact} tight={tight}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <span className="vela-label" style={{ color: 'var(--color-text-muted)' }}>
                Portfolio
              </span>
              <span className="vela-price">$12,450</span>
              <span className="vela-body-sm vela-text-secondary">
                Signal coverage live across 10 assets.
              </span>
            </div>
          </Card>
        ),
      };
    },
  },
  {
    name: 'Badge',
    sourcePath: 'src/components/VelaComponents.tsx',
    propCount: 4,
    variants: ['buy', 'sell', 'wait', 'neutral', 'up', 'down'],
    states: ['default'],
    build: variant => {
      const labelMap: Record<string, string> = {
        buy: 'BUY',
        sell: 'SHORT',
        wait: 'WAIT',
        neutral: 'IDLE',
        up: '+5.2%',
        down: '-3.1%',
      };
      return {
        jsx: `<Badge variant="${variant}">${labelMap[variant]}</Badge>`,
        node: (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          <Badge variant={variant as any}>{labelMap[variant]}</Badge>
        ),
      };
    },
  },
];

// ── Toolbar ───────────────────────────────────────────────────────────

type Viewport = 'fluid' | 320 | 375 | 768 | 1024;

function Toolbar({
  paddingStep,
  setPaddingStep,
  theme,
  setTheme,
  viewport,
  setViewport,
}: {
  paddingStep: number;
  setPaddingStep: (n: number) => void;
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
  viewport: Viewport;
  setViewport: (v: Viewport) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--space-6)',
        flexWrap: 'wrap',
        alignItems: 'center',
        padding: 'var(--space-4) var(--space-6)',
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-muted)',
        borderRadius: 'var(--radius-md)',
        marginBottom: 'var(--space-6)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span
          style={{
            fontSize: 'var(--text-2xs)',
            color: 'var(--color-text-muted)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-wide)',
            fontWeight: 600,
          }}
        >
          Padding step
        </span>
        <input
          type="range"
          min={-2}
          max={2}
          step={1}
          value={paddingStep}
          onChange={e => setPaddingStep(parseInt(e.target.value, 10))}
        />
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
          {paddingStep > 0 ? `+${paddingStep}` : paddingStep}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span
          style={{
            fontSize: 'var(--text-2xs)',
            color: 'var(--color-text-muted)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-wide)',
            fontWeight: 600,
          }}
        >
          Theme
        </span>
        <button
          type="button"
          className="vela-btn vela-btn-secondary vela-btn-sm"
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
        >
          {theme === 'light' ? 'Switch to dark' : 'Switch to light'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span
          style={{
            fontSize: 'var(--text-2xs)',
            color: 'var(--color-text-muted)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-wide)',
            fontWeight: 600,
          }}
        >
          Viewport width
        </span>
        <select
          className="vela-input vela-select"
          value={String(viewport)}
          onChange={e => {
            const v = e.target.value;
            setViewport(v === 'fluid' ? 'fluid' : (parseInt(v, 10) as Viewport));
          }}
          style={{ minWidth: 140 }}
        >
          <option value="fluid">Fluid</option>
          <option value="320">320 px</option>
          <option value="375">375 px</option>
          <option value="768">768 px</option>
          <option value="1024">1024 px</option>
        </select>
      </div>
    </div>
  );
}

// ── Cell ──────────────────────────────────────────────────────────────

function Cell({
  payload,
  variant,
  state,
  paddingStep,
  onCopy,
}: {
  payload: CellPayload | null;
  variant: string;
  state: string;
  paddingStep: number;
  onCopy: (jsx: string) => void;
}) {
  if (!payload) {
    return (
      <div
        style={{
          padding: 'var(--space-4)',
          background: 'var(--color-bg-surface-subtle)',
          border: '1px dashed var(--color-border-subtle)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
          fontStyle: 'italic',
        }}
      >
        {/* N/A: this component has no */}
        N/A: {state} not applicable
      </div>
    );
  }

  const padPx = 16 + paddingStep * 4;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onCopy(payload.jsx)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onCopy(payload.jsx);
        }
      }}
      title={payload.jsx}
      style={{
        padding: `${padPx}px`,
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-muted)',
        borderRadius: 'var(--radius-md)',
        cursor: 'copy',
        position: 'relative',
        minHeight: 80,
      }}
    >
      <div
        style={{
          fontSize: 'var(--text-2xs)',
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-wide)',
          fontWeight: 600,
          marginBottom: 'var(--space-2)',
        }}
      >
        {variant} · {state}
      </div>
      <ErrorBoundary
        fallback={
          <div
            style={{
              padding: 'var(--space-3)',
              background: 'var(--color-status-sell-bg)',
              color: 'var(--color-status-sell-text)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-xs)',
            }}
          >
            Render failed for this combo.
          </div>
        }
      >
        <Suspense
          fallback={
            <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-4)' }}>
              <LoadingSpinner />
            </div>
          }
        >
          {payload.node}
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

// ── Component block ───────────────────────────────────────────────────

function ComponentBlock({
  spec,
  paddingStep,
  onCopy,
}: {
  spec: ComponentSpec;
  paddingStep: number;
  onCopy: (jsx: string) => void;
}) {
  return (
    <section
      style={{
        marginBottom: 'var(--space-8)',
        padding: 'var(--space-6)',
        background: 'var(--color-bg-surface-subtle)',
        border: '1px solid var(--color-border-muted)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-4)',
          flexWrap: 'wrap',
        }}
      >
        <h2 className="vela-heading-lg" style={{ color: 'var(--color-text-primary)', margin: 0 }}>
          {spec.name}
        </h2>
        <code
          style={{
            fontFamily: 'var(--type-mono-base-font)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-secondary)',
          }}
        >
          {spec.sourcePath}
        </code>
        <span
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
          }}
        >
          {spec.propCount} props · {spec.variants.length} variants × {spec.states.length} states
        </span>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `120px repeat(${spec.variants.length}, minmax(220px, 1fr))`,
          gap: 'var(--space-3)',
        }}
      >
        <div />
        {spec.variants.map(v => (
          <div
            key={v}
            style={{
              fontSize: 'var(--text-xs)',
              fontWeight: 600,
              color: 'var(--color-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-wide)',
              padding: 'var(--space-2)',
              textAlign: 'center',
            }}
          >
            {v}
          </div>
        ))}

        {spec.states.map(state => (
          <React.Fragment key={state}>
            <div
              style={{
                fontSize: 'var(--text-xs)',
                fontWeight: 600,
                color: 'var(--color-text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: 'var(--tracking-wide)',
                padding: 'var(--space-2)',
                alignSelf: 'center',
              }}
            >
              {state}
            </div>
            {spec.variants.map(variant => (
              <Cell
                key={`${variant}-${state}`}
                payload={spec.build(variant, state)}
                variant={variant}
                state={state}
                paddingStep={paddingStep}
                onCopy={onCopy}
              />
            ))}
          </React.Fragment>
        ))}
      </div>
    </section>
  );
}

// ── Header (matches docs/cron-schedule.html pattern) ──────────────────

function MatrixHeader() {
  return (
    <header
      style={{
        padding: 'var(--space-4) var(--space-6)',
        borderBottom: '1px solid var(--color-border-muted)',
        background: 'var(--color-bg-surface)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        flexWrap: 'wrap',
      }}
    >
      <div
        style={{
          fontSize: 15,
          fontWeight: 800,
          color: 'var(--vela-ink)',
          letterSpacing: '-0.5px',
        }}
      >
        vela<span style={{ color: 'var(--vela-purple)' }}>.</span>
      </div>
      <div
        style={{
          width: 1,
          height: 18,
          background: 'var(--color-border-muted)',
        }}
      />
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--color-text-secondary)',
        }}
      >
        Component Matrix
      </div>
      <div
        style={{
          color: 'var(--color-text-muted)',
          fontSize: 11,
          marginLeft: 'auto',
        }}
      >
        Variants × states harness for visual review.
      </div>
    </header>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────

function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 'var(--space-6)',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: 'var(--space-3) var(--space-5)',
        background: 'var(--color-text-primary)',
        color: 'var(--color-text-on-accent)',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-sm)',
        fontWeight: 600,
        zIndex: 'var(--z-notification)' as unknown as number,
        boxShadow: 'var(--shadow-md)',
      }}
    >
      {message}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────

function App() {
  const [paddingStep, setPaddingStep] = useState(0);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [viewport, setViewport] = useState<Viewport>('fluid');
  const [toast, setToast] = useState<string | null>(null);

  // Toggle data-theme on body for theme reactivity.
  React.useEffect(() => {
    document.body.setAttribute('data-theme', theme);
  }, [theme]);

  const handleCopy = (jsx: string) => {
    navigator.clipboard
      .writeText(jsx)
      .then(() => {
        setToast('Copied JSX to clipboard.');
        setTimeout(() => setToast(null), 1800);
      })
      .catch(() => {
        setToast('Copy failed. Select the title attribute instead.');
        setTimeout(() => setToast(null), 2400);
      });
  };

  const containerStyle = useMemo<React.CSSProperties>(() => {
    if (viewport === 'fluid') {
      return { width: '100%', maxWidth: 1400, margin: '0 auto' };
    }
    return {
      width: viewport,
      margin: '0 auto',
      border: '1px dashed var(--color-border-subtle)',
      borderRadius: 'var(--radius-md)',
    };
  }, [viewport]);

  return (
    <div style={{ background: 'var(--color-bg-page)', minHeight: '100vh' }}>
      <MatrixHeader />
      <div style={{ padding: 'var(--space-6)' }}>
        <Toolbar
          paddingStep={paddingStep}
          setPaddingStep={setPaddingStep}
          theme={theme}
          setTheme={setTheme}
          viewport={viewport}
          setViewport={setViewport}
        />
        <div style={containerStyle}>
          {SPECS.map(spec => (
            <ComponentBlock
              key={spec.name}
              spec={spec}
              paddingStep={paddingStep}
              onCopy={handleCopy}
            />
          ))}
        </div>
      </div>
      <Toast message={toast} />
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
