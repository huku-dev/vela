// Privy configuration for Vela authentication
// Privy serves dual purpose: user auth + wallet provider

import type { PrivyClientConfig } from '@privy-io/react-auth';

export const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID;

export const privyConfig: PrivyClientConfig = {
  loginMethods: ['email', 'wallet'],
  appearance: {
    theme: 'light',
    accentColor: '#0A0A0A',
    landingHeader: 'Log in to Vela',
  },
  embeddedWallets: {
    ethereum: {
      createOnLogin: 'users-without-wallets',
    },
  },
};
