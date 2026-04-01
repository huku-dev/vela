// Privy configuration for Vela authentication
// Privy serves dual purpose: user auth + wallet provider
//
// Login methods: email, Google, Apple.
// External wallets (WalletConnect) intentionally excluded — Vela uses
// Privy embedded wallets for trading, not user-supplied wallets.

import type { PrivyClientConfig } from '@privy-io/react-auth';

export const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID;

export const privyConfig: PrivyClientConfig = {
  loginMethods: ['email', 'google', 'apple'],
  appearance: {
    theme: 'light',
    accentColor: '#0A0A0A',
    landingHeader: 'Sign in to Vela',
  },
  embeddedWallets: {
    ethereum: {
      createOnLogin: 'users-without-wallets',
    },
  },
};
