---
name: vela-qa
description: Automated QA smoke test using Preview MCP — navigates all pages, verifies elements, checks console errors, tests responsive layout, and generates a QA report. Use before merging or deploying.
---

# Vela Automated QA Smoke Test

Uses Preview MCP to automate the page-by-page smoke test from `docs/claude-reference/qa-checklist.md`. Runs against the local dev server with auth bypass.

## Triggers
"run QA", "smoke test", "check the app", "verify pages", "pre-deploy check", "QA pass"

## Prerequisites
- `.env.local` must have `VITE_DEV_BYPASS_AUTH=true` (enables mock auth state)
- Dev server config in `.claude/launch.json` with name "dev"

---

## QA Pipeline

### Step 1: Start Dev Server
```
preview_start: name="dev"
```
Wait for server ready by checking logs:
```
preview_logs: serverId=<id>, search="ready"
```

### Step 2: Dashboard (Home `/`)

Navigate to home:
```
preview_eval: expression="window.location.href = 'http://localhost:5173/'"
```

**Verify with `preview_snapshot`:**
- [ ] Daily digest section renders with content
- [ ] Asset cards present (BTC, ETH, HYPE, SOL)
- [ ] Signal status badges visible on each card
- [ ] Price data is displayed

**Verify signal colors with `preview_inspect`:**
- [ ] BUY signals use `var(--color-signal-buy)` (green)
- [ ] SELL signals use `var(--color-signal-sell)` (red)
- [ ] WAIT signals use `var(--color-signal-wait)` (gray)

Check selectors like `.signal-card`, `[data-signal-status]`, or component-specific classes.

### Step 3: Asset Detail (`/asset/btc`)

Navigate:
```
preview_eval: expression="window.location.href = 'http://localhost:5173/asset/btc'"
```

**Verify with `preview_snapshot`:**
- [ ] Key Signal card renders with correct signal color
- [ ] "What's Happening" section has content
- [ ] Indicators section renders (EMA, RSI, ADX values)
- [ ] Signal history is present (expandable section)
- [ ] Price data displayed

### Step 4: Track Record (`/track-record`)

Navigate:
```
preview_eval: expression="window.location.href = 'http://localhost:5173/track-record'"
```

**Verify with `preview_snapshot`:**
- [ ] Trades list loads (or empty state with appropriate message)
- [ ] P&L format correct: "+$X profit" / "-$X loss" (never bare dollar amounts)
- [ ] Signal history stats present

### Step 5: Account (`/account`)

Navigate:
```
preview_eval: expression="window.location.href = 'http://localhost:5173/account'"
```

**Verify with `preview_snapshot`:**
- [ ] User info section displays
- [ ] Tier badge visible and correct
- [ ] Notification label matches tier access
- [ ] All sections expand/collapse
- [ ] Legal links present (Terms, Privacy)

### Step 6: Console Error Check

```
preview_console_logs: serverId=<id>, level="error"
```

**Flag any errors.** Common acceptable messages:
- CoinGecko rate limit warnings (non-critical)
- Dev bypass auth console message (expected)

**Unacceptable errors:**
- React rendering errors
- Unhandled promise rejections
- Missing module errors
- TypeScript runtime errors

### Step 7: Mobile Responsive Test

```
preview_resize: serverId=<id>, preset="mobile"
```

Then take a screenshot:
```
preview_screenshot: serverId=<id>
```

**Check for:**
- [ ] No horizontal overflow (content fits 375px width)
- [ ] Navigation is accessible (hamburger menu or equivalent)
- [ ] Signal cards stack vertically
- [ ] Text is readable (not clipped or overlapping)

Navigate through each page at mobile size:
```
preview_eval: expression="window.location.href = 'http://localhost:5173/'"
preview_screenshot
preview_eval: expression="window.location.href = 'http://localhost:5173/asset/btc'"
preview_screenshot
preview_eval: expression="window.location.href = 'http://localhost:5173/track-record'"
preview_screenshot
preview_eval: expression="window.location.href = 'http://localhost:5173/account'"
preview_screenshot
```

Reset to desktop when done:
```
preview_resize: serverId=<id>, preset="desktop"
```

### Step 8: Generate QA Report

Format results as a structured report:

```
## QA Smoke Test Report

**Date:** [timestamp]
**Environment:** localhost:5173 (dev bypass)
**Server:** [serverId]

### Pages Checked
| Page | Status | Notes |
|------|--------|-------|
| Dashboard (/) | ✅ PASS / ❌ FAIL | [details] |
| Asset Detail (/asset/btc) | ✅ PASS / ❌ FAIL | [details] |
| Track Record (/track-record) | ✅ PASS / ❌ FAIL | [details] |
| Account (/account) | ✅ PASS / ❌ FAIL | [details] |

### Console Errors
[None / List of errors found]

### Mobile Responsive (375px)
[PASS — no overflow / FAIL — issues found]

### Design Token Compliance
[Any hardcoded colors detected / All using semantic tokens]

### Overall: ✅ PASS / ❌ FAIL
[Summary with any blocking issues]
```

---

## What This Checks (from qa-checklist.md)
- Dashboard: digest renders, asset cards load, signal colors match status, price data
- Asset Detail: Key Signal card, "What's Happening", indicators, signal history
- Track Record: trades load (or empty state), P&L format correct
- Account: user info, tier badge, notifications, sections expand, legal links
- Cross-cutting: no console errors, mobile responsive, loading states

## What This Does NOT Check (requires real auth)
- Trading actions (accept/decline proposals) — needs real JWT
- Notification delivery (Telegram/email) — needs real services
- Stripe checkout flow — needs real Stripe session
- Real-time subscriptions — needs real Supabase connection

## Key References
- QA checklist: `docs/claude-reference/qa-checklist.md`
- Design system: `src/styles/vela-design-system.css`
- Dev bypass: `.env.local` with `VITE_DEV_BYPASS_AUTH=true`
- Launch config: `.claude/launch.json`
