/**
 * VELA COMPONENT LIBRARY
 * Production-ready React components using the Vela design system
 * Import the design system CSS before using these components
 */

import React, { ReactNode } from 'react';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type ButtonVariant = 'primary' | 'brand' | 'secondary' | 'ghost' | 'buy' | 'sell' | 'wait';
type ButtonSize = 'sm' | 'md' | 'lg';
type BadgeVariant = 'buy' | 'sell' | 'wait' | 'neutral' | 'up' | 'down';
type CardVariant = 'default' | 'lavender' | 'mint' | 'peach' | 'sky' | 'elevated';

interface ButtonProps {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  onClick?: () => void;
  disabled?: boolean;
  icon?: ReactNode;
  className?: string;
}

interface CardProps {
  children: ReactNode;
  variant?: CardVariant;
  compact?: boolean;
  hover?: boolean;
  className?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
}

interface BadgeProps {
  children: ReactNode;
  variant: BadgeVariant;
  icon?: ReactNode;
  className?: string;
}

interface SignalCardProps {
  asset: string;
  signal: 'BUY' | 'SELL' | 'WAIT';
  price: string;
  priceChange?: string;
  reason: string;
  timestamp?: string;
  onClick?: () => void;
}

interface StatCardProps {
  label: string;
  value: string;
  change?: string;
  variant?: CardVariant;
}

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helper?: string;
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
}

interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helper?: string;
}

