# Vela Notification Registry

> **Last audited:** 2026-03-24
> **Source:** `/Users/henry/crypto-agent/supabase/functions/`
> **Email design details:** See `memory/email-templates.md`
> **Privacy incident history:** See `memory/incident-2026-03-19-notification-privacy.md`

---

## Sending Functions

| Function | Recipient | Bot |
|----------|-----------|-----|
| `sendUserTelegram(supabase, userId, msg)` | Specific user's `telegram_chat_id` | User-facing bot |
| `sendUserTelegramWithButtons(supabase, userId, msg, buttons)` | Specific user's `telegram_chat_id` | User-facing bot |
| `sendAdminTelegram(msg)` | `TELEGRAM_ADMIN_CHAT_ID` env var | Admin bot |
| `sendAdminTelegramWithButtons(msg, buttons)` | `TELEGRAM_ADMIN_CHAT_ID` env var | Admin bot |
| `broadcastTelegram(supabase, msg, buttons?)` | All opted-in users (50ms rate limit) | User-facing bot |
| `sendEmailTo(to, subject, html)` | Specific email address | Resend API |
| `sendEmail(subject, html)` | `NOTIFICATION_EMAIL` env var (admin) | Resend API |

### ⚠️ Retired / Prohibited Functions

| Function | Status | Notes |
|----------|--------|-------|
| `sendTelegram(msg)` | **NEVER use in per-user paths** | Sends to `TELEGRAM_CHAT_ID` — a single broadcast chat. Only valid for legacy broadcast fallbacks. See incident-2026-03-19. |
| `sendTelegramWithButtons(msg, buttons)` | **NEVER use in per-user paths** | Same as above. |

---

## User-Facing Notifications

### Telegram (per-user via `sendUserTelegram`)

| Notification | File | Trigger | Content |
|-------------|------|---------|---------|
| Trade proposal | notify.ts | New proposal created | Asset, side, size, price, headline + Accept/Decline buttons |
| Order filled | notify.ts | Trade executed successfully | "Bought/Shorted {ASSET}" with price, amount, value, leverage |
| Position closed (trade-executor) | notify.ts | User-approved close executes | Exit price, amount, value, P&L |
| Position closed (monitor) | position-monitor | SL/expiry/trailing stop | Asset, side, price, reason, P&L%, duration |
| Proposal declined | trade-webhook | User declines proposal | Confirmation with proposal ID |
| Deposit received | notify.ts | Deposit detected | Amount, new balance |
| Welcome | trade-webhook | /start command | Welcome message + app link |
| Link success | trade-webhook | TG account linked | Confirmation |
| Link error/expired/invalid | trade-webhook | Link flow fails | Error message |

### Telegram (broadcast via `broadcastTelegram`)

| Notification | File | Trigger | Content |
|-------------|------|---------|---------|
| Signal change | notify.ts | Signal flip (BUY/SELL/WAIT) | Asset, signal, price, headline + View Brief button |
| Daily digest | notify.ts | Daily cron | Summary, headlines + Read Digest button |

### Email (per-user)

| Notification | Function | Trigger | Content |
|-------------|----------|---------|---------|
| Signal notification | `formatSignalEmail()` | Signal flip | Asset, signal, price, headline |
| Daily digest | `formatDigestEmail()` | Daily cron | Market summary, signals, F&G, BTC dominance |
| Trade proposal | `formatProposalEmail()` | New proposal | Asset, side, price, size, leverage, expiry, headline + Accept/Decline CTAs (HMAC-signed) |
| Position closed | `sendPositionClosedEmail()` | Position closes (any path) | Asset, side, entry/exit price, P&L, duration, fee |
| Withdrawal sent | `sendWithdrawalNotification()` | Withdrawal processed | Amount, fee, received, destination wallet |
| Deposit received | `sendDepositNotification()` | Deposit detected | Amount, new balance |
| Withdrawal OTP | `sendWithdrawalOtp()` | Withdrawal verification | OTP code, amount, destination, 10-min expiry |
| Capacity nudge | `notifyCapacityNudge()` | Signal fires, positions full | Asset, signal, price, positions count, tier |
| Low balance failure | `notifyLowBalanceFailure()` | Balance too low to execute | Details of failed execution |
| Balance nudge | `notifyBalanceNudge()` | running_low / size_reduced / depleted | 3 variants depending on severity |

### Email (admin-only)

