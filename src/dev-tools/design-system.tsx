/**
 * Vela Design System dev tool.
 *
 * Renders a snapshot of every token in src/styles/vela-design-system.css
 * grouped by the semantic categories established in VELA-BRAND-SYSTEM-V2.md
 * and docs/claude-reference/design-system-guide.md, plus typography samples,
 * spacing, radius, elevation, motion, z-index, and live previews of every
 * default-state component exported from src/components/VelaComponents.tsx.
 *
 * Token registry (TOKEN_REGISTRY) is the source of truth for grouping and
 * usage notes. Tokens parsed from the raw CSS that aren't in the registry
 * fall through to the "Misc / Undocumented" section so we can spot drift.
 * Tokens documented in the brand doc but missing from the CSS appear as
 * "Documented but not implemented" gaps in the same section.
 *
 * Tokens are parsed from the raw CSS at build time via Vite's `?raw` import,
 * then resolved at runtime via getComputedStyle(document.body) so cascaded
 * values reflect reality.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import tokensRaw from '../styles/vela-design-system.css?raw';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Grid,
  Input,
  LoadingSpinner,
  PageHeader,
  Row,
  Select,
  Stack,
  StatCard,
  TextArea,
} from '../components/VelaComponents';
import '../styles/vela-design-system.css';

declare const __BUILD_DATE__: string;

// ── Token registry ────────────────────────────────────────────────────
//
// Every token gets a (group, usage) entry pulled from the brand docs. Group
// keys map 1:1 to render sections. Tokens in the CSS but absent here render
// in the "Misc / Undocumented" section. Tokens listed in DOCUMENTED_BUT_MISSING
// were called out in the brand doc but aren't in the CSS yet.

type GroupId =
  | 'brand'
  | 'surface'
  | 'text'
  | 'border-color'
  | 'action'
  | 'signal'
  | 'status'
  | 'state'
  | 'data-viz'
  | 'color-primitive'
  | 'type-composite'
  | 'type-primitive'
  | 'spacing'
  | 'border-width'
  | 'radius'
  | 'elevation'
  | 'motion'
  | 'z-index'
  | 'privy';

interface TokenEntry {
  group: GroupId;
  usage: string;
}

const NEVER_REUSE_SIGNAL =
  'Signal direction is semantically reserved. Never reuse for non-signal UI.';

const TOKEN_REGISTRY: Record<string, TokenEntry> = {
  // ── Brand identity (Signal Green, Ink, Cream, Purple) ──────────────
  '--vela-signal-green': {
    group: 'brand',
    usage:
      'Brand accent. Logomark iris, signal pulse rings, hero highlights. The one ownable color (#0FE68C).',
  },
  '--vela-ink': {
    group: 'brand',
    usage:
      'Primary dark. Body text and logomark strokes in light mode. Pair with cream for the neobrutalist core.',
  },
  '--vela-cream': {
    group: 'brand',
    usage: 'Primary light. Page backgrounds and logomark strokes in dark contexts.',
  },
  '--vela-purple': {
    group: 'brand',
    usage:
      'Vela purple. Marketing accents, the dot in the wordmark, and the data-1 series in charts.',
  },
  '--vela-purple-dark': {
    group: 'brand',
    usage: 'Hover state for the brand purple button.',
  },
  '--vela-purple-light': {
    group: 'brand',
    usage: 'Subtle purple tint for brand-adjacent surfaces.',
  },

  // ── Surface backgrounds ────────────────────────────────────────────
  '--color-bg-page': {
    group: 'surface',
    usage: 'Default page background. Cream wash that anchors every screen.',
  },
  '--color-bg-surface': {
    group: 'surface',
    usage: 'Cards, panels, and any raised surface that sits on the page.',
  },
  '--color-bg-surface-subtle': {
    group: 'surface',
    usage: 'Lightly tinted surface for nested content inside cards. Lavender-50.',
  },
  '--color-bg-elevated': {
    group: 'surface',
    usage: 'Modal panels and floating sheets that need to read above the page.',
  },
  '--color-bg-overlay': {
    group: 'surface',
    usage: 'Modal backdrop scrim. 50% black for focus trapping.',
  },

  // ── Text ───────────────────────────────────────────────────────────
  '--color-text-primary': {
    group: 'text',
    usage: 'Body copy and headings. 13.2:1 on cream (WCAG AAA).',
  },
  '--color-text-secondary': {
    group: 'text',
    usage: 'Supporting copy. 7.8:1 on cream (close to AAA). Use for subheads, helper labels.',
  },
  '--color-text-muted': {
    group: 'text',
    usage: 'Captions, timestamps, secondary metadata.',
  },
  '--color-text-disabled': {
    group: 'text',
    usage: 'Inactive form fields and disabled actions.',
  },
  '--color-text-on-accent': {
    group: 'text',
    usage: 'Text placed on a filled brand or action button. White on purple, white on blue.',
  },
  '--color-text-inverse': {
    group: 'text',
    usage: 'Text on dark surfaces (e.g. footer, dark hero strips).',
  },

  // ── Border colors ──────────────────────────────────────────────────
  '--color-border-default': {
    group: 'border-color',
    usage: 'The defining 3px black outline of every neobrutalist edge. Cards, buttons, badges.',
  },
  '--color-border-subtle': {
    group: 'border-color',
    usage: 'Hairline dividers between rows in lists and tables.',
  },
  '--color-border-muted': {
    group: 'border-color',
    usage: 'Light dividers under headers, toolbars, and footer strips.',
  },

  // ── Action / brand buttons ─────────────────────────────────────────
  '--color-brand': {
    group: 'action',
    usage: 'Brand button fill (Vela purple). Use for high-priority brand CTAs.',
  },
  '--color-brand-hover': {
    group: 'action',
    usage: 'Brand button hover state.',
  },
  '--color-brand-light': {
    group: 'action',
    usage: 'Subtle purple background for brand-adjacent surfaces.',
  },
  '--color-action-primary': {
    group: 'action',
    usage: 'Default primary button (action blue). Use for the main "Get started" path on a screen.',
  },
  '--color-action-primary-hover': {
    group: 'action',
    usage: 'Primary button hover state.',
  },
  '--color-action-primary-bg': {
    group: 'action',
    usage: 'Soft fill behind a primary action (focus ring, selected chip).',
  },

  // ── Signal direction (RESERVED) ────────────────────────────────────
  '--color-signal-buy': {
    group: 'signal',
    usage: `BUY signal direction. ${NEVER_REUSE_SIGNAL}`,
  },
  '--color-signal-sell': {
    group: 'signal',
    usage: `SHORT signal direction. ${NEVER_REUSE_SIGNAL}`,
  },
  '--color-signal-wait': {
    group: 'signal',
    usage: `WAIT signal direction. ${NEVER_REUSE_SIGNAL}`,
  },

  // ── Status chips (BUY / SELL / WAIT / NEUTRAL + variants) ──────────
  '--color-status-buy-bg': {
    group: 'status',
    usage: 'Background fill for BUY chips and confirmation badges.',
  },
  '--color-status-buy-text': {
    group: 'status',
    usage: 'Text color on a BUY chip. Pairs with the buy bg for AA contrast.',
  },
  '--color-status-buy-border': {
    group: 'status',
    usage: 'Border color for BUY chips.',
  },
  '--color-status-sell-bg': {
    group: 'status',
    usage: 'Background fill for SELL / SHORT chips.',
  },
  '--color-status-sell-text': {
    group: 'status',
    usage: 'Text color on a SELL / SHORT chip.',
  },
  '--color-status-sell-border': {
    group: 'status',
    usage: 'Border color for SELL / SHORT chips.',
  },
  '--color-status-wait-bg': {
    group: 'status',
    usage: 'Background fill for WAIT chips.',
  },
  '--color-status-wait-text': {
    group: 'status',
    usage: 'Text color on a WAIT chip.',
  },
  '--color-status-wait-border': {
    group: 'status',
    usage: 'Border color for WAIT chips.',
  },
  '--color-status-wait-near-bg': {
    group: 'status',
    usage: 'Heating-up WAIT background. Subtle green tint for "approaching confirmation".',
  },
  '--color-status-wait-near-text': {
    group: 'status',
    usage: 'Text on a heating-up WAIT chip.',
  },
  '--color-status-wait-near-border': {
    group: 'status',
    usage: 'Border on a heating-up WAIT chip.',
  },
  '--color-status-wait-near-dot': {
    group: 'status',
    usage: 'Dot indicator on a heating-up WAIT chip.',
  },
  '--color-banner-urgent-bg': {
    group: 'status',
    usage: 'Pending-banner background when a trade window is closing (last 60m / 10m).',
  },
  '--color-banner-urgent-border': {
    group: 'status',
    usage: 'Border on the urgent pending banner.',
  },
  '--color-banner-urgent-text': {
    group: 'status',
    usage: 'Text on the urgent pending banner.',
  },
  '--color-status-neutral-bg': {
    group: 'status',
    usage: 'Neutral / IDLE chip background. Use when no signal direction applies.',
  },
  '--color-status-neutral-text': {
    group: 'status',
    usage: 'Text on a neutral chip.',
  },
  '--color-status-neutral-border': {
    group: 'status',
    usage: 'Border on a neutral chip.',
  },

  // ── Functional state ───────────────────────────────────────────────
  '--color-success': {
    group: 'state',
    usage:
      'Functional success messaging (toast, alert, form validation). Distinct from the BUY signal token.',
  },
  '--color-warning': {
    group: 'state',
    usage: 'Functional warnings (low balance, missing input).',
  },
  '--color-error': {
    group: 'state',
    usage:
      'Functional errors (failed action, blocked submission). Distinct from the SELL signal token.',
  },
  '--color-info': {
    group: 'state',
    usage: 'Informational alerts and links.',
  },

  // ── Data visualization (semantic per brand doc) ────────────────────
  '--data-1': {
    group: 'data-viz',
    usage: 'Brand / Vela signals. Purple anchors the primary chart series.',
  },
  '--data-2': {
    group: 'data-viz',
    usage: 'Trend strength. Blue for moving averages and trend overlays.',
  },
  '--data-3': {
    group: 'data-viz',
    usage: 'Profitability. Green for cumulative P&L and win-rate lines.',
  },
  '--data-4': {
    group: 'data-viz',
    usage: 'Volatility. Amber for ATR, IV, and range indicators.',
  },
  '--data-5': {
    group: 'data-viz',
    usage: 'Risk / drawdown. Red for max-DD shading and stop levels.',
  },
  '--data-6': {
    group: 'data-viz',
    usage: 'Sentiment. Pink for social and news sentiment overlays.',
  },

  // ── Color primitives (raw palette, not for direct use) ─────────────
  '--white': {
    group: 'color-primitive',
    usage: 'Raw white. Prefer --color-bg-surface in product UI.',
  },
  '--black': {
    group: 'color-primitive',
    usage: 'Raw black. Prefer --color-border-default for borders.',
  },
  '--cream-base': { group: 'color-primitive', usage: 'Raw cream base behind --color-bg-page.' },
  '--gray-50': {
    group: 'color-primitive',
    usage: 'Lightest gray. Used inside neutral status chips.',
  },
  '--gray-100': { group: 'color-primitive', usage: 'Very light gray for subtle dividers.' },
  '--gray-200': { group: 'color-primitive', usage: 'Light gray. Backs --color-border-muted.' },
  '--gray-300': { group: 'color-primitive', usage: 'Light gray for inactive states.' },
  '--gray-400': {
    group: 'color-primitive',
    usage: 'Medium gray. Backs --color-text-disabled and --color-border-subtle.',
  },
  '--gray-500': { group: 'color-primitive', usage: 'Mid gray for secondary icons.' },
  '--gray-600': { group: 'color-primitive', usage: 'Dark gray. Backs --color-text-muted.' },
  '--gray-700': {
    group: 'color-primitive',
    usage: 'Darker gray. Backs --color-text-secondary for AA contrast.',
  },
  '--gray-800': { group: 'color-primitive', usage: 'Near-black gray for high-emphasis dark text.' },
  '--gray-900': {
    group: 'color-primitive',
    usage: 'Slate-black. Backs --color-text-primary on cream.',
  },
  '--lavender-50': { group: 'color-primitive', usage: 'Lavender card background tint.' },
  '--lavender-100': { group: 'color-primitive', usage: 'Stronger lavender for elevated surfaces.' },
  '--mint-50': { group: 'color-primitive', usage: 'Mint card background tint.' },
  '--mint-100': { group: 'color-primitive', usage: 'Stronger mint for emphasis surfaces.' },
  '--peach-50': { group: 'color-primitive', usage: 'Peach card background tint.' },
  '--peach-100': { group: 'color-primitive', usage: 'Stronger peach for emphasis surfaces.' },
  '--sky-50': { group: 'color-primitive', usage: 'Sky card background tint.' },
  '--sky-100': { group: 'color-primitive', usage: 'Stronger sky for emphasis surfaces.' },
  '--blue-primary': {
    group: 'color-primitive',
    usage: 'Raw action blue. Backs --color-action-primary.',
  },
  '--blue-hover': { group: 'color-primitive', usage: 'Action blue hover.' },
  '--blue-light': {
    group: 'color-primitive',
    usage: 'Action blue tint for focus rings and selected states.',
  },
  '--blue-bg': { group: 'color-primitive', usage: 'Action blue surface tint.' },
  '--blue-accent': { group: 'color-primitive', usage: 'Brighter blue for highlight accents.' },
  '--warm-cream': {
    group: 'color-primitive',
    usage: 'Warm cream for first-trade and onboarding surfaces.',
  },
  '--warm-cream-border': {
    group: 'color-primitive',
    usage: 'Border that pairs with --warm-cream.',
  },
  '--green-primary': {
    group: 'color-primitive',
    usage: 'Raw signal green primitive. Backs --color-signal-buy and --color-success.',
  },
  '--green-dark': { group: 'color-primitive', usage: 'Darker green for text on green chips.' },
  '--green-light': { group: 'color-primitive', usage: 'Light green for up-arrow badges.' },
  '--green-bg': { group: 'color-primitive', usage: 'Soft green surface tint behind buy chips.' },
  '--green-tint': {
    group: 'color-primitive',
    usage:
      'Brand-adjacent green tint that does not read as a signal. Used on the Premium plan card.',
  },
  '--red-primary': {
    group: 'color-primitive',
    usage: 'Raw red primitive. Backs --color-signal-sell and --color-error.',
  },
  '--red-dark': { group: 'color-primitive', usage: 'Darker red for text on red chips.' },
  '--red-light': { group: 'color-primitive', usage: 'Light red for down-arrow badges.' },
  '--red-bg': { group: 'color-primitive', usage: 'Soft red surface tint behind sell chips.' },
  '--amber-primary': {
    group: 'color-primitive',
    usage: 'Raw amber primitive. Backs --color-signal-wait and --color-warning.',
  },
  '--amber-dark': { group: 'color-primitive', usage: 'Darker amber for text on amber chips.' },
  '--amber-light': {
    group: 'color-primitive',
    usage: 'Light amber for urgent banner backgrounds.',
  },
  '--amber-bg': { group: 'color-primitive', usage: 'Soft amber surface tint behind wait chips.' },

  // ── Composite type tokens ──────────────────────────────────────────
  '--type-display-xl-font': {
    group: 'type-composite',
    usage: 'Display XL family (Space Grotesk). Hero headlines on marketing surfaces.',
  },
  '--type-display-xl-size': { group: 'type-composite', usage: 'Display XL size. 36px / text-4xl.' },
  '--type-display-xl-weight': { group: 'type-composite', usage: 'Display XL weight (bold).' },
  '--type-display-xl-line-height': { group: 'type-composite', usage: 'Display XL line height.' },
  '--type-display-xl-tracking': { group: 'type-composite', usage: 'Display XL tracking.' },
  '--type-display-lg-font': {
    group: 'type-composite',
    usage: 'Display LG family (Space Grotesk). Section openers.',
  },
  '--type-display-lg-size': { group: 'type-composite', usage: 'Display LG size. 30px / text-3xl.' },
  '--type-display-lg-weight': { group: 'type-composite', usage: 'Display LG weight (bold).' },
  '--type-display-lg-line-height': { group: 'type-composite', usage: 'Display LG line height.' },
  '--type-heading-xl-font': {
    group: 'type-composite',
    usage: 'Heading XL family. Page titles in product.',
  },
  '--type-heading-xl-size': { group: 'type-composite', usage: 'Heading XL size. 24px / text-2xl.' },
  '--type-heading-xl-weight': { group: 'type-composite', usage: 'Heading XL weight (bold).' },
  '--type-heading-xl-line-height': { group: 'type-composite', usage: 'Heading XL line height.' },
  '--type-heading-lg-font': {
    group: 'type-composite',
    usage: 'Heading LG family. Card titles and section headers.',
  },
  '--type-heading-lg-size': { group: 'type-composite', usage: 'Heading LG size. 20px / text-xl.' },
  '--type-heading-lg-weight': { group: 'type-composite', usage: 'Heading LG weight (semibold).' },
  '--type-heading-lg-line-height': { group: 'type-composite', usage: 'Heading LG line height.' },
  '--type-heading-base-font': {
    group: 'type-composite',
    usage: 'Heading base family. Inline subheads.',
  },
  '--type-heading-base-size': {
    group: 'type-composite',
    usage: 'Heading base size. 16px / text-base.',
  },
  '--type-heading-base-weight': {
    group: 'type-composite',
    usage: 'Heading base weight (semibold).',
  },
  '--type-heading-base-line-height': {
    group: 'type-composite',
    usage: 'Heading base line height.',
  },
  '--type-body-lg-font': {
    group: 'type-composite',
    usage: 'Body LG family (Inter). Lead paragraphs.',
  },
  '--type-body-lg-size': { group: 'type-composite', usage: 'Body LG size. 18px / text-lg.' },
  '--type-body-lg-weight': { group: 'type-composite', usage: 'Body LG weight (normal).' },
  '--type-body-lg-line-height': {
    group: 'type-composite',
    usage: 'Body LG line height (relaxed).',
  },
  '--type-body-base-font': {
    group: 'type-composite',
    usage: 'Body base family (Inter). Default product copy.',
  },
  '--type-body-base-size': { group: 'type-composite', usage: 'Body base size. 16px / text-base.' },
  '--type-body-base-weight': { group: 'type-composite', usage: 'Body base weight (normal).' },
  '--type-body-base-line-height': {
    group: 'type-composite',
    usage: 'Body base line height (normal).',
  },
  '--type-body-sm-font': {
    group: 'type-composite',
    usage: 'Body SM family (Inter). Helper text and dense rows.',
  },
  '--type-body-sm-size': { group: 'type-composite', usage: 'Body SM size. 14px / text-sm.' },
  '--type-body-sm-weight': { group: 'type-composite', usage: 'Body SM weight (normal).' },
  '--type-body-sm-line-height': { group: 'type-composite', usage: 'Body SM line height.' },
  '--type-label-lg-font': {
    group: 'type-composite',
    usage: 'Label LG family (Inter). Button copy on the largest CTAs.',
  },
  '--type-label-lg-size': { group: 'type-composite', usage: 'Label LG size. 16px.' },
  '--type-label-lg-weight': { group: 'type-composite', usage: 'Label LG weight (semibold).' },
  '--type-label-lg-line-height': { group: 'type-composite', usage: 'Label LG line height.' },
  '--type-label-lg-tracking': { group: 'type-composite', usage: 'Label LG tracking (wide).' },
  '--type-label-base-font': {
    group: 'type-composite',
    usage: 'Label base family (Inter). Default button and form-label copy.',
  },
  '--type-label-base-size': { group: 'type-composite', usage: 'Label base size. 14px.' },
  '--type-label-base-weight': { group: 'type-composite', usage: 'Label base weight (semibold).' },
  '--type-label-base-line-height': { group: 'type-composite', usage: 'Label base line height.' },
  '--type-label-base-tracking': { group: 'type-composite', usage: 'Label base tracking (wide).' },
  '--type-label-sm-font': {
    group: 'type-composite',
    usage: 'Label SM family (Inter). Badge and chip copy.',
  },
  '--type-label-sm-size': { group: 'type-composite', usage: 'Label SM size. 12px.' },
  '--type-label-sm-weight': { group: 'type-composite', usage: 'Label SM weight (semibold).' },
  '--type-label-sm-line-height': { group: 'type-composite', usage: 'Label SM line height.' },
  '--type-label-sm-tracking': { group: 'type-composite', usage: 'Label SM tracking (wide).' },
  '--type-mono-lg-font': {
    group: 'type-composite',
    usage: 'Mono LG family (JetBrains Mono). Featured prices and large numerics.',
  },
  '--type-mono-lg-size': { group: 'type-composite', usage: 'Mono LG size. 20px.' },
  '--type-mono-lg-weight': { group: 'type-composite', usage: 'Mono LG weight (bold).' },
  '--type-mono-lg-line-height': { group: 'type-composite', usage: 'Mono LG line height.' },
  '--type-mono-base-font': {
    group: 'type-composite',
    usage: 'Mono base family. Inline prices and numerics in tables.',
  },
  '--type-mono-base-size': { group: 'type-composite', usage: 'Mono base size. 16px.' },
  '--type-mono-base-weight': { group: 'type-composite', usage: 'Mono base weight (semibold).' },
  '--type-mono-base-line-height': { group: 'type-composite', usage: 'Mono base line height.' },

  // ── Type primitives ────────────────────────────────────────────────
  '--text-2xs': {
    group: 'type-primitive',
    usage: '10px. Reserved for label-tracking copy and dense badges.',
  },
  '--text-xs': { group: 'type-primitive', usage: '12px. Captions and helper text.' },
  '--text-sm': { group: 'type-primitive', usage: '14px. Default for dense product copy.' },
  '--text-base': { group: 'type-primitive', usage: '16px. Default body size.' },
  '--text-lg': { group: 'type-primitive', usage: '18px. Lead paragraph size.' },
  '--text-xl': { group: 'type-primitive', usage: '20px. Card titles and inline headers.' },
  '--text-2xl': { group: 'type-primitive', usage: '24px. Page headings.' },
  '--text-3xl': { group: 'type-primitive', usage: '30px. Section openers.' },
  '--text-4xl': { group: 'type-primitive', usage: '36px. Hero headlines on marketing.' },
  '--weight-normal': { group: 'type-primitive', usage: 'Default body weight (400).' },
  '--weight-medium': { group: 'type-primitive', usage: 'Body emphasis weight (500).' },
  '--weight-semibold': { group: 'type-primitive', usage: 'Subheading and label weight (600).' },
  '--weight-bold': { group: 'type-primitive', usage: 'Heading weight (700).' },
  '--weight-black': {
    group: 'type-primitive',
    usage: 'Wordmark weight (900). Used for the "vela" logotype.',
  },
  '--leading-tight': {
    group: 'type-primitive',
    usage: 'Line height 1.25. Display and mono numerics.',
  },
  '--leading-snug': { group: 'type-primitive', usage: 'Line height 1.375. Headings.' },
  '--leading-normal': { group: 'type-primitive', usage: 'Line height 1.5. Default body.' },
  '--leading-relaxed': { group: 'type-primitive', usage: 'Line height 1.625. Lead paragraphs.' },
  '--tracking-tight': {
    group: 'type-primitive',
    usage: 'Letter spacing -0.02em. Used on display and the wordmark.',
  },
  '--tracking-normal': { group: 'type-primitive', usage: 'Letter spacing 0. Default body.' },
  '--tracking-wide': {
    group: 'type-primitive',
    usage: 'Letter spacing 0.04em. Uppercase labels and chip copy.',
  },

  // ── Spacing ────────────────────────────────────────────────────────
  '--space-1': {
    group: 'spacing',
    usage: '4px. Smallest gap. Use between an icon and its inline label.',
  },
  '--space-2': { group: 'spacing', usage: '8px. Tight stacks (badge rows, button icon gaps).' },
  '--space-3': {
    group: 'spacing',
    usage: '12px. Compact padding inside small chips and tight cards.',
  },
  '--space-4': { group: 'spacing', usage: '16px. Default sibling gap. Standard card padding.' },
  '--space-5': { group: 'spacing', usage: '20px. Comfortable inner padding for medium cards.' },
  '--space-6': {
    group: 'spacing',
    usage: '24px. Default card padding. Stack gap between major rows.',
  },
  '--space-7': {
    group: 'spacing',
    usage: '28px. Granularity step between 24 and 32 (added in v2.0).',
  },
  '--space-8': { group: 'spacing', usage: '32px. Large stack gap.' },
  '--space-9': {
    group: 'spacing',
    usage: '36px. Granularity step between 32 and 40 (added in v2.0).',
  },
  '--space-10': { group: 'spacing', usage: '40px. Section spacing on dense pages.' },
  '--space-12': { group: 'spacing', usage: '48px. Section spacing on standard pages.' },
  '--space-16': { group: 'spacing', usage: '64px. Hero section spacing.' },
  '--space-20': { group: 'spacing', usage: '80px. Top-of-page hero or marketing-section spacing.' },

  // ── Border widths ──────────────────────────────────────────────────
  '--border-thin': { group: 'border-width', usage: '1px. Hairline dividers and table rules.' },
  '--border-medium': { group: 'border-width', usage: '2px. Inputs, badges, nested cards.' },
  '--border-thick': {
    group: 'border-width',
    usage: '3px. The neobrutalist standard for cards and buttons.',
  },
  '--border-heavy': {
    group: 'border-width',
    usage: '4px. High-contrast emphasis only. Reserved for hero CTAs.',
  },

  // ── Radius ─────────────────────────────────────────────────────────
  '--radius-sm': { group: 'radius', usage: '8px. Badges, chips, small inputs.' },
  '--radius-md': { group: 'radius', usage: '12px. Buttons and standard inputs.' },
  '--radius-lg': { group: 'radius', usage: '16px. Default card radius.' },
  '--radius-xl': { group: 'radius', usage: '24px. Hero cards and large modals.' },
  '--radius-full': { group: 'radius', usage: 'Pill / circle. Avatars and dot indicators.' },

  // ── Elevation (neobrutalist solid offsets) ─────────────────────────
  '--shadow-xs': {
    group: 'elevation',
    usage: '2px / 2px solid black. Pressed and nested-card states.',
  },
  '--shadow-sm': {
    group: 'elevation',
    usage: '3px / 3px solid black. Default card and button rest state.',
  },
  '--shadow-md': {
    group: 'elevation',
    usage: '4px / 4px solid black. Card and button hover state.',
  },
  '--shadow-lg': {
    group: 'elevation',
    usage: '6px / 6px solid black. Modals and floating panels.',
  },
  '--shadow-xl': { group: 'elevation', usage: '8px / 8px solid black. Marketing-tier emphasis.' },

  // ── Motion ─────────────────────────────────────────────────────────
  '--motion-fast': {
    group: 'motion',
    usage: '120ms. Button hover, icon swap, subtle state change.',
  },
  '--motion-normal': {
    group: 'motion',
    usage: '180ms. Card hover, panel slide, default UI motion.',
  },
  '--motion-slow': {
    group: 'motion',
    usage: '300ms. Modal entry, drawer reveal, page transitions.',
  },
  '--motion-ease-out': {
    group: 'motion',
    usage: 'cubic-bezier(0.2, 0.85, 0.4, 1). Default UI easing. Fast in, soft out.',
  },
  '--motion-ease-in-out': {
    group: 'motion',
    usage: 'cubic-bezier(0.4, 0, 0.2, 1). Symmetric easing for crossfades.',
  },

  // ── Z-index ────────────────────────────────────────────────────────
  '--z-base': { group: 'z-index', usage: '0. Default page flow.' },
  '--z-dropdown': { group: 'z-index', usage: '100. Select and menu surfaces.' },
  '--z-sticky': { group: 'z-index', usage: '200. Sticky headers and section nav.' },
  '--z-fixed': { group: 'z-index', usage: '300. Fixed bottom bars and floating actions.' },
  '--z-modal-backdrop': { group: 'z-index', usage: '400. Scrim behind modals.' },
  '--z-modal': { group: 'z-index', usage: '500. Modal panels.' },
  '--z-popover': { group: 'z-index', usage: '600. Popovers anchored to triggers.' },
  '--z-tooltip': { group: 'z-index', usage: '700. Tooltips above popovers.' },
  '--z-notification': {
    group: 'z-index',
    usage: '800. Toasts and notification stacks (top of stack).',
  },

  // ── Privy bridge tokens ────────────────────────────────────────────
  '--privy-border-radius-sm': {
    group: 'privy',
    usage: 'Privy modal small radius. Bridges to --radius-sm.',
  },
  '--privy-border-radius-md': {
    group: 'privy',
    usage: 'Privy modal medium radius. Bridges to --radius-md.',
  },
  '--privy-border-radius-lg': {
    group: 'privy',
    usage: 'Privy modal large radius. Bridges to --radius-lg.',
  },
  '--privy-border-radius-full': {
    group: 'privy',
    usage: 'Privy modal pill radius. Bridges to --radius-full.',
  },
  '--privy-color-background': {
    group: 'privy',
    usage: 'Privy modal page background. Bridges to --color-bg-page.',
  },
  '--privy-color-background-2': {
    group: 'privy',
    usage: 'Privy modal surface. Bridges to --color-bg-surface.',
  },
  '--privy-color-background-3': {
    group: 'privy',
    usage: 'Privy modal subtle background. Bridges to --gray-100.',
  },
  '--privy-color-foreground': {
    group: 'privy',
    usage: 'Privy modal primary text. Bridges to --color-text-primary.',
  },
  '--privy-color-foreground-2': {
    group: 'privy',
    usage: 'Privy modal secondary text. Bridges to --color-text-secondary.',
  },
  '--privy-color-foreground-3': {
    group: 'privy',
    usage: 'Privy modal muted text. Bridges to --color-text-muted.',
  },
  '--privy-color-foreground-4': {
    group: 'privy',
    usage: 'Privy modal disabled text. Bridges to --color-text-disabled.',
  },
  '--privy-color-foreground-accent': {
    group: 'privy',
    usage: 'Privy modal text on accent. Bridges to --color-text-on-accent.',
  },
  '--privy-color-accent': {
    group: 'privy',
    usage: 'Privy modal accent. Bridges to --color-action-primary.',
  },
  '--privy-color-accent-light': {
    group: 'privy',
    usage: 'Privy modal accent (lighter). Bridges to --blue-accent.',
  },
  '--privy-color-accent-lightest': {
    group: 'privy',
    usage: 'Privy modal accent (lightest). Bridges to --blue-light.',
  },
  '--privy-color-accent-dark': {
    group: 'privy',
    usage: 'Privy modal accent hover. Bridges to --color-action-primary-hover.',
  },
  '--privy-color-accent-darkest': {
    group: 'privy',
    usage: 'Privy modal accent pressed. Bridges to --color-action-primary-hover.',
  },
  '--privy-color-success': {
    group: 'privy',
    usage: 'Privy modal success. Bridges to --color-success.',
  },
  '--privy-color-error': { group: 'privy', usage: 'Privy modal error. Bridges to --color-error.' },
  '--privy-color-error-light': {
    group: 'privy',
    usage: 'Privy modal error tint. Bridges to --red-light.',
  },
};

// Tokens called out in the brand doc that aren't (yet) in the CSS.
// Surfaced in the Misc section so the gap is visible.
interface DocumentedGap {
  name: string;
  reason: string;
}

const DOCUMENTED_BUT_MISSING: DocumentedGap[] = [];

// Group metadata: title, summary, render style.
interface GroupMeta {
  id: GroupId;
  title: string;
  description: string;
  render:
    | 'swatch'
    | 'spacing-bar'
    | 'radius-grid'
    | 'shadow-grid'
    | 'motion-row'
    | 'z-row'
    | 'type-list';
}

const GROUP_ORDER: GroupMeta[] = [
  {
    id: 'brand',
    title: 'Brand identity',
    description:
      'Signal Green, Ink, Cream, and Vela purple. The ownable colors that carry the identity.',
    render: 'swatch',
  },
  {
    id: 'surface',
    title: 'Surface',
    description: 'Page, card, elevated, and overlay backgrounds.',
    render: 'swatch',
  },
  {
    id: 'text',
    title: 'Text',
    description: 'Hierarchy of text colors. Each step meets WCAG AA on cream.',
    render: 'swatch',
  },
  {
    id: 'border-color',
    title: 'Border colors',
    description:
      'The 3px black outline is the defining neobrutalist edge. Subtler colors are for dividers only.',
    render: 'swatch',
  },
  {
    id: 'action',
    title: 'Action and brand buttons',
    description:
      'Primary action (blue) and brand action (purple). Use one per screen as the dominant CTA.',
    render: 'swatch',
  },
  {
    id: 'signal',
    title: 'Signal direction (reserved)',
    description:
      'Green = BUY, red = SELL, amber = WAIT. Semantically reserved by the design-system guide. Never reuse for non-signal UI.',
    render: 'swatch',
  },
  {
    id: 'status',
    title: 'Status chips and banners',
    description:
      'Buy / sell / wait chip surfaces, plus the heating-up WAIT and urgent pending-banner states.',
    render: 'swatch',
  },
  {
    id: 'state',
    title: 'Functional state',
    description:
      'Success, warning, error, and info messaging. Distinct from signal direction tokens.',
    render: 'swatch',
  },
  {
    id: 'data-viz',
    title: 'Data visualization',
    description:
      'Each chart color carries meaning across charts: brand, trend, profitability, volatility, risk, sentiment.',
    render: 'swatch',
  },
  {
    id: 'color-primitive',
    title: 'Color primitives',
    description:
      'Raw palette behind the semantic tokens above. Avoid using these directly. Reach for a semantic alias first.',
    render: 'swatch',
  },
  {
    id: 'type-composite',
    title: 'Composite type tokens',
    description:
      'Pre-configured Display / Heading / Body / Label / Mono families. Pull a whole style with one token group.',
    render: 'type-list',
  },
  {
    id: 'type-primitive',
    title: 'Type primitives',
    description:
      'Underlying size, weight, leading, and tracking values that the composite tokens compose.',
    render: 'type-list',
  },
  {
    id: 'spacing',
    title: 'Spacing',
    description: 'Linear scale in 4px / 8px steps. Default sibling gap is --space-4 (16px).',
    render: 'spacing-bar',
  },
  {
    id: 'border-width',
    title: 'Border widths',
    description:
      'Neobrutalist edges are 3-4px black. Anything thinner is for dividers, not affordances.',
    render: 'spacing-bar',
  },
  {
    id: 'radius',
    title: 'Radius',
    description:
      'Soft corners on buttons, cards, and chips. Pill radius for avatars and dot indicators.',
    render: 'radius-grid',
  },
  {
    id: 'elevation',
    title: 'Elevation',
    description: 'Solid black offsets, no blur. Hover steps shadow up by one level.',
    render: 'shadow-grid',
  },
  {
    id: 'motion',
    title: 'Motion',
    description: 'Three speeds, two easings. All motion respects prefers-reduced-motion.',
    render: 'motion-row',
  },
  {
    id: 'z-index',
    title: 'Z-index layers',
    description: 'Documented stacking order. Each layer is +100 from the previous.',
    render: 'z-row',
  },
  {
    id: 'privy',
    title: 'Privy modal bridge',
    description:
      'Maps Privy login modal CSS variables to our semantic tokens so the auth handoff feels continuous.',
    render: 'swatch',
  },
];

// ── Token parsing ─────────────────────────────────────────────────────

interface ParsedToken {
  name: string;
  rawValue: string;
}

function parseTokens(css: string): ParsedToken[] {
  // Match --name: value; declarations. Skip anything where the captured value
  // contains a `{` or `}` (catches false matches in selectors like
  // `.vela-signal-pulse--active::before`).
  const seen = new Map<string, ParsedToken>();
  const re = /(--[a-zA-Z0-9-]+)\s*:\s*([^;{}]+);/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css)) !== null) {
    const name = match[1].trim();
    const rawValue = match[2].trim();
    if (!seen.has(name)) seen.set(name, { name, rawValue });
  }
  return Array.from(seen.values());
}

const ALL_TOKENS = parseTokens(tokensRaw);

// ── Resolution helpers ────────────────────────────────────────────────

function resolveToken(name: string): string {
  if (typeof window === 'undefined') return '';
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function pxFromVar(varExpr: string): string {
  const name = varExpr.match(/var\((--[^)]+)\)/)?.[1];
  if (!name) return varExpr;
  const v = resolveToken(name);
  if (!v) return varExpr;
  if (v.endsWith('rem')) {
    const n = parseFloat(v);
    if (!Number.isNaN(n)) return `${Math.round(n * 16)}px`;
  }
  return v;
}

// ── Layout primitives ─────────────────────────────────────────────────

function SectionHeader({
  title,
  count,
  description,
}: {
  title: string;
  count?: number;
  description?: string;
}) {
  return (
    <header
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
        marginBottom: 'var(--space-4)',
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap' }}
      >
        <h2 className="vela-heading-xl" style={{ color: 'var(--color-text-primary)', margin: 0 }}>
          {title}
        </h2>
        {typeof count === 'number' && (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            {count} token{count === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {description && (
        <p
          style={{
            margin: 0,
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-secondary)',
            maxWidth: 720,
          }}
        >
          {description}
        </p>
      )}
    </header>
  );
}

function isReservedSignalToken(name: string): boolean {
  return name.startsWith('--color-signal-');
}

function ColorSwatch({ token }: { token: ParsedToken }) {
  const usage = TOKEN_REGISTRY[token.name]?.usage;
  const reserved = isReservedSignalToken(token.name);
  const [resolved, setResolved] = useState('');
  useEffect(() => {
    setResolved(resolveToken(token.name));
  }, [token.name]);
  return (
    <div
      style={{
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-muted)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        aria-hidden
        style={{
          background: `var(${token.name})`,
          height: 80,
          borderBottom: '1px solid var(--color-border-muted)',
        }}
      />
      <div
        style={{
          padding: 'var(--space-3)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-1)',
        }}
      >
        <code
          style={{
            fontFamily: 'var(--type-mono-base-font)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-primary)',
            wordBreak: 'break-all',
          }}
        >
          {token.name}
        </code>
        <code
          style={{
            fontFamily: 'var(--type-mono-base-font)',
            fontSize: 'var(--text-2xs)',
            color: 'var(--color-text-muted)',
          }}
        >
          {resolved || token.rawValue}
        </code>
        <span
          style={{
            fontSize: 'var(--text-2xs)',
            color: 'var(--color-text-secondary)',
            lineHeight: 'var(--leading-snug)',
          }}
        >
          {usage || '(no documented usage. Flag for review.)'}
        </span>
        {reserved && (
          <span
            style={{
              fontSize: 'var(--text-2xs)',
              color: 'var(--color-status-sell-text)',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-wide)',
              marginTop: 'var(--space-1)',
            }}
          >
            Semantically reserved
          </span>
        )}
      </div>
    </div>
  );
}

function SwatchGrid({ tokens }: { tokens: ParsedToken[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 'var(--space-3)',
      }}
    >
      {tokens.map(t => (
        <ColorSwatch key={t.name} token={t} />
      ))}
    </div>
  );
}

// ── Spacing / border-width row ────────────────────────────────────────

function SpacingBarRow({ token }: { token: ParsedToken }) {
  const usage = TOKEN_REGISTRY[token.name]?.usage;
  const [resolved, setResolved] = useState('');
  useEffect(() => {
    setResolved(pxFromVar(`var(${token.name})`));
  }, [token.name]);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-4)',
        padding: 'var(--space-3) var(--space-4)',
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-muted)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <code
        style={{
          fontFamily: 'var(--type-mono-base-font)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-primary)',
          minWidth: 140,
        }}
      >
        {token.name}
      </code>
      <code
        style={{
          fontFamily: 'var(--type-mono-base-font)',
          fontSize: 'var(--text-2xs)',
          color: 'var(--color-text-muted)',
          minWidth: 60,
        }}
      >
        {resolved || token.rawValue}
      </code>
      <div
        aria-hidden
        style={{
          height: 16,
          width: `var(${token.name})`,
          background: 'var(--color-brand)',
          borderRadius: 'var(--radius-sm)',
        }}
      />
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', flex: 1 }}>
        {usage || '(no documented usage. Flag for review.)'}
      </span>
    </div>
  );
}

function SpacingBarList({ tokens }: { tokens: ParsedToken[] }) {
  // Sort numerically when name ends in a number.
  const sorted = [...tokens].sort((a, b) => {
    const an = parseInt(a.name.match(/(\d+)$/)?.[1] || '0', 10);
    const bn = parseInt(b.name.match(/(\d+)$/)?.[1] || '0', 10);
    return an - bn;
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {sorted.map(t => (
        <SpacingBarRow key={t.name} token={t} />
      ))}
    </div>
  );
}

// ── Radius grid ───────────────────────────────────────────────────────

function RadiusGrid({ tokens }: { tokens: ParsedToken[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {tokens.map(t => {
        const usage = TOKEN_REGISTRY[t.name]?.usage;
        return (
          <div
            key={t.name}
            style={{
              display: 'grid',
              gridTemplateColumns: '160px 1fr',
              gap: 'var(--space-4)',
              padding: 'var(--space-4)',
              background: 'var(--color-bg-surface)',
              border: '1px solid var(--color-border-muted)',
              borderRadius: 'var(--radius-md)',
              alignItems: 'center',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <code
                style={{
                  fontFamily: 'var(--type-mono-base-font)',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-primary)',
                }}
              >
                {t.name}
              </code>
              <code
                style={{
                  fontFamily: 'var(--type-mono-base-font)',
                  fontSize: 'var(--text-2xs)',
                  color: 'var(--color-text-muted)',
                }}
              >
                {t.rawValue}
              </code>
              <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-secondary)' }}>
                {usage || '(no documented usage. Flag for review.)'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <div
                aria-hidden
                style={{
                  width: 64,
                  height: 64,
                  background: 'var(--color-brand)',
                  borderRadius: `var(${t.name})`,
                }}
              />
              <div
                aria-hidden
                style={{
                  width: 96,
                  height: 64,
                  background: 'var(--color-bg-surface)',
                  border: '3px solid var(--color-border-default)',
                  borderRadius: `var(${t.name})`,
                  boxShadow: 'var(--shadow-sm)',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Shadow grid ───────────────────────────────────────────────────────

function ShadowGrid({ tokens }: { tokens: ParsedToken[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 'var(--space-6)',
        padding: 'var(--space-6)',
        background: 'var(--color-bg-page)',
        border: '1px solid var(--color-border-muted)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      {tokens.map(t => {
        const usage = TOKEN_REGISTRY[t.name]?.usage;
        return (
          <div
            key={t.name}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
              alignItems: 'center',
              textAlign: 'center',
            }}
          >
            <div
              aria-hidden
              style={{
                width: 140,
                height: 88,
                background: 'var(--color-bg-surface)',
                border: '3px solid var(--color-border-default)',
                borderRadius: 'var(--radius-md)',
                boxShadow: `var(${t.name})`,
              }}
            />
            <code
              style={{
                fontFamily: 'var(--type-mono-base-font)',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-primary)',
              }}
            >
              {t.name}
            </code>
            <code
              style={{
                fontFamily: 'var(--type-mono-base-font)',
                fontSize: 'var(--text-2xs)',
                color: 'var(--color-text-muted)',
              }}
            >
              {t.rawValue}
            </code>
            <span
              style={{
                fontSize: 'var(--text-2xs)',
                color: 'var(--color-text-secondary)',
                maxWidth: 200,
              }}
            >
              {usage || '(no documented usage. Flag for review.)'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Motion row ────────────────────────────────────────────────────────

function MotionRow({ tokens }: { tokens: ParsedToken[] }) {
  // Animate a square that oscillates. Use the token as the transition duration / easing
  // so the swatch literally demonstrates the motion.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 1500);
    return () => clearInterval(id);
  }, []);
  const moved = tick % 2 === 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {tokens.map(t => {
        const usage = TOKEN_REGISTRY[t.name]?.usage;
        const isDuration =
          t.name.startsWith('--motion-fast') ||
          t.name.startsWith('--motion-normal') ||
          t.name.startsWith('--motion-slow');
        const isEasing = t.name.startsWith('--motion-ease');
        return (
          <div
            key={t.name}
            style={{
              display: 'grid',
              gridTemplateColumns: '180px 100px 1fr 80px',
              gap: 'var(--space-4)',
              alignItems: 'center',
              padding: 'var(--space-3) var(--space-4)',
              background: 'var(--color-bg-surface)',
              border: '1px solid var(--color-border-muted)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <code
              style={{
                fontFamily: 'var(--type-mono-base-font)',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-primary)',
              }}
            >
              {t.name}
            </code>
            <code
              style={{
                fontFamily: 'var(--type-mono-base-font)',
                fontSize: 'var(--text-2xs)',
                color: 'var(--color-text-muted)',
              }}
            >
              {t.rawValue}
            </code>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
              {usage || '(no documented usage. Flag for review.)'}
            </span>
            <div
              aria-hidden
              style={{
                position: 'relative',
                height: 24,
                background: 'var(--color-bg-page)',
                border: '1px solid var(--color-border-muted)',
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 4,
                  left: moved ? 56 : 4,
                  width: 16,
                  height: 16,
                  background: 'var(--color-brand)',
                  borderRadius: 'var(--radius-sm)',
                  transitionProperty: 'left',
                  transitionDuration: isDuration ? `var(${t.name})` : 'var(--motion-normal)',
                  transitionTimingFunction: isEasing ? `var(${t.name})` : 'var(--motion-ease-out)',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Z-index row ───────────────────────────────────────────────────────

function ZIndexRow({ tokens }: { tokens: ParsedToken[] }) {
  // Sort by numeric value where possible.
  const sorted = [...tokens].sort((a, b) => {
    const an = parseInt(a.rawValue, 10);
    const bn = parseInt(b.rawValue, 10);
    return (Number.isNaN(an) ? 0 : an) - (Number.isNaN(bn) ? 0 : bn);
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {sorted.map(t => {
        const usage = TOKEN_REGISTRY[t.name]?.usage;
        return (
          <div
            key={t.name}
            style={{
              display: 'grid',
              gridTemplateColumns: '160px 60px 1fr',
              gap: 'var(--space-4)',
              alignItems: 'center',
              padding: 'var(--space-3) var(--space-4)',
              background: 'var(--color-bg-surface)',
              border: '1px solid var(--color-border-muted)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <code
              style={{
                fontFamily: 'var(--type-mono-base-font)',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-primary)',
              }}
            >
              {t.name}
            </code>
            <code
              style={{
                fontFamily: 'var(--type-mono-base-font)',
                fontSize: 'var(--text-2xs)',
                color: 'var(--color-text-muted)',
              }}
            >
              {t.rawValue}
            </code>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
              {usage || '(no documented usage. Flag for review.)'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Type list ─────────────────────────────────────────────────────────
//
// Composite + primitive type tokens render as plain rows: name, value, note.
// The expressive samples live in the dedicated TypographySection.

function TypeListRow({ token }: { token: ParsedToken }) {
  const usage = TOKEN_REGISTRY[token.name]?.usage;
  const [resolved, setResolved] = useState('');
  useEffect(() => {
    setResolved(resolveToken(token.name));
  }, [token.name]);
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(220px, 1fr) minmax(160px, 1fr) 2fr',
        gap: 'var(--space-3)',
        padding: 'var(--space-2) var(--space-3)',
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-muted)',
        borderRadius: 'var(--radius-sm)',
        alignItems: 'baseline',
      }}
    >
      <code
        style={{
          fontFamily: 'var(--type-mono-base-font)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-primary)',
        }}
      >
        {token.name}
      </code>
      <code
        style={{
          fontFamily: 'var(--type-mono-base-font)',
          fontSize: 'var(--text-2xs)',
          color: 'var(--color-text-muted)',
        }}
      >
        {resolved || token.rawValue}
      </code>
      <span
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-secondary)',
          lineHeight: 'var(--leading-snug)',
        }}
      >
        {usage || '(no documented usage. Flag for review.)'}
      </span>
    </div>
  );
}

function TypeList({ tokens }: { tokens: ParsedToken[] }) {
  const sorted = [...tokens].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      {sorted.map(t => (
        <TypeListRow key={t.name} token={t} />
      ))}
    </div>
  );
}

// ── Section renderer ──────────────────────────────────────────────────

function TokenSection({ meta, tokens }: { meta: GroupMeta; tokens: ParsedToken[] }) {
  if (tokens.length === 0) return null;
  return (
    <section style={{ marginBottom: 'var(--space-12)' }}>
      <SectionHeader title={meta.title} count={tokens.length} description={meta.description} />
      {meta.render === 'swatch' && <SwatchGrid tokens={tokens} />}
      {meta.render === 'spacing-bar' && <SpacingBarList tokens={tokens} />}
      {meta.render === 'radius-grid' && <RadiusGrid tokens={tokens} />}
      {meta.render === 'shadow-grid' && <ShadowGrid tokens={tokens} />}
      {meta.render === 'motion-row' && <MotionRow tokens={tokens} />}
      {meta.render === 'z-row' && <ZIndexRow tokens={tokens} />}
      {meta.render === 'type-list' && <TypeList tokens={tokens} />}
    </section>
  );
}

// ── Typography samples ────────────────────────────────────────────────

const SAMPLE_TEXT = 'Read the market today.';

const TYPE_SAMPLES: Array<{
  label: string;
  size: string;
  lineHeight: string;
  weight: string;
  family?: string;
}> = [
  {
    label: 'Display 4xl',
    size: 'var(--text-4xl)',
    lineHeight: 'var(--leading-tight)',
    weight: 'var(--weight-bold)',
    family: 'var(--type-display-xl-font)',
  },
  {
    label: 'Display 3xl',
    size: 'var(--text-3xl)',
    lineHeight: 'var(--leading-tight)',
    weight: 'var(--weight-bold)',
    family: 'var(--type-display-lg-font)',
  },
  {
    label: 'Heading 2xl',
    size: 'var(--text-2xl)',
    lineHeight: 'var(--leading-snug)',
    weight: 'var(--weight-bold)',
    family: 'var(--type-heading-xl-font)',
  },
  {
    label: 'Heading xl',
    size: 'var(--text-xl)',
    lineHeight: 'var(--leading-snug)',
    weight: 'var(--weight-semibold)',
    family: 'var(--type-heading-lg-font)',
  },
  {
    label: 'Heading base',
    size: 'var(--text-base)',
    lineHeight: 'var(--leading-snug)',
    weight: 'var(--weight-semibold)',
    family: 'var(--type-heading-base-font)',
  },
  {
    label: 'Body lg',
    size: 'var(--text-lg)',
    lineHeight: 'var(--leading-relaxed)',
    weight: 'var(--weight-normal)',
    family: 'var(--type-body-lg-font)',
  },
  {
    label: 'Body base',
    size: 'var(--text-base)',
    lineHeight: 'var(--leading-normal)',
    weight: 'var(--weight-normal)',
    family: 'var(--type-body-base-font)',
  },
  {
    label: 'Body sm',
    size: 'var(--text-sm)',
    lineHeight: 'var(--leading-normal)',
    weight: 'var(--weight-normal)',
    family: 'var(--type-body-sm-font)',
  },
  {
    label: 'Body xs',
    size: 'var(--text-xs)',
    lineHeight: 'var(--leading-normal)',
    weight: 'var(--weight-normal)',
  },
  {
    label: 'Body 2xs',
    size: 'var(--text-2xs)',
    lineHeight: 'var(--leading-normal)',
    weight: 'var(--weight-normal)',
  },
  {
    label: 'Mono lg',
    size: 'var(--text-xl)',
    lineHeight: 'var(--leading-tight)',
    weight: 'var(--weight-bold)',
    family: 'var(--type-mono-lg-font)',
  },
  {
    label: 'Mono base',
    size: 'var(--text-base)',
    lineHeight: 'var(--leading-snug)',
    weight: 'var(--weight-semibold)',
    family: 'var(--type-mono-base-font)',
  },
];

function TypographySample({ spec }: { spec: (typeof TYPE_SAMPLES)[number] }) {
  const [resolvedSize, setResolvedSize] = useState('');
  useEffect(() => {
    setResolvedSize(pxFromVar(spec.size));
  }, [spec.size]);
  return (
    <div
      style={{
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-muted)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: 'var(--space-2)',
        }}
      >
        <span
          style={{
            fontSize: 'var(--text-2xs)',
            color: 'var(--color-text-muted)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-wide)',
            fontWeight: 600,
          }}
        >
          {spec.label}
        </span>
        <code
          style={{
            fontFamily: 'var(--type-mono-base-font)',
            fontSize: 'var(--text-2xs)',
            color: 'var(--color-text-secondary)',
          }}
        >
          {resolvedSize} size, line-height{' '}
          {spec.lineHeight.replace('var(--leading-', '').replace(')', '')}, weight{' '}
          {spec.weight.replace('var(--weight-', '').replace(')', '')}
        </code>
      </div>
      <div
        style={{
          fontFamily: spec.family || 'var(--type-body-base-font)',
          fontSize: spec.size,
          lineHeight: spec.lineHeight,
          fontWeight: spec.weight as React.CSSProperties['fontWeight'],
          color: 'var(--color-text-primary)',
        }}
      >
        {SAMPLE_TEXT}
      </div>
    </div>
  );
}

function TypographySamplesSection() {
  return (
    <section style={{ marginBottom: 'var(--space-12)' }}>
      <SectionHeader
        title="Typography samples"
        description="Each step of the type scale rendered at full fidelity. Sample copy: Read the market today."
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {TYPE_SAMPLES.map(spec => (
          <TypographySample key={spec.label} spec={spec} />
        ))}
      </div>
    </section>
  );
}

// ── Misc / Undocumented section ───────────────────────────────────────

function MiscSection({ tokens, gaps }: { tokens: ParsedToken[]; gaps: DocumentedGap[] }) {
  if (tokens.length === 0 && gaps.length === 0) return null;
  return (
    <section style={{ marginBottom: 'var(--space-12)' }}>
      <SectionHeader
        title="Misc and undocumented"
        count={tokens.length}
        description="Tokens in the CSS that the brand doc does not classify, plus tokens the brand doc calls out but the CSS has not implemented yet. Flag both for review."
      />
      {tokens.length > 0 && (
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <h3 className="vela-heading-base" style={{ marginBottom: 'var(--space-2)' }}>
            Undocumented tokens (TODO: classify)
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {tokens.map(t => (
              <div
                key={t.name}
                style={{
                  display: 'flex',
                  gap: 'var(--space-4)',
                  padding: 'var(--space-2) var(--space-3)',
                  background: 'var(--color-bg-surface)',
                  border: '1px solid var(--color-border-muted)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <code
                  style={{
                    fontFamily: 'var(--type-mono-base-font)',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-text-primary)',
                    minWidth: 220,
                  }}
                >
                  {t.name}
                </code>
                <code
                  style={{
                    fontFamily: 'var(--type-mono-base-font)',
                    fontSize: 'var(--text-2xs)',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {t.rawValue}
                </code>
              </div>
            ))}
          </div>
        </div>
      )}
      {gaps.length > 0 && (
        <div>
          <h3 className="vela-heading-base" style={{ marginBottom: 'var(--space-2)' }}>
            Documented but not implemented
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {gaps.map(g => (
              <div
                key={g.name}
                style={{
                  display: 'flex',
                  gap: 'var(--space-4)',
                  padding: 'var(--space-3) var(--space-4)',
                  background: 'var(--color-status-wait-bg)',
                  border: '1px solid var(--color-status-wait-border)',
                  borderRadius: 'var(--radius-sm)',
                  flexWrap: 'wrap',
                }}
              >
                <code
                  style={{
                    fontFamily: 'var(--type-mono-base-font)',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-status-wait-text)',
                    minWidth: 220,
                  }}
                >
                  {g.name}
                </code>
                <span
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-status-wait-text)',
                    flex: 1,
                  }}
                >
                  {g.reason}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Core components section ───────────────────────────────────────────

function ComponentsSection() {
  return (
    <section style={{ marginBottom: 'var(--space-12)' }}>
      <SectionHeader
        title="Core components"
        description="Default-state previews of every primitive exported from src/components/VelaComponents.tsx."
      />
      <Stack spacing="lg">
        <Card>
          <Stack spacing="md">
            <h3 className="vela-heading-lg" style={{ margin: 0 }}>
              Buttons
            </h3>
            <Row spacing="sm">
              <Button variant="primary">Get started</Button>
              <Button variant="brand">Open dossier</Button>
              <Button variant="secondary">View details</Button>
              <Button variant="ghost">Cancel</Button>
            </Row>
            <Row spacing="sm">
              <Button variant="buy">Take signal</Button>
              <Button variant="sell">Take signal</Button>
              <Button variant="wait">Hold off</Button>
            </Row>
          </Stack>
        </Card>

        <Card>
          <Stack spacing="md">
            <h3 className="vela-heading-lg" style={{ margin: 0 }}>
              Badges
            </h3>
            <Row spacing="sm">
              <Badge variant="buy">BUY</Badge>
              <Badge variant="sell">SHORT</Badge>
              <Badge variant="wait">WAIT</Badge>
              <Badge variant="neutral">IDLE</Badge>
              <Badge variant="up">+5.2%</Badge>
              <Badge variant="down">-3.1%</Badge>
            </Row>
          </Stack>
        </Card>

        <Card>
          <Stack spacing="md">
            <h3 className="vela-heading-lg" style={{ margin: 0 }}>
              Cards
            </h3>
            <Grid columns={3}>
              <Card variant="lavender">Lavender surface</Card>
              <Card variant="mint">Mint surface</Card>
              <Card variant="peach">Peach surface</Card>
              <Card variant="sky">Sky surface</Card>
              <Card variant="elevated">Elevated surface</Card>
              <Card>Default surface</Card>
            </Grid>
          </Stack>
        </Card>

        <Card>
          <Stack spacing="md">
            <h3 className="vela-heading-lg" style={{ margin: 0 }}>
              Stat cards
            </h3>
            <Grid columns={3}>
              <StatCard label="Win rate" value="68%" change="+4.2%" />
              <StatCard label="Open positions" value="3" />
              <StatCard label="Drawdown" value="2.1%" change="-0.4%" />
            </Grid>
          </Stack>
        </Card>

        <Card>
          <Stack spacing="md">
            <h3 className="vela-heading-lg" style={{ margin: 0 }}>
              Inputs
            </h3>
            <Grid columns={2}>
              <Input label="Email" placeholder="you@example.com" />
              <Input label="Amount" placeholder="100" helper="USDC available." />
              <Select
                label="Asset"
                options={[
                  { value: 'btc', label: 'Bitcoin' },
                  { value: 'eth', label: 'Ethereum' },
                  { value: 'nvda', label: 'Nvidia' },
                ]}
              />
              <TextArea label="Notes" placeholder="Add a note." />
            </Grid>
          </Stack>
        </Card>

        <Card>
          <Stack spacing="md">
            <h3 className="vela-heading-lg" style={{ margin: 0 }}>
              Alerts
            </h3>
            <Stack spacing="sm">
              <Alert variant="info">A new signal is ready to review.</Alert>
              <Alert variant="success">Your trade was placed.</Alert>
              <Alert variant="warning">Your balance is below the minimum.</Alert>
              <Alert variant="error">We could not reach the exchange.</Alert>
            </Stack>
          </Stack>
        </Card>

        <Card>
          <Stack spacing="md">
            <h3 className="vela-heading-lg" style={{ margin: 0 }}>
              Empty state
            </h3>
            <EmptyState
              title="No signals yet"
              description="Vela will publish a read here once the market sets up."
              action={<Button variant="primary">Open watchlist</Button>}
            />
          </Stack>
        </Card>

        <Card>
          <Stack spacing="md">
            <h3 className="vela-heading-lg" style={{ margin: 0 }}>
              Page header
            </h3>
            <PageHeader title="Signals" subtitle="Live reads across 10 assets." />
          </Stack>
        </Card>

        <Card>
          <Stack spacing="md">
            <h3 className="vela-heading-lg" style={{ margin: 0 }}>
              Loading spinner
            </h3>
            <Row spacing="md">
              <LoadingSpinner size={20} />
              <LoadingSpinner size={28} />
              <LoadingSpinner size={40} />
            </Row>
          </Stack>
        </Card>
      </Stack>
    </section>
  );
}

// ── Header (matches docs/cron-schedule.html pattern) ──────────────────

function DesignSystemHeader() {
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
        Design System
      </div>
      <div
        style={{
          color: 'var(--color-text-muted)',
          fontSize: 11,
          marginLeft: 'auto',
        }}
      >
        Tokens, type, and components per VELA-BRAND-SYSTEM-V2.
      </div>
    </header>
  );
}

// ── App ───────────────────────────────────────────────────────────────

interface GroupedTokens {
  byGroup: Record<GroupId, ParsedToken[]>;
  undocumented: ParsedToken[];
}

function groupTokens(tokens: ParsedToken[]): GroupedTokens {
  const byGroup: Record<GroupId, ParsedToken[]> = {
    brand: [],
    surface: [],
    text: [],
    'border-color': [],
    action: [],
    signal: [],
    status: [],
    state: [],
    'data-viz': [],
    'color-primitive': [],
    'type-composite': [],
    'type-primitive': [],
    spacing: [],
    'border-width': [],
    radius: [],
    elevation: [],
    motion: [],
    'z-index': [],
    privy: [],
  };
  const undocumented: ParsedToken[] = [];
  for (const t of tokens) {
    const entry = TOKEN_REGISTRY[t.name];
    if (entry) byGroup[entry.group].push(t);
    else undocumented.push(t);
  }
  return { byGroup, undocumented };
}

function App() {
  const grouped = useMemo(() => groupTokens(ALL_TOKENS), []);

  return (
    <div style={{ background: 'var(--color-bg-page)', minHeight: '100vh' }}>
      <DesignSystemHeader />
      <div style={{ padding: 'var(--space-6)', maxWidth: 1400, margin: '0 auto' }}>
        {GROUP_ORDER.map(meta => (
          <TokenSection key={meta.id} meta={meta} tokens={grouped.byGroup[meta.id]} />
        ))}
        <TypographySamplesSection />
        <ComponentsSection />
        <MiscSection tokens={grouped.undocumented} gaps={DOCUMENTED_BUT_MISSING} />
        <footer
          style={{
            marginTop: 'var(--space-12)',
            padding: 'var(--space-4) 0',
            borderTop: '1px solid var(--color-border-muted)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
          }}
        >
          Generated from{' '}
          <code style={{ fontFamily: 'var(--type-mono-base-font)' }}>
            src/styles/vela-design-system.css
          </code>{' '}
          on {__BUILD_DATE__}. Groupings sourced from VELA-BRAND-SYSTEM-V2.md and
          docs/claude-reference/design-system-guide.md.
        </footer>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
