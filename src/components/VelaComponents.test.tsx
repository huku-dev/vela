import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Badge, Button, SignalCard, StatCard, Alert } from './VelaComponents';

describe('Badge Component', () => {
  it('renders with correct variant class', () => {
    render(<Badge variant="buy">BUY</Badge>);
    const badge = screen.getByText('BUY').closest('.vela-badge')!;
    expect(badge).toHaveClass('vela-badge-buy');
  });

  it('never shows green badge for SELL signals', () => {
    render(<Badge variant="sell">SELL</Badge>);
    const badge = screen.getByText('SELL').closest('.vela-badge')!;
    expect(badge).toHaveClass('vela-badge-sell');
    expect(badge).not.toHaveClass('vela-badge-buy');
  });

  it('never shows red badge for BUY signals', () => {
    render(<Badge variant="buy">BUY</Badge>);
    const badge = screen.getByText('BUY').closest('.vela-badge')!;
    expect(badge).toHaveClass('vela-badge-buy');
    expect(badge).not.toHaveClass('vela-badge-sell');
  });

  it('renders icon when provided', () => {
    render(
      <Badge variant="up" icon={<span data-testid="icon">↑</span>}>
        +5%
      </Badge>
    );
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });
});

describe('SignalCard Component', () => {
  const mockProps = {
    asset: 'Bitcoin',
    signal: 'BUY' as const,
    price: '$45,230',
    priceChange: '+2.3%',
    reason: 'Price broke above resistance',
    timestamp: '2 minutes ago',
  };

  it('renders all signal information correctly', () => {
    render(<SignalCard {...mockProps} />);

    expect(screen.getByText('Bitcoin')).toBeInTheDocument();
    expect(screen.getByText('BUY')).toBeInTheDocument();
    expect(screen.getByText('$45,230')).toBeInTheDocument();
    expect(screen.getByText('+2.3%')).toBeInTheDocument();
    expect(screen.getByText('Price broke above resistance')).toBeInTheDocument();
    expect(screen.getByText('2 minutes ago')).toBeInTheDocument();
  });

  it('CRITICAL: never shows BUY badge with SELL signal', () => {
    render(<SignalCard {...mockProps} signal="SELL" />);

    const badge = screen.getByText('SELL').closest('.vela-badge')!;
    expect(badge).toHaveClass('vela-badge-sell');
    expect(badge).not.toHaveClass('vela-badge-buy');
  });

  it('CRITICAL: never shows SELL badge with BUY signal', () => {
    render(<SignalCard {...mockProps} signal="BUY" />);

    const badge = screen.getByText('BUY').closest('.vela-badge')!;
    expect(badge).toHaveClass('vela-badge-buy');
    expect(badge).not.toHaveClass('vela-badge-sell');
  });

  it('applies correct card variant for signal type', () => {
    const { container, rerender } = render(<SignalCard {...mockProps} signal="BUY" />);
    expect(container.querySelector('.vela-card-mint')).toBeInTheDocument();

    rerender(<SignalCard {...mockProps} signal="SELL" />);
    expect(container.querySelector('.vela-card-peach')).toBeInTheDocument();

    rerender(<SignalCard {...mockProps} signal="WAIT" />);
    expect(container.querySelector('.vela-card-lavender')).toBeInTheDocument();
  });

  it('handles onClick event when provided', async () => {
    const handleClick = vi.fn();
    render(<SignalCard {...mockProps} onClick={handleClick} />);

    const card = screen.getByRole('button');
    await userEvent.click(card);

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('shows up badge for positive price change', () => {
    render(<SignalCard {...mockProps} priceChange="+5.2%" />);
    const priceChangeBadge = screen.getByText('+5.2%').closest('.vela-badge')!;
    expect(priceChangeBadge).toHaveClass('vela-badge-up');
  });

  it('shows down badge for negative price change', () => {
    render(<SignalCard {...mockProps} priceChange="-3.1%" />);
    const priceChangeBadge = screen.getByText('-3.1%').closest('.vela-badge')!;
    expect(priceChangeBadge).toHaveClass('vela-badge-down');
  });

  it('renders without timestamp when not provided', () => {
    const propsWithoutTimestamp = {
      asset: 'Bitcoin',
      signal: 'BUY' as const,
      price: '$45,230',
      priceChange: '+2.3%',
      reason: 'Price broke above resistance',
    };

    render(<SignalCard {...propsWithoutTimestamp} />);
    expect(screen.queryByText('2 minutes ago')).not.toBeInTheDocument();
  });
});

describe('Button Component', () => {
  it('renders children correctly', () => {
    render(<Button>Click Me</Button>);
    expect(screen.getByText('Click Me')).toBeInTheDocument();
  });

  it('handles onClick event', async () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click Me</Button>);

    await userEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled when disabled prop is true', () => {
    render(<Button disabled>Click Me</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('applies correct variant class', () => {
    const { rerender } = render(<Button variant="buy">BUY</Button>);
    expect(screen.getByRole('button')).toHaveClass('vela-btn-buy');

    rerender(<Button variant="sell">SELL</Button>);
    expect(screen.getByRole('button')).toHaveClass('vela-btn-sell');
  });

  it('renders with icon when provided', () => {
    render(<Button icon={<span data-testid="icon">→</span>}>Next</Button>);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });
});

describe('StatCard Component', () => {
  it('renders label and value correctly', () => {
    render(<StatCard label="Portfolio Value" value="$12,450" />);

    expect(screen.getByText('Portfolio Value')).toBeInTheDocument();
    expect(screen.getByText('$12,450')).toBeInTheDocument();
  });

  it('shows up badge for positive change', () => {
    render(<StatCard label="Balance" value="$1,000" change="+5.2%" />);
    const changeBadge = screen.getByText('+5.2%').closest('.vela-badge')!;
    expect(changeBadge).toHaveClass('vela-badge-up');
  });

  it('shows down badge for negative change', () => {
    render(<StatCard label="Balance" value="$1,000" change="-3.1%" />);
    const changeBadge = screen.getByText('-3.1%').closest('.vela-badge')!;
    expect(changeBadge).toHaveClass('vela-badge-down');
  });

  it('renders without change badge when change is not provided', () => {
    render(<StatCard label="Balance" value="$1,000" />);
    expect(screen.queryByText(/[+-]\d/)).not.toBeInTheDocument();
  });
});

describe('Alert Component', () => {
  it('renders alert message correctly', () => {
    render(<Alert variant="info">This is an info message</Alert>);
    expect(screen.getByText('This is an info message')).toBeInTheDocument();
  });

  it('calls onDismiss when dismiss button is clicked', async () => {
    const handleDismiss = vi.fn();
    render(
      <Alert variant="success" onDismiss={handleDismiss}>
        Success message
      </Alert>
    );

    const dismissButton = screen.getByRole('button', { name: /dismiss/i });
    await userEvent.click(dismissButton);

    expect(handleDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not show dismiss button when onDismiss is not provided', () => {
    render(<Alert variant="error">Error message</Alert>);
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
  });
});
