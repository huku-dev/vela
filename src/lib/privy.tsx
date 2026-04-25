// Privy configuration for Vela authentication
// Privy serves dual purpose: user auth + wallet provider
//
// Login methods: email, Google.
// Apple login intentionally excluded — not configured in Apple Developer.
// Passkey intentionally excluded — adds first-visit friction and clutters
// the modal for users who have never created one. Privy may still surface
// a secondary "I have a passkey" recovery link at the bottom of the modal;
// that's a Privy-side default and is not removable via SDK config.
// External wallets (WalletConnect) intentionally excluded — Vela uses
// Privy embedded wallets for trading, not user-supplied wallets.
//
// Theming: SDK-level props here (theme, accentColor, logo, landingHeader,
// loginMessage) handle structure and brand. Finer-grained colors and
// border radii come from the `--privy-*` CSS variables defined in
// `src/styles/vela-design-system.css` (scoped to `body` so they win
// over Privy's default :root values). Together they pull the auth modal
// onto the cream/ink app surface so the splash → auth → plan handoff
// reads as continuous.

import type { PrivyClientConfig } from '@privy-io/react-auth';

export const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID;

// Vela logo mark for the Privy modal. Privy's `logo` prop accepts only a
// string (URL) or a single `<img>` / `<svg>` element — wrapping spans are
// silently dropped. We inline the angular eye mark with the green diamond
// iris, matching the brand mark from `components/VelaLogo.tsx`. Privy
// overrides the `style` attribute on the element to control sizing.
// Privy applies its own width/height styles, so explicit svg width/height
// attributes are required (Privy collapses the element to 0×0 otherwise).
// Strokes use literal hex (`#0A0A0A` / `#0FE68C`) because CSS vars don't
// resolve inside an SVG passed to a third-party SDK as a ReactElement —
// same carve-out as components/VelaLogo.tsx.
const velaLogoMark = (
  <svg
    width="80"
    height="40"
    viewBox="-58 -30 116 60"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Vela"
  >
    <polygon
      points="-55,0 0,-28 55,0 0,28"
      stroke="#0A0A0A"
      strokeWidth="5"
      fill="none"
      strokeLinejoin="miter"
    />
    <rect x="-9" y="-9" width="18" height="18" rx="2" transform="rotate(45)" fill="#0FE68C" />
  </svg>
);

export const privyConfig: PrivyClientConfig = {
  loginMethods: ['email', 'google'],
  appearance: {
    theme: 'light',
    // Match the app's primary action color so the modal's CTAs read as
    // continuous with the rest of Vela. Hardcoded hex because Privy's
    // SDK type requires a literal string — keep in sync with
    // `--blue-primary` in src/styles/vela-design-system.css.
    accentColor: '#2563eb',
    // Vela eye-mark in the modal header so the auth handoff reads as
    // continuous with the splash screen.
    logo: velaLogoMark,
    landingHeader: 'Sign in to Vela',
    // loginMessage intentionally omitted: header + logo + provider buttons
    // already communicate the purpose. A subtitle on a sign-in modal tends
    // to add noise, and any specific value-prop ("we'll set up your wallet",
    // "you're in control") only applies to either new or returning users,
    // not both. Re-introduce only if a single line works for both audiences.
  },
  embeddedWallets: {
    ethereum: {
      createOnLogin: 'users-without-wallets',
    },
  },
};
