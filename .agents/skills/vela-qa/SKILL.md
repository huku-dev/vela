---
name: vela-qa
description: Automated QA smoke test using Preview MCP — navigates all pages, verifies elements, checks console errors, tests responsive layout, validates visual quality and content sanitization. Use before merging or deploying.
context: fork
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

### Step 8: Content Sanitization Check

**This step catches leaked model artifacts, system internals, and data binding failures.**

For EACH page (Dashboard, Asset Detail for all 4 assets, Track Record, Account), capture the full accessibility tree:
```
preview_snapshot: serverId=<id>
```

Search the snapshot text for ALL of the following forbidden patterns. ANY match is a FAIL:

| Pattern | What it indicates |
|---------|-------------------|
| `<cite` or `</cite` | Leaked web search citation tags |
| `\|\|\|` (three pipes) | Leaked digest item delimiters |
| ` ``` ` (triple backtick) | Leaked markdown code fences |
| `{"` or `"}` as visible text | Leaked JSON fragments |
| `undefined` as visible standalone word | Data binding failure (null prop) |
| `null` as visible standalone word | Data binding failure |
| `NaN` as visible standalone text | Number formatting failure |
| `Infinity` as visible standalone text | Math error |
| `[object Object]` | Serialization failure |
| Raw ISO timestamp pattern `\d{4}-\d{2}-\d{2}T\d{2}:\d{2}` | Unformatted date |
| `<br>`, `<br/>`, `<div>`, `<span>`, `<p>` as visible text | Leaked HTML (not rendered) |

**How to check:** Use `preview_eval` to scan the page text programmatically:
```
preview_eval: expression="(() => {
  const text = document.body.innerText;
  const patterns = [
    { name: 'cite tags', regex: /<\\/?cite[^>]*>/i },
    { name: 'digest delimiters', regex: /\\|\\|\\|/ },
    { name: 'markdown fences', regex: /```/ },
    { name: 'JSON fragments', regex: /[{][\"']\\w+[\"']\\s*:/ },
    { name: 'undefined', regex: /\\bundefined\\b/ },
    { name: 'NaN', regex: /\\bNaN\\b/ },
    { name: '[object Object]', regex: /\\[object Object\\]/ },
    { name: 'raw ISO date', regex: /\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}/ },
    { name: 'raw HTML tags', regex: /<(br|div|span|p)[\\s>/]/ },
  ];
  const found = patterns.filter(p => p.regex.test(text)).map(p => p.name);
  return found.length ? 'FAIL: ' + found.join(', ') : 'PASS';
})()"
```

Run this on every page. Report results per page.

### Step 9: Visual Screenshot Audit

**This step catches general UI problems that structural checks miss: layout breaks, clipped text, overlapping elements, empty sections, broken images, spacing issues.**

Capture screenshots of these specific page states and visually inspect each one:

| # | Page | Viewport | How to reach state |
|---|------|----------|--------------------|
| 1 | Dashboard `/` | Desktop | Default load |
| 2 | Dashboard `/` | Desktop | Click digest to expand, then screenshot |
| 3 | Dashboard `/` | Mobile | `preview_resize` preset="mobile", then navigate to `/` |
| 4 | Asset Detail `/asset/btc` | Desktop | Navigate to `/asset/btc` |
| 5 | Asset Detail `/asset/btc` | Desktop | Click "Show more" in What's Moving section |
| 6 | Asset Detail `/asset/hype` | Desktop | Navigate to `/asset/hype` (different signal) |
| 7 | Track Record `/track-record` | Desktop | Navigate to `/track-record` |
| 8 | Account `/account` | Desktop | Navigate to `/account` |

For EACH screenshot, check all of the following. Report PASS, WARN, or FAIL:

**Layout:**
- [ ] No elements overlapping other elements
- [ ] No content overflowing or cut off at container edges
- [ ] No horizontal scrollbar on mobile
- [ ] Cards and sections are properly aligned
- [ ] No elements pushed off-screen

**Typography:**
- [ ] No text clipped mid-word or mid-sentence
- [ ] No text overlapping other text
- [ ] All text is legible (appropriate size, contrast)
- [ ] Line spacing is consistent within sections

**Spacing:**
- [ ] Consistent padding between sibling cards/sections
- [ ] No sections jammed together with zero gap
- [ ] No excessive whitespace gaps that look broken

**Images/Icons:**
- [ ] Asset logos render correctly (BTC, ETH, HYPE, SOL icons)
- [ ] No broken image placeholders or alt text visible
- [ ] No incorrectly sized or stretched images

**Content Completeness:**
- [ ] Sections with headers have content below them (no "What's Moving X" with empty body)
- [ ] Signal cards all have a headline/summary text
- [ ] No blank cards or ghost elements
- [ ] Loading spinners are NOT stuck (page should be fully rendered)

**Data Display:**
- [ ] All prices show `$` prefix and comma formatting (e.g. `$69,077` not `69077.234`)
- [ ] Percentage changes show `%` suffix
- [ ] Signal badges show correct label (BUY/SELL/WAIT)

### Step 10: Data Quality Checks

**This step validates that dynamic content is semantically correct and follows Vela's content standards.**

Use `preview_snapshot` to read text content and `preview_inspect` for specific elements.

**Signal Card Headlines (Dashboard):**
- For each signal card, read the headline text
- BUY signal cards must NOT say "waiting", "no clear direction", "stuck in the chop"
- WAIT signal cards must NOT say "going long", "going short", "momentum confirmed"
- SELL signal cards must NOT say "going long", "looking good", "momentum confirmed"
- Headlines should be coherent English sentences (not fragments or gibberish)

**What's Moving Events (Asset Detail):**
- Event titles must not contain HTML tags (`<cite>`, `<br>`, `<span>`, etc.)
- Event impact text must be plain English (no markup, no JSON)
- Source attribution (date + source name) should render on its own line below the event, not inline wrapped with the impact text

**Digest Display (Dashboard):**
- Digest text must not contain raw `|||` delimiters
- Text should read as coherent prose or properly separated paragraphs
- No markdown formatting visible (**, ##, etc.)

**Price Formatting:**
- All price displays: `$X,XXX` format with comma separators
- Never raw floats like `69077.23456`
- Never missing dollar sign

**P&L Formatting:**
- Must follow "+$X profit" / "-$X loss" convention
- Never bare dollar amounts without direction indicator
- Percentage P&L shows sign: +X.X% or -X.X%

**Date Formatting:**
- All user-facing dates in friendly format: "26 Mar", "Thursday, March 26"
- Never raw ISO: "2026-03-26T07:50:22.968678+00"
- Timezone shown where relevant

### Step 11: Generate QA Report

Format results as a structured report:

```
## QA Smoke Test Report

**Date:** [timestamp]
**Environment:** localhost:5173 (dev bypass)
**Server:** [serverId]

### Pages Checked
| Page | Status | Notes |
|------|--------|-------|
| Dashboard (/) | PASS/FAIL | [details] |
| Asset Detail (/asset/btc) | PASS/FAIL | [details] |
| Asset Detail (/asset/eth) | PASS/FAIL | [details] |
| Asset Detail (/asset/hype) | PASS/FAIL | [details] |
| Asset Detail (/asset/sol) | PASS/FAIL | [details] |
| Track Record (/track-record) | PASS/FAIL | [details] |
| Account (/account) | PASS/FAIL | [details] |

### Console Errors
[None / List of errors found]

### Mobile Responsive (375px)
[PASS / FAIL with details]

### Content Sanitization
[PASS / FAIL]
- [List any forbidden patterns found, with page + context]

### Visual Audit
| Page | Viewport | Status | Issues Found |
|------|----------|--------|--------------|
| Dashboard | Desktop | PASS/WARN/FAIL | [details] |
| Dashboard (expanded) | Desktop | PASS/WARN/FAIL | [details] |
| Dashboard | Mobile | PASS/WARN/FAIL | [details] |
| Asset Detail (BTC) | Desktop | PASS/WARN/FAIL | [details] |
| Asset Detail (BTC expanded) | Desktop | PASS/WARN/FAIL | [details] |
| Asset Detail (HYPE) | Desktop | PASS/WARN/FAIL | [details] |
| Track Record | Desktop | PASS/WARN/FAIL | [details] |
| Account | Desktop | PASS/WARN/FAIL | [details] |

### Data Quality
| Check | Status | Details |
|-------|--------|---------|
| Signal card headlines | PASS/FAIL | [any contradictions found] |
| Event content clean | PASS/FAIL | [any HTML/markup found] |
| Digest formatting | PASS/FAIL | [any delimiters/markup visible] |
| Price formatting | PASS/FAIL | [any raw numbers] |
| P&L formatting | PASS/FAIL | [any format violations] |
| Date formatting | PASS/FAIL | [any raw ISO dates] |

### Design Token Compliance
[Any hardcoded colors detected / All using semantic tokens]

### Overall: PASS / FAIL
[Summary — list any blocking issues that MUST be fixed before deploy]
```

---

## What This Checks (from qa-checklist.md)
- Dashboard: digest renders, asset cards load, signal colors match status, price data
- Asset Detail: Key Signal card, "What's Happening", indicators, signal history
- Track Record: trades load (or empty state), P&L format correct
- Account: user info, tier badge, notifications, sections expand, legal links
- Cross-cutting: no console errors, mobile responsive, loading states
- **Content sanitization:** no leaked cite tags, delimiters, JSON, HTML, or data binding failures
- **Visual audit:** no layout breaks, clipped text, overlapping elements, empty sections, broken images
- **Data quality:** headlines match signal state, prices/dates/P&L formatted correctly

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