| Notification | Function | Trigger |
|-------------|----------|---------|
| Signal review | `formatSignalReviewEmail()` | Weekly cron |

---

## Admin-Only Notifications (Telegram)

### Trading & Positions (position-monitor)

| Notification | Emoji | Content |
|-------------|-------|---------|
| Native SL triggered | 🛑 | Asset, side, price, P&L |
| Software SL triggered | 🛑 | Asset, side, price, P&L |
| Liquidation detected | 🚨 | Asset, side, price, P&L |
| BB2 expiry close | 📊 | Asset, side, price, hold time, P&L |
| Trailing stop triggered | 📉 | Asset, side, peak/locked P&L |
| Profit ladder trim | ✂️ | Asset, side, trim %, milestone, remaining |

### Trading & Positions (notify.ts)

| Notification | Emoji | Content |
|-------------|-------|---------|
| Signal change | 📡 | Asset → BUY/SHORT/WAIT |
| Digest generation failed | ⚠️ | Date + error details |
| Trade failure | ❌ | Error message |
| Signal review stats | 📊 | W/L, win rate, P&L breakdown |
| Signal review triage | 📊 | AI hypotheses + action buttons |
| Withdrawal processed | 💸 | Amount, fee, address, user email |
| Deposit received | 💰 | Amount, balance, user email |

### Social Media (social-poster.ts, engagement-agent.ts)

| Notification | Emoji | Content |
|-------------|-------|---------|
| Tweet posted | 📝/🖼️ | Tweet text + URL |
| Tweet blocked | ⚠️ | Reasons + draft text |
| Tweet soft warning | 📝 | Style warnings |
| Engagement reply draft | 💬 | From user, score, draft + Approve/Reject buttons |

### Social Crons (social-metrics, social-optimizer, social-engagement)

| Notification | Content |
|-------------|---------|
| Daily metrics | Impressions summary for recent tweets |
| Optimization report | Strategy learnings |
| Engagement summary | Qualified opportunities + errors |
| Failures | Error messages for any of the above |

### Publishing (publish-scheduled, content-generator)

| Notification | Content |
|-------------|---------|
| Scheduled tweet posted | Text + URL |
| Scheduled tweet blocked/warning | Validation issues |
| Content preview | Draft + Approve/Cancel buttons |

### Infrastructure (health-check, circuit-breakers, rate-limiter, admin-webhook)

| Notification | Content |
|-------------|---------|
| Health check alert | Issue details + Acknowledged/Re-check buttons |
| Health check recovery | Resolved issues |
| Circuit breaker | Label, user ID, details |
| Rate limit abuse | Endpoint, identifier, hit count |
| Re-check responses | Health re-check results |

---

## Fallback Paths (routed to Admin as of 2026-03-24)

These fire when the per-user or broadcast path can't reach users. Routed to admin bot with context label.

| Fallback | When it fires | Label in admin message |
|----------|--------------|----------------------|
| Signal broadcast | No supabase client available | `⚠️ Fallback (no supabase client): signal broadcast` |
| Daily digest | No supabase client available | `⚠️ Fallback (no supabase client): daily digest` |
| Trade proposal | User has no telegram_chat_id | `⚠️ Fallback (no TG linked): {userId}` |
| Trade result | No userId/supabase passed | `⚠️ Fallback (no TG linked): {userId}` |

---

## Staging Gating

- **User-facing notifications** (email + Telegram): Skipped on staging via `IS_STAGING` check
- **Admin notifications**: Fire on both staging and production (operational monitoring)

## Opt-In Defaults

- **Email:** Opted-in by default (all profiles with non-null email). Opt-out via `user_preferences.notifications_email = false`
- **Telegram:** Opted-in only if `notifications_telegram = true` AND valid `telegram_chat_id`

---

## Known Issues (as of 2026-03-24)

1. **BB2 expiry missing `continue`** — position-monitor BB2 close path doesn't `continue` after notification, so trailing stop logic can fire on same position in same loop iteration → duplicate user notification. Fix: add `continue` after line 1035.
2. **Fallback user identification** — Proposal/trade-result fallbacks include `userId` (privy_did) but not email. Would need to pass email through function params or do a lookup.
3. **Position close email `+` sign** — `sendPositionClosedEmail()` includes redundant `+` before profit percentage. Should remove since context already indicates profit.
4. **Email dark mode** — Globe and X footer icons not visible on dark backgrounds. Need dark-mode-compatible versions or CSS inversion.
