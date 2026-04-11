---
name: quarterly-report
description: Structure and reference for Vela's quarterly and annual performance reports, inspired by The Kobeissi Letter format
type: reference
---

# Vela Quarterly Performance Report — Reference

> **Inspiration:** The Kobeissi Letter's annual performance reports (8-page PDF, trade-by-trade transparency, investor letter format). Reviewed their 2025 report in full.
> **Cadence:** Quarterly + Annual. First report: Q1 2026 (Jan 1 – Mar 31, 2026).
> **Distribution:** PDF on getvela.xyz/performance, email to subscribers, X thread, Telegram notification.

---

## Report Structure (10 pages)

### Page 1: Cover
- Vela logomark + wordmark (angular eye + green diamond iris)
- "Q1 2026 Performance Report"
- "January 1 – March 31, 2026"
- getvela.xyz
- Disclaimer link

### Pages 2-3: Letter to Investors
Personal tone, from "The Vela Team." NOT corporate-speak.

1. **Opening greeting** — "To our investors and community,"
2. **Headline stat** — bolded, e.g. "In Q1 2026, Vela's signals delivered a net return of +X.X% across Y tracked assets"
3. **Benchmark comparison** — vs BTC buy-and-hold, vs S&P 500 same period
4. **Quarter-in-review narrative** — 3-4 paragraphs covering the macro backdrop. What happened in markets, how Vela's signals navigated it. Specific call-outs referencing actual signal flips with dates and prices.
5. **Bidirectional framing** — explicitly highlight long AND short trades as equal opportunities
6. **Forward look** — brief, 1-2 sentences on what the engine is watching
7. **Sign-off** — "The Vela Team"

