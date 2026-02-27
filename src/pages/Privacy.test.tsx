import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Privacy from './Privacy';

describe('Privacy Policy Page', () => {
  it('renders the page heading', () => {
    render(<Privacy />);
    expect(screen.getByText('Privacy Policy')).toBeInTheDocument();
  });

  it('renders "Last updated" date', () => {
    render(<Privacy />);
    expect(screen.getByText(/Last updated/)).toBeInTheDocument();
  });

  it('renders all 9 section headings', () => {
    render(<Privacy />);
    const expectedSections = [
      '1. Information We Collect',
      '2. How We Use Your Data',
      '3. Third-Party Services',
      '4. Data Storage & Security',
      '5. Data Retention & Deletion',
      '6. Cookies',
      '7. We Do Not Sell Your Data',
      '8. Your Rights',
      '9. Contact',
    ];
    for (const heading of expectedSections) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }
  });

  it('includes a back link to home', () => {
    render(<Privacy />);
    const backLink = screen.getByText(/Back to Vela/);
    expect(backLink).toBeInTheDocument();
    expect(backLink.getAttribute('href')).toBe('/');
  });

  it('CRITICAL: declares no sale of data', () => {
    render(<Privacy />);
    expect(
      screen.getByText(/does not sell, rent, or share your personal data with third parties/)
    ).toBeInTheDocument();
  });

  it('lists all third-party services', () => {
    render(<Privacy />);
    expect(screen.getByText('Privy')).toBeInTheDocument();
    expect(screen.getByText('Supabase')).toBeInTheDocument();
    expect(screen.getByText('Stripe')).toBeInTheDocument();
    expect(screen.getByText('Hyperliquid')).toBeInTheDocument();
    expect(screen.getByText('CoinGecko')).toBeInTheDocument();
    expect(screen.getByText('Sentry')).toBeInTheDocument();
  });

  it('mentions data deletion via Account settings', () => {
    render(<Privacy />);
    expect(screen.getByText(/delete your account at any time/)).toBeInTheDocument();
  });

  it('includes information about data collected', () => {
    render(<Privacy />);
    expect(screen.getByText(/Email address/)).toBeInTheDocument();
    expect(screen.getByText(/Wallet address/)).toBeInTheDocument();
    expect(screen.getByText(/Trading preferences/)).toBeInTheDocument();
    expect(screen.getByText(/Usage data/)).toBeInTheDocument();
  });

  it('includes user rights section', () => {
    render(<Privacy />);
    expect(screen.getByText(/Access the personal data/)).toBeInTheDocument();
    expect(screen.getByText(/Request correction/)).toBeInTheDocument();
    expect(screen.getByText(/Request deletion/)).toBeInTheDocument();
    expect(screen.getByText(/Withdraw consent/)).toBeInTheDocument();
  });

  it('includes contact email', () => {
    render(<Privacy />);
    const email = screen.getByText('privacy@getvela.xyz');
    expect(email).toBeInTheDocument();
    expect(email.getAttribute('href')).toBe('mailto:privacy@getvela.xyz');
  });
});
