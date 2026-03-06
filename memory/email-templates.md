# Vela Email Templates

## Overview

All email notifications are sent via **Resend API** from `supabase/functions/_shared/notify.ts` in the backend repo.

**Sender:** `Vela <alerts@getvela.xyz>` (env var: `EMAIL_FROM_ADDRESS`, verified domain on Resend)
**Dispatch functions:** `sendEmailTo(to, subject, html)` for per-user emails, `sendEmail(subject, html)` for admin/default recipient

## Design System

All user-facing emails use `wrapEmailHtml(bodyHtml, opts?)` — a shared wrapper that provides:

- **Header:** Vela angular eye logomark (hosted PNG) + "vela" wordmark (Space Grotesk 800)
- **Body:** Cream `#FFFBF5` background, 3px `#0A0A0A` border, Inter font
- **Footer:** Dark `#0A0A0A` bar with globe icon + [getvela.xyz](https://getvela.xyz), X icon + [@vela_HQ](https://x.com/vela_HQ), tagline below

**Layout:** Table-based for Gmail compatibility (Gmail strips `<style>` tags). Fonts imported via `<link>` in `<head>` with graceful fallback to system sans-serif.

**Images:** Hosted PNGs at `getvela.xyz/email/` (served from vela-marketing `public/email/`). Gmail renders `<img>` tags reliably; inline SVG was stripped.

### Hosted Assets

| File | Size | Usage |
|------|------|-------|
| `getvela.xyz/email/logo.png` | 28×28 (56×56 source) | Header logomark |
| `getvela.xyz/email/icon-globe.png` | 14×14 (28×28 source) | Footer website link |
| `getvela.xyz/email/icon-x.png` | 14×14 (28×28 source) | Footer X link |

SVG sources alongside each PNG in `vela-marketing/public/email/`.

### Brand Tokens

| Token | Value | Usage |
|-------|-------|-------|
| Signal Green | `#0FE68C` | BUY accent, logo iris |
| Sell Red | `#FF4757` | SELL accent |
| Wait Gray | `#EBEBEB` | WAIT accent |
| Trim Gold | `#FFD700` | Trim proposal accent |
| Cream | `#FFFBF5` | Background |
| Ink | `#0A0A0A` | Text, borders |
| Muted text | `#6B7280` | Secondary text |
| Body bg | `#F0EDE8` | Email outer background |

### Tagline

**Current:** "Smarter trading starts here" (updated 2026-03-06)
**Previous:** "Always watching the markets for you" (retired)

## Template Catalog

### User-Facing (7 templates, all use `wrapEmailHtml()`)

| Template | Function | Trigger | Audience |
|----------|----------|---------|----------|
| Signal notification | `formatSignalEmail()` | Signal flip (BUY/SELL/WAIT) | User |
| Daily digest | `formatDigestEmail()` | Daily digest generation | User |
| Trade proposal | `formatProposalEmail()` | New trade proposal created | User |
| Withdrawal sent | `sendWithdrawalNotification()` | Withdrawal processed | User |
| Deposit received | `sendDepositNotification()` | Deposit detected | User |
| Withdrawal OTP | `sendWithdrawalOtp()` | Withdrawal verification requested | User |
| Capacity nudge | `notifyCapacityNudge()` | Signal fires but positions full | User |

### Admin-Only (1 template, does NOT use `wrapEmailHtml()`)

| Template | Function | Trigger | Audience |
|----------|----------|---------|----------|
| Signal review | `formatSignalReviewEmail()` | Weekly cron (signal-review) | Admin |

## Optional Features

- **Preheader text:** Pass `{ preheader: "..." }` to `wrapEmailHtml()` for inbox preview text. Used by digest email.
- **Action buttons:** Signal and proposal emails include Accept/Decline CTAs with HMAC-signed URLs.
- **Proposal expiry:** Trade proposals include expiry notice (`HMAC_EXPIRY_HOURS`).

## History

| Date | Change |
|------|--------|
| 2026-03-06 | Fixed `EMAIL_FROM_ADDRESS`: `alerts@vela.trade` (unverified) to `Vela <alerts@getvela.xyz>` (verified). All emails had returned 403 from Resend for ~7 days. |
| 2026-03-06 | Brand overhaul: Added `wrapEmailHtml()` shared wrapper with logo + dark footer. Fixed `ACCENT.green` from `#00D084` to `#0FE68C`. Updated tagline to "Smarter trading starts here". Aligned funding templates (withdrawal, deposit, OTP) to neobrutalist style. |
| 2026-03-06 | Hosted PNG images: Replaced inline SVG logo (stripped by Gmail) with hosted PNG at `getvela.xyz/email/logo.png`. Added globe + X icons to footer links. Assets in vela-marketing `public/email/`. |