### Page 4: Performance at a Glance
Single-page visual dashboard (Vela differentiator vs TKL's text-heavy format):

| Metric | Description |
|--------|-------------|
| Net Return (portfolio) | Aggregate across all assets |
| BTC Buy & Hold (same period) | Benchmark comparison |
| Total Positions Opened | Count |
| Win Rate | Winners / total |
| Avg Winner | Mean % gain on winning trades |
| Avg Loser | Mean % loss on losing trades |
| Profit Factor | Gross profit / gross loss |
| Longest Winning Streak | Consecutive wins |
| Largest Single Win | % + asset name |
| Largest Single Loss | % + asset name |
| Avg Position Duration | Days |
| Signals Issued | Total signal changes |

Plus: Cumulative return chart (Vela vs BTC buy-and-hold).

### Pages 5-6: Trade-by-Trade Breakdown
Grouped by asset. Every trade listed, wins AND losses. No cherry-picking.

Format per trade:
```
Jan 3 – Jan 18: Long BTC: +4.2% Gain (green)
Jan 19 – Feb 2: Short BTC: +1.8% Gain (green)
Feb 3 – Feb 10: Long BTC: -2.1% Loss (red)
```

Each asset section closes with: **[Asset] Net Return: +X.X%**

Assets: BTC, ETH, HYPE, SOL (and any others tracked in the period).

### Page 7: Signal Engine Insights (Vela differentiator)
Plain English, not technical jargon:

1. **How the engine performed** — signal count, avg time between flip and price move
2. **Best call of the quarter** — narrative around a specific winning signal with dates/prices
3. **Worst call of the quarter** — equally honest, show stop-loss limiting damage
4. **Engine evolution** — any signal improvements shipped during the quarter

### Page 8: Product Updates (Vela differentiator)
What shipped this quarter, framed for investors not engineers:

- Feature launches (plain English descriptions)
- Infrastructure improvements that affect user experience
- Coming next quarter (teasers)

### Page 9: Methodology
How returns are computed:

- Returns calculated per-position using actual entry/exit prices from Hyperliquid
- Percentage returns used (not dollar amounts) to normalize across position sizes
- Returns shown at actual leverage used
- All timestamps in UTC
- Data sourced from on-chain execution records
- Fee-inclusive (trading fees deducted from returns)
- Aggregate return = weighted average across asset sections (equal weighting)

### Page 10: Disclaimer
- Past performance not indicative of future results
- Not investment advice
- Terms and conditions link
- Risk disclosure
- Educational purposes only

---

## Quarterly vs Annual Differences

| Aspect | Quarterly | Annual |
|--------|-----------|--------|
| Letter length | 1-2 pages | 2-3 pages (deeper narrative) |
| Trade breakdown | Full list | Full list |
| Product updates | What shipped | Year in review + roadmap |
| Signal insights | Best/worst call | Top 5 calls + engine evolution arc |
| Charts | Cumulative return | Cumulative + monthly breakdown |
| Extras | — | Year-over-year comparison, community growth, CAGR |

---

## Data Sources for Auto-Generation

All data needed lives in Supabase production:

| Data | Table | Key columns |
|------|-------|-------------|
| Trade history | `positions` | entry_price, current_price, side, asset_id, opened_at, closed_at, closed_pnl_pct, total_pnl, close_reason, leverage, size_usd, position_type |
| Signal changes | `signals` | signal_color, price_at_signal, timestamp, asset_id |
| Signal details | `asset_briefs` | headline, signal_breakdown |
| Benchmarks | External API | BTC price at period start/end, S&P 500 |

---

## Social Announcement Template (X thread)

Post 1 (hook):
> Vela's Q1 2026 Performance Report is live.
>
> Our signals delivered +X.X% net return across X assets this quarter.
> BTC buy-and-hold returned +X.X% over the same period.

Post 2 (breakdown):
> Breakdown by asset:
> BTC: +X.X%
> ETH: +X.X%
> HYPE: +X.X%
>
> X total positions. X% win rate.

Post 3 (transparency):
> Every single trade listed — wins and losses.
> Full methodology included.
>
> Read the full report: getvela.xyz/performance

---

## Annual Report — Additional Sections

The annual report uses the same base structure as quarterly but expands in several areas:

### Extended Investor Letter (2-3 pages)
- Deeper macro narrative covering the full year arc
- Key turning points and how Vela navigated them
- Year-over-year return comparison table (every year since inception)
- CAGR calculation vs benchmark CAGR

### Monthly Performance Breakdown (additional page)
Bar chart showing monthly returns, color-coded green/red. Helps visualize seasonality and consistency.

### Year-over-Year Comparison Table
| Year | Vela Return | BTC Buy & Hold | S&P 500 | Outperformance |
|------|------------|----------------|---------|----------------|
| 2026 | +X.X% | +X.X% | +X.X% | +X.Xpp |

### Expanded Signal Engine Insights
- Top 5 best calls of the year (narrative)
- Top 3 worst calls (equally honest)
- Engine evolution arc: what changed from Jan to Dec, why
- Signal accuracy trends by quarter

### Product Year in Review
- Major milestones (launch dates, feature releases)
- Community/subscriber growth metrics
- Roadmap preview for the coming year

### Community & Growth
- Subscriber count and growth
- Social following milestones
- Notable community moments

---

## The Kobeissi Letter Reference (Reviewed 2026-03-26)

TKL's 2025 Annual Report (8 pages) structure:

1. **Cover** — Logo, title, date range, website, disclaimer
2. **Investor letter** (2 pages) — Personal greeting ("TKL Community"), headline CAGR (+35.4% vs S&P +13.3%), year macro narrative (tariffs, Liberation Day, AI revolution), per-asset summary, forward-looking close, subscription CTA
3. **Cumulative return chart** — TKL vs S&P 500 since 2020
4. **Trade-by-trade breakdown** (4 pages) — Every trade by asset class (Equities, Crude, Nat Gas, Gold, Bonds). Format: date range, direction (Long/Short), % gain/loss in green/red. Each section has net return total.
5. **Methodology** — Sequential compounding, equal weighting at 20% per section, no leverage, options excluded
6. **Disclaimer** — Educational purposes, not investment advice

**Key TKL patterns Vela adopts:**
- Radical trade-by-trade transparency (every trade, wins and losses)
- Benchmark comparison as north star metric
- Personal letter tone (not corporate)
- Green/red color coding for gains/losses
- Methodology section for credibility

**Where Vela differentiates:**
- AI transparency section (best/worst calls, engine evolution)
- Product updates section
- Visual dashboard page (TKL is text-heavy)
- Quarterly cadence (TKL is annual only)
- Bidirectional framing (long AND short as equal opportunities)

---

## Design Notes

- Use Vela brand system: Signal Green (#0FE68C), Ink (#0A0A0A), Cream (#FFFBF5)
- Green for gains, Red for losses (semantic signal colors)
- Clean, minimal design — not flashy. Trust > style.
- PDF format, hosted on getvela.xyz/performance
- Figma template for consistent quarterly/annual production
- Design in Figma first (design-first rule from CLAUDE.md)
