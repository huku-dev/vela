---
name: content-strategy-articles
description: Long-form market analysis articles for X (inspired by Kobeissi Letter) — structure, differentiation, implementation plan
type: reference
---

# Vela Market Briefs — Content Strategy

> **Inspiration:** The Kobeissi Letter's X Articles. Reviewed their 2025 annual report + bond market article (2026-03-26).
> **Platform:** X Articles (native long-form, not external blog links)
> **Cadence:** 1-2x per week
> **Goal:** Build authority and following through signal-driven market analysis

---

## Article Structure (1000-1500 words)

1. **Hook headline** — Connect 2+ current events. Bold, specific, not clickbait.
   - Good: "Bonds are breaking while crypto rallies. Here's what Vela's signals are seeing."
   - Bad: "You won't believe what's happening in markets!"

2. **Context** (2-3 paragraphs) — Macro backdrop. What happened, why it matters.

3. **The Data** — Charts, signal history, price action across multiple assets. Reference actual Vela signal flips with dates and prices. Include annotated screenshots.

4. **The Analysis** (core, 3-5 paragraphs) — Connect dots across markets. Take a clear position. Back it with data. This is where Vela's multi-asset signal engine gives a unique perspective.

5. **What Vela Is Watching** (1-2 paragraphs) — Forward-looking. What levels, events, or signals matter next. Creates anticipation for the next article.

6. **Soft CTA** — In reply only, not in the article body. Link to app or marketing site.

---

## Vela's Unique Advantage

TKL writes opinion-driven analysis. Vela writes **signal-driven analysis** backed by:

- Actual signal flips with timestamps ("On March 24, Vela flipped SHORT on ETH at $2,157")
- Real trade outcomes from the track record
- AI-ranked news relevance scores
- Cross-asset signal correlation (what happens when BTC goes red while gold goes green?)
- The engine's computed indicators (without naming them — "momentum weakened" not "RSI dropped below 40")

This makes every article verifiable and builds trust in a way pure opinion can't.

---

## Content Pillars

| Pillar | Description | Example |
|--------|-------------|---------|
| Cross-market | Connect 2+ asset classes through a macro lens | "The dollar is surging. Here's what that means for BTC, gold, and equities." |
| Signal narrative | Tell the story of a specific signal that played out (or didn't) | "Vela flagged BTC 3 days before the breakout. Here's what the engine saw." |
| News deep dive | Take a breaking event and analyze its ripple effects with data | "The Fed held rates. Bonds sold off. Crypto rallied. Why?" |
| Transparency | Show wins AND losses. Build trust through radical honesty. | "3 signals this week. 2 played out, 1 cost us. Here's the full picture." |

---

## Workflow

### Phase 1: Manual (now through Q2 2026)
1. Henry writes the first 2-3 articles to establish voice and format
2. Use X's native Article feature (long-form posts)
3. Include annotated TradingView charts + Vela signal card screenshots
4. Share the article tweet and observe engagement patterns
5. Iterate on format based on what resonates

### Phase 2: AI-Assisted Drafts
1. New weekly cron or manual trigger in backend
2. Aggregates: week's signal changes, top news from `news_cache`, price action, position outcomes
3. Claude generates a 1000-word draft using the article structure above
4. Draft goes to `content_queue` with `post_type: 'market_brief'`, `status: 'pending_approval'`
5. Henry reviews, edits, adds charts, publishes

### Phase 3: Semi-Automated Pipeline
1. Auto-generated charts (via TradingView widget or custom Satori templates)
2. Scheduled publishing (1x Tuesday, 1x Thursday for consistency)
3. Performance tracking integrated with social_metrics_snapshots

---

## Voice (different from tweet voice)

Articles can use:
- Longer sentences and flowing paragraphs
- Light jargon if immediately explained ("The yield curve inverted — meaning short-term rates now exceed long-term rates, historically a recession signal")
- Specific dates, prices, and signal states
- Clear positions, not hedged ("We think this move has further to run" not "It could go up or it could go down")
- Honest acknowledgment of what Vela got wrong
- No "subscribe now" or hard CTAs — quality speaks for itself

Articles must NOT:
- Use indicator names (EMA, RSI, ADX, MACD) — translate to plain English
- Make guaranteed return claims
- Sound like a research report (keep it conversational)
- Exceed 1500 words (attention spans)
- Include more than 4-5 images (loading time)

---

## Distribution

1. Publish as X Article from @vela_HQ
2. Quote-tweet the article with a 1-2 sentence hook + key stat
3. Notify Telegram subscribers with headline + link
4. Consider cross-posting to getvela.xyz/insights (future)

---

## Measuring Success

| Metric | Target (3 months) | Why |
|--------|-------------------|-----|
| Views per article | 10K+ | Baseline for fintwit content |
| Bookmarks | 100+ per article | Signal of high-value content |
| Follower growth | +500/month attributable | Content-driven acquisition |
| Engagement rate | >3% | Above average for fintwit |
| Reposts | 50+ per article | Distribution / virality |

Track via `social_metrics_snapshots` + weekly marketing report.
