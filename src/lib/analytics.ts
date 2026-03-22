import posthog from 'posthog-js';

// ── PostHog initialization ──────────────────────────────────────
// Call once at app startup (main.tsx), before React renders.
// No-ops gracefully if VITE_POSTHOG_KEY is missing (dev/CI).

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY;
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com';

export function initAnalytics(): void {
  if (!POSTHOG_KEY) {
    if (import.meta.env.DEV) {
      console.info('[analytics] PostHog disabled — VITE_POSTHOG_KEY not set');
    }
    return;
  }

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    // Respect Do Not Track
    respect_dnt: true,
    // Auto-capture clicks + page views for free
    autocapture: true,
    capture_pageview: true,
    capture_pageleave: true,
    // Disable in dev to avoid noise
    loaded: ph => {
      if (import.meta.env.DEV) {
        ph.opt_out_capturing();
        console.info('[analytics] PostHog loaded but opted out (dev mode)');
      }
    },
  });
}

// ── User identification ──────────────────────────────────────────
// Call after successful auth exchange. Links anonymous events to user.

export function identifyUser(
  privyDid: string,
  properties?: Record<string, string | boolean | number | null>
): void {
  if (!POSTHOG_KEY) return;
  posthog.identify(privyDid, properties);
}

export function resetUser(): void {
  if (!POSTHOG_KEY) return;
  posthog.reset();
}

// ── Event tracking ───────────────────────────────────────────────
// Typed event names prevent typos and make grep-ability easy.
// Every event name follows: category_action (snake_case).

export const AnalyticsEvent = {
  // ── Auth & Onboarding ──
  LOGIN_STARTED: 'auth_login_started',
  LOGIN_COMPLETED: 'auth_login_completed',
  LOGOUT: 'auth_logout',
  ONBOARDING_STEP_VIEWED: 'onboarding_step_viewed',
  ONBOARDING_COMPLETED: 'onboarding_completed',
  TRADING_MODE_SELECTED: 'onboarding_trading_mode_selected',

  // ── Navigation & Engagement ──
  SIGNAL_CARD_CLICKED: 'signal_card_clicked',
  ASSET_DETAIL_VIEWED: 'asset_detail_viewed',
  BRIEF_EXPANDED: 'brief_expanded',
  BRIEF_RATED: 'brief_rated',
  TRACK_RECORD_VIEWED: 'track_record_viewed',
  ACCOUNT_VIEWED: 'account_viewed',

  // ── Trading ──
  PROPOSAL_VIEWED: 'trade_proposal_viewed',
  PROPOSAL_ACCEPTED: 'trade_proposal_accepted',
  PROPOSAL_DECLINED: 'trade_proposal_declined',
  CONFIRMATION_OPENED: 'trade_confirmation_opened',
  TRADE_EXECUTED: 'trade_executed',
  TRADE_FAILED: 'trade_failed',

  // ── Deposits & Withdrawals ──
  DEPOSIT_SHEET_OPENED: 'deposit_sheet_opened',
  DEPOSIT_TAB_CHANGED: 'deposit_tab_changed',
  DEPOSIT_ADDRESS_COPIED: 'deposit_address_copied',
  DEPOSIT_ONRAMP_STARTED: 'deposit_onramp_started',
  WITHDRAW_SHEET_OPENED: 'withdraw_sheet_opened',
  WITHDRAW_INITIATED: 'withdraw_initiated',
  WITHDRAW_COMPLETED: 'withdraw_completed',

  // ── Subscription & Monetization ──
  TIER_COMPARISON_OPENED: 'subscription_tier_comparison_opened',
  BILLING_CYCLE_TOGGLED: 'subscription_billing_cycle_toggled',
  CHECKOUT_STARTED: 'subscription_checkout_started',
  CHECKOUT_COMPLETED: 'subscription_checkout_completed',
  PORTAL_OPENED: 'subscription_portal_opened',
  UPGRADE_NUDGE_CLICKED: 'subscription_upgrade_nudge_clicked',
  LOCKED_CARD_CLICKED: 'subscription_locked_card_clicked',

  // ── Telegram ──
  TELEGRAM_CONNECT_STARTED: 'telegram_connect_started',

  // ── Errors ──
  TRADE_ERROR_SHOWN: 'error_trade_shown',
} as const;

export type AnalyticsEventName = (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent];

/** Track a typed analytics event with optional properties */
export function track(
  event: AnalyticsEventName,
  properties?: Record<string, string | boolean | number | null>
): void {
  if (!POSTHOG_KEY) return;
  posthog.capture(event, properties);
}
