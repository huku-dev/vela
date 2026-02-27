import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Terms from './Terms';

describe('Terms of Service Page', () => {
  it('renders the page heading', () => {
    render(<Terms />);
    expect(screen.getByText('Terms of Service')).toBeInTheDocument();
  });

  it('renders "Last updated" date', () => {
    render(<Terms />);
    expect(screen.getByText(/Last updated/)).toBeInTheDocument();
  });

  it('renders all 9 section headings', () => {
    render(<Terms />);
    const expectedSections = [
      '1. Acceptance of Terms',
      '2. Description of Service',
      '3. Not Financial Advice',
      '4. User Responsibility',
      '5. Account & Security',
      '6. Subscription & Payments',
      '7. Limitation of Liability',
      '8. Modifications',
      '9. Contact',
    ];
    for (const heading of expectedSections) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }
  });

  it('includes a back link to home', () => {
    render(<Terms />);
    const backLink = screen.getByText(/Back to Vela/);
    expect(backLink).toBeInTheDocument();
    expect(backLink.getAttribute('href')).toBe('/');
  });

  it('CRITICAL: includes "not financial advice" disclaimer', () => {
    render(<Terms />);
    expect(
      screen.getByText(/does not provide financial, investment, legal, or tax advice/)
    ).toBeInTheDocument();
  });

  it('includes age restriction (18+)', () => {
    render(<Terms />);
    expect(screen.getByText(/at least 18 years old/)).toBeInTheDocument();
  });

  it('includes past performance disclaimer', () => {
    render(<Terms />);
    expect(
      screen.getByText(/Past performance does not guarantee future results/)
    ).toBeInTheDocument();
  });

  it('includes volatility warning', () => {
    render(<Terms />);
    expect(
      screen.getByText(/Cryptocurrency markets are highly volatile/)
    ).toBeInTheDocument();
  });

  it('includes contact email', () => {
    render(<Terms />);
    const email = screen.getByText('support@vela.trade');
    expect(email).toBeInTheDocument();
    expect(email.getAttribute('href')).toBe('mailto:support@vela.trade');
  });
});