// ============================================================================
// BUTTON COMPONENT
// ============================================================================

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  onClick,
  disabled = false,
  icon,
  className = '',
}: ButtonProps) {
  const baseClass = 'vela-btn';
  const variantClass = `vela-btn-${variant}`;
  const sizeClass = size !== 'md' ? `vela-btn-${size}` : '';

  return (
    <button
      className={`${baseClass} ${variantClass} ${sizeClass} ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
    >
      {icon && <span>{icon}</span>}
      <span>{children}</span>
    </button>
  );
}

// ============================================================================
// CARD COMPONENT
// ============================================================================

export function Card({
  children,
  variant = 'default',
  compact = false,
  className = '',
  onClick,
  style,
}: CardProps) {
  const baseClass = 'vela-card';
  const variantClass = variant !== 'default' ? `vela-card-${variant}` : '';
  const compactClass = compact ? 'vela-card-compact' : '';
  const clickable = onClick ? 'cursor-pointer' : '';

  return (
    <div
      className={`${baseClass} ${variantClass} ${compactClass} ${clickable} ${className}`.trim()}
      onClick={onClick}
      onKeyDown={
        onClick
          ? e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={style}
    >
      {children}
    </div>
  );
}

// ============================================================================
// BADGE COMPONENT
// ============================================================================

export function Badge({ children, variant, icon, className = '' }: BadgeProps) {
  const baseClass = 'vela-badge';
  const variantClass = `vela-badge-${variant}`;

  return (
    <span className={`${baseClass} ${variantClass} ${className}`.trim()}>
      {icon && <span>{icon}</span>}
      <span>{children}</span>
    </span>
  );
}

// ============================================================================
// SIGNAL CARD COMPONENT
// ============================================================================

export function SignalCard({
  asset,
  signal,
  price,
  priceChange,
  reason,
  timestamp,
  onClick,
}: SignalCardProps) {
  const signalVariantMap = {
    BUY: 'buy' as BadgeVariant,
    SELL: 'sell' as BadgeVariant,
    WAIT: 'wait' as BadgeVariant,
  };

  const cardVariantMap = {
    BUY: 'mint' as CardVariant,
    SELL: 'peach' as CardVariant,
    WAIT: 'lavender' as CardVariant,
  };

  return (
    <Card variant={cardVariantMap[signal]} onClick={onClick}>
      <div className="vela-stack vela-stack-md">
        {/* Header */}
        <div
          className="vela-row"
          style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}
        >
          <div>
            <h3 className="vela-heading-lg">{asset}</h3>
            {timestamp && <p className="vela-body-sm vela-text-muted">{timestamp}</p>}
          </div>
          <Badge variant={signalVariantMap[signal]}>{signal}</Badge>
        </div>

        {/* Price */}
        <div className="vela-stack vela-stack-sm">
          <p className="vela-price">{price}</p>
          {priceChange && (
            <Badge variant={priceChange.startsWith('+') ? 'up' : 'down'}>{priceChange}</Badge>
          )}
        </div>

        {/* Reason */}
        <p className="vela-body-base vela-text-secondary">{reason}</p>
      </div>
    </Card>
  );
}

// ============================================================================
// STAT CARD COMPONENT
// ============================================================================

export function StatCard({ label, value, change, variant = 'default' }: StatCardProps) {
  return (
    <Card variant={variant} compact>
      <div className="vela-stack vela-stack-sm">
        <p className="vela-label vela-text-muted" style={{ textTransform: 'uppercase' }}>
          {label}
        </p>
        <p className="vela-price">{value}</p>
        {change && <Badge variant={change.startsWith('+') ? 'up' : 'down'}>{change}</Badge>}
      </div>
    </Card>
  );
}

// ============================================================================
// EMPTY STATE COMPONENT
// ============================================================================

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <Card variant="lavender">
      <div
        className="vela-stack vela-stack-lg"
        style={{ alignItems: 'center', textAlign: 'center', padding: 'var(--space-8)' }}
      >
        {icon && <div style={{ fontSize: '3rem', opacity: 0.5 }}>{icon}</div>}
        <div className="vela-stack vela-stack-md">
          <h3 className="vela-heading-xl">{title}</h3>
          <p className="vela-body-lg vela-text-secondary">{description}</p>
        </div>
        {action && <div>{action}</div>}
      </div>
    </Card>
  );
}

// ============================================================================
// INPUT COMPONENT
// ============================================================================

export function Input({ label, error, helper, className = '', ...props }: InputProps) {
  return (
    <div className={`vela-stack vela-stack-sm ${className}`.trim()}>
      {label && (
        <label className="vela-label" htmlFor={props.id}>
          {label}
        </label>
      )}
      <input className="vela-input" {...props} />
      {error && (
        <p className="vela-body-sm" style={{ color: 'var(--color-error)' }}>
          {error}
        </p>
      )}
      {helper && !error && <p className="vela-body-sm vela-text-muted">{helper}</p>}
    </div>
  );
}

// ============================================================================
// SELECT COMPONENT
// ============================================================================

export function Select({ label, error, options, className = '', ...props }: SelectProps) {
  return (
    <div className={`vela-stack vela-stack-sm ${className}`.trim()}>
      {label && (
        <label className="vela-label" htmlFor={props.id}>
          {label}
        </label>
      )}
      <select className="vela-input vela-select" {...props}>
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && (
        <p className="vela-body-sm" style={{ color: 'var(--color-error)' }}>
          {error}
        </p>
      )}
    </div>
  );
}

// ============================================================================
// TEXTAREA COMPONENT
// ============================================================================

export function TextArea({ label, error, helper, className = '', ...props }: TextAreaProps) {
  return (
    <div className={`vela-stack vela-stack-sm ${className}`.trim()}>
      {label && (
        <label className="vela-label" htmlFor={props.id}>
          {label}
        </label>
      )}
      <textarea className="vela-input vela-textarea" {...props} />
      {error && (
        <p className="vela-body-sm" style={{ color: 'var(--color-error)' }}>
          {error}
        </p>
      )}
      {helper && !error && <p className="vela-body-sm vela-text-muted">{helper}</p>}
    </div>
  );
}

// ============================================================================
// LAYOUT COMPONENTS
// ============================================================================

export function PageContainer({ children }: { children: ReactNode }) {
  return <div className="vela-container">{children}</div>;
}

export function Stack({
  children,
  spacing = 'md',
  className = '',
}: {
  children: ReactNode;
  spacing?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  return <div className={`vela-stack vela-stack-${spacing} ${className}`.trim()}>{children}</div>;
}

export function Row({
  children,
  spacing = 'md',
  className = '',
}: {
  children: ReactNode;
  spacing?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return <div className={`vela-row vela-row-${spacing} ${className}`.trim()}>{children}</div>;
}

export function Grid({
  children,
  columns = 1,
  className = '',
}: {
  children: ReactNode;
  columns?: 1 | 2 | 3 | 4;
  className?: string;
}) {
  const gridClass = columns > 1 ? `vela-grid-${columns}` : '';
  return <div className={`vela-grid ${gridClass} ${className}`.trim()}>{children}</div>;
}

// ============================================================================
// PAGE HEADER COMPONENT
// ============================================================================

export function PageHeader({
  title,
  subtitle,
  action,
  backButton,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  backButton?: ReactNode;
}) {
  return (
    <div className="vela-stack vela-stack-md" style={{ marginBottom: 'var(--space-8)' }}>
      {backButton && <div>{backButton}</div>}
      <div
        className="vela-row"
        style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
        <div className="vela-stack vela-stack-sm">
          <h1
            className="vela-heading-xl"
            style={{
              fontFamily: 'var(--type-display-xl-font)',
              fontSize: 'var(--type-display-xl-size)',
              fontWeight: 'var(--type-display-xl-weight)',
            }}
          >
            {title}
          </h1>
          {subtitle && <p className="vela-body-lg vela-text-secondary">{subtitle}</p>}
        </div>
        {action && <div>{action}</div>}
      </div>
    </div>
  );
}

// ============================================================================
// ALERT COMPONENT
// ============================================================================

export function Alert({
  children,
  variant = 'info',
  onDismiss,
}: {
  children: ReactNode;
  variant?: 'info' | 'success' | 'warning' | 'error';
  onDismiss?: () => void;
}) {
  const variantStyles = {
    info: { bg: 'var(--blue-light)', color: 'var(--blue-primary)', border: 'var(--blue-primary)' },
    success: {
      bg: 'var(--green-light)',
      color: 'var(--green-dark)',
      border: 'var(--green-primary)',
    },
    warning: {
      bg: 'var(--amber-light)',
      color: 'var(--amber-dark)',
      border: 'var(--amber-primary)',
    },
    error: { bg: 'var(--red-light)', color: 'var(--red-dark)', border: 'var(--red-primary)' },
  };

  const style = variantStyles[variant];

  return (
    <div
      className="vela-card vela-card-compact"
      style={{
        backgroundColor: style.bg,
        color: style.color,
        borderColor: style.border,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 'var(--space-4)',
      }}
    >
      <div className="vela-body-base">{children}</div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: 'var(--text-xl)',
            color: style.color,
            padding: '0',
            lineHeight: '1',
          }}
          aria-label="Dismiss"
        >
          ×
        </button>
      )}
    </div>
  );
}

// ============================================================================
// LOADING SPINNER COMPONENT
// ============================================================================

export function LoadingSpinner({ size = 24 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        border: '3px solid var(--color-border-muted)',
        borderTop: '3px solid var(--color-brand)',
        borderRadius: '50%',
        animation: 'vela-spin 0.8s linear infinite',
      }}
    />
  );
}

// Add keyframe animation for spinner
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes vela-spin {
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

// ============================================================================
// EXAMPLES & USAGE
// ============================================================================

/**
 * USAGE EXAMPLES:
 *
 * import { Button, Card, SignalCard, Badge } from './components/VelaComponents';
 * import './styles/vela-design-system.css';
 *
 * // Buttons
 * <Button variant="primary" onClick={handleClick}>Buy Now</Button>
 * <Button variant="buy" icon={<TrendingUpIcon />}>BUY Signal</Button>
 *
 * // Cards
 * <Card variant="lavender">
 *   <h3>Your content here</h3>
 * </Card>
 *
 * // Signal Card
 * <SignalCard
 *   asset="Bitcoin"
 *   signal="BUY"
 *   price="$45,230"
 *   priceChange="+2.3%"
 *   reason="Price broke above resistance with strong volume"
 *   timestamp="2 minutes ago"
 *   onClick={() => navigate('/asset/btc')}
 * />
 *
 * // Badges
 * <Badge variant="buy">BUY</Badge>
 * <Badge variant="up">+5.2%</Badge>
 *
 * // Inputs
 * <Input
 *   label="Email Address"
 *   type="email"
 *   placeholder="you@example.com"
 *   helper="We'll never share your email"
 * />
 *
 * // Layout
 * <PageContainer>
 *   <PageHeader
 *     title="Your Signals"
 *     subtitle="Always watching the markets for you"
 *   />
 *   <Grid columns={2}>
 *     <StatCard label="Portfolio Value" value="$12,450" change="+5.2%" />
 *     <StatCard label="Active Signals" value="3" />
 *   </Grid>
 * </PageContainer>
 */
