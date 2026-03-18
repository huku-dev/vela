# QA Checklist & Performance Targets

> *Extracted from CLAUDE.md — see CLAUDE.md for project overview and engineering principles.*

---

## Pre-Deploy QA Smoke Test (MANDATORY)

Before merging `develop` -> `main`, you **must** perform a visual smoke test on staging.

### Process
1. Push changes to `develop` -> wait for CI green
2. Open staging app (`staging.getvela.xyz` or `localhost:5173` via dev bypass)
3. Walk through **every page** and verify:

### Dashboard (Home)
- Daily digest renders with content
- All asset cards load (BTC, ETH, HYPE, SOL)
- Signal colors match status (green=BUY, red=SELL, gray=WAIT)
- Price data is fresh

### Asset Detail (at least one asset)
- Key Signal card with correct color
- "What's Happening" has content
- "Events Moving the Asset" shows real news
- Indicators render
- Signal history expandable

### Track Record
- "Your Trades" loads (or empty state)
- "Vela's Signal History" loads with stats
- P&L displays correctly ("+$X profit" / "-$X loss")

### Account
- User info displays
- Tier badge correct
- Notification label matches tier access
- All sections expand/collapse
- Legal links work

### Notification CTAs (after backend deploy)
- Click "View position" / "View details" in a trade execution email — should land on `/asset/{assetId}`
- Click "View full brief" in a signal Telegram notification — should land on `/asset/{assetId}`
- Click "View details" in a Telegram order fill message — should land on `/asset/{assetId}`
- Verify links don't 404 or redirect to home (catch-all route masks broken links silently)
- **Lesson (2026-03-18):** All notification deep links were broken since launch — used `/${assetId}` instead of `/asset/${assetId}`. Caught by user report, not QA. Always manually click CTAs in staging after any notify.ts change.

### Cross-cutting
- No console errors in DevTools
- Dark mode (if applicable)
- Mobile responsive (375px) — no overflow
- Loading states appear

### Post-QA
4. If backend changes: run `verify-environment.sh` on staging
5. After merge to `main`: spot-check production (dashboard + changed pages)

### Rules
- If ANY page has a regression, fix before merging
- Screenshot evidence of QA pass is encouraged in PR descriptions
- Use the PR template (`.github/pull_request_template.md`) which includes the full checklist

---

## Performance Targets

### Load Time
- **LCP (Largest Contentful Paint):** < 2.5 seconds
- **FID (First Input Delay):** < 100ms
- **CLS (Cumulative Layout Shift):** < 0.1

### Bundle Size
- **Main bundle:** < 200KB gzipped
- **Lazy load** AssetDetail page components
- **Code split** by route

### API Response Times
- **CoinGecko price fetch:** < 1 second
- **Supabase query:** < 500ms
- **Show loading spinner** after 300ms (don't flash for fast loads)

---

## Pre-Launch Checklist

Before deploying to production, verify:

### Security
- [ ] All API keys in environment variables (not hardcoded)
- [ ] `.env.local` in `.gitignore`
- [ ] No sensitive data in git history

### Quality
- [ ] Test coverage >70% on trust-critical paths (P&L, signal status)
- [ ] All TypeScript errors resolved (`npm run type-check`)
- [ ] Build succeeds without warnings (`npm run build`)

### UX
- [ ] Error boundaries on all data-dependent pages
- [ ] Loading states for all async operations
- [ ] Stale data indicators (>5 min) on price data
- [ ] Dark mode tested on all pages
- [ ] Mobile responsive (375px, 768px, 1024px breakpoints)

### Accessibility
- [ ] Lighthouse accessibility score > 90
- [ ] Keyboard navigation works for all workflows
- [ ] All interactive elements have focus states
- [ ] Color is not the only signal differentiator (use icons + text)

### Brand
- [ ] All user-facing copy reviewed against Three Pillar framework
- [ ] Design system tokens used (no hardcoded colors)
- [ ] Typography consistent (Instrument Sans for headings, Inter for body)
