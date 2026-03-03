## Summary
<!-- 1-3 bullet points describing what this PR does -->

## QA Checklist

### Automated (CI)
- [ ] TypeScript type check passes (`npm run type-check`)
- [ ] ESLint passes (`npm run lint`)
- [ ] Prettier passes (`npm run format -- --check`)
- [ ] All tests pass (`npm run test -- --run`)
- [ ] Build succeeds (`npm run build`)

### Visual Smoke Test (staging)
Deploy to staging (`develop` branch) and verify:

**Dashboard (Home)**
- [ ] Daily digest renders with content
- [ ] All asset cards load (BTC, ETH, HYPE, SOL)
- [ ] Signal colors match status (green=BUY, red=SELL, gray=WAIT)
- [ ] Price data is fresh (not stale >5 min)

**Asset Detail** (check at least one asset)
- [ ] Key Signal card renders with correct color
- [ ] "What's Happening" section has content
- [ ] "Events Moving the Asset" shows real news (not just sentiment)
- [ ] Indicators section renders
- [ ] Signal history expandable and populated

**Track Record**
- [ ] "Your Trades" section loads (or empty state if no trades)
- [ ] "Vela's Signal History" loads with stats
- [ ] P&L values display correctly ("+$X profit" / "-$X loss")
- [ ] Backtest badge visible on historical trades

**Account**
- [ ] User email displays
- [ ] Tier badge correct
- [ ] Notification label matches tier (free = "Email only", paid with telegram = "Email · Telegram")
- [ ] All settings sections expand/collapse
- [ ] Legal links work (/terms, /privacy)

**Cross-cutting**
- [ ] Dark mode renders correctly (if applicable to changes)
- [ ] Mobile responsive (375px) — no overflow or broken layouts
- [ ] No console errors in browser DevTools
- [ ] Loading states appear (no flash of empty content)

### Environment Verification (if backend changes)
- [ ] `verify-migrations.sql` passes on staging
- [ ] Edge functions deployed to staging
- [ ] Cron jobs verified (if modified)

### Post-merge (production)
- [ ] CI green on `main`
- [ ] Production app visual spot-check (dashboard + affected pages)
- [ ] No new console errors on production

## Test Plan
<!-- How did you test this change? What scenarios were covered? -->

## Screenshots
<!-- Before/after screenshots for visual changes -->
