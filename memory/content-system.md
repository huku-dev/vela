# Vela — Content System Architecture

> **Last Updated:** 2026-03-25
> **Source:** `/Users/henry/crypto-agent/supabase/functions/`
> **Related:** `memory/notification-registry.md` (delivery), `memory/email-templates.md` (email design)

---

## System Overview

The content system generates all market intelligence that Vela publishes — daily digests, asset briefs, breaking news alerts, EOD reports, and social posts. It is entirely backend-driven (Supabase Edge Functions) with no frontend involvement in content generation.

```
┌─────────────────────────────────────────────────────────────────┐
│                        NEWS INGESTION                           │
│                                                                 │
│  22 RSS Feeds ──┐                                               │
│  (crypto, macro, │──→ fetchAllNews() ──→ Dedup ──→ Raw Pool     │
│   equities,      │    (parallel fetch)   (title)   (~100 items) │
│   commodities)   │                                              │
│                  │                                               │
│  3 Telegram ─────┘                                               │
│  (via RSSHub)                                                    │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     TYPESCRIPT RANKING                           │
│                     (news-fetcher.ts)                            │
│                                                                 │
│  For each item, compute score (0-110):                          │
│                                                                 │
│  ┌─────────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Source Tier      │  │ Recency      │  │ Cross-Source      │  │
│  │ T1 = 15 pts     │  │ <1h  = 20    │  │ 2 matches = +10  │  │
│  │ T2 = 8 pts      │  │ <4h  = 15    │  │ 3 matches = +18  │  │
│  │ T3 = 3 pts      │  │ <12h = 10    │  │ 4+ matches = +25 │  │
│  │                  │  │ <24h = 5     │  │                   │  │
│  └─────────────────┘  └──────────────┘  └───────────────────┘  │
│                                                                 │
│  ┌─────────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Tracked Asset   │  │ Impact Words │  │ Spam Filter       │  │
│  │ BTC/ETH = +12   │  │ "crash" = +8 │  │ Known patterns    │  │
│  │ SOL/HYPE = +10  │  │ "surge" = +6 │  │ Title length      │  │
│  │ Other asset = +5│  │ "halt" = +8  │  │ Uppercase ratio   │  │
│  └─────────────────┘  └──────────────┘  └───────────────────┘  │
│                                                                 │
│  Cross-source detection: trigram similarity ≥ 0.35              │
│  (fuzzy headline matching across different outlets)             │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CATEGORY BALANCING                            │
│                                                                 │
│  After scoring, items are clustered and balanced:               │
│                                                                 │
│  Category floors (minimum items if available):                  │
│  ┌──────────┬───────┬──────────┬─────────────┐                  │
│  │ Crypto   │ Macro │ Equities │ Commodities │                  │
│  │ 8 items  │ 7     │ 4        │ 3           │                  │
│  └──────────┴───────┴──────────┴─────────────┘                  │
│                                                                 │
│  Within each category: sorted by score descending               │
│  Cross-category: interleaved to prevent crypto dominance        │
│  Dedup: trigram similarity clusters → keep highest-tier source  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
          ┌─────────────────┐   ┌─────────────────┐
          │  CONTENT CRONS  │   │  ON-DEMAND       │
          │                 │   │                  │
          │  Daily Digest   │   │  Asset Briefs    │
          │  Breaking News  │   │  (per signal     │
          │  EOD Report     │   │   change)        │
          └────────┬────────┘   └────────┬─────────┘
                   │                     │
                   ▼                     ▼
          ┌─────────────────────────────────────┐
          │         CLAUDE SONNET                │
          │                                     │
          │  Receives: top 25 ranked items       │
          │  Writes: headlines + explainers      │
          │  Rules:                              │
          │  • ||| delimiter between items       │
          │  • Headlines < 60 chars              │
          │  • No relative time ("3h ago")       │
          │  • No signal contradiction           │
          │  • "markets" not "crypto markets"    │
          └────────┬────────────────────────────┘
                   │
                   ▼
          ┌─────────────────────────────────────┐
          │         VALIDATION LAYER             │
          │                                     │
          │  • Headline length enforcement       │
          │    (> 65 chars → Claude rewrite)     │
          │  • Signal contradiction guard        │
          │    (GREEN + "short" → fallback)      │
          │  • Spam/quality filter               │
          │  • Admin TG warning on soft issues   │
          └─────────────────────────────────────┘
```

---

## News Sources (22 RSS + 3 Telegram)

### RSS Feeds by Category

| Category | Tier 1 (15 pts) | Tier 2 (8 pts) |
|----------|----------------|----------------|
| **Crypto** | CoinDesk, CoinTelegraph, Decrypt, The Block, DL News, Blockworks | Google News (Hyperliquid, Solana) |
| **Macro** | CNBC Markets, CNBC Economy, Semafor, Al Jazeera, Nikkei Asia, SCMP, Channel News Asia | Google News (WSJ, FT, Bloomberg, Reuters, Economy) |
| **Equities** | — | Google News (stock market) |
| **Commodities** | — | Google News (oil, gold, commodities) |

### Telegram Feeds (via RSSHub)

| Channel | Content | RSSHub Instances |
|---------|---------|-----------------|
| ML on Chain | On-chain data, whale movements | rsshub.app, rsshub.rssforever.com, rsshub.moeyy.cn |
| Infinity Hedge | Macro commentary, breaking alerts | Same 3 instances |
| Kobeissi Letter | Market analysis, macro data | Same 3 instances |

Telegram feeds use multi-instance fallback — if the primary RSSHub instance fails, it tries the next. All 3 instances are tried before giving up.

### Tracked Asset Keywords

The scoring system boosts items mentioning tracked assets. Keywords are case-insensitive and matched against title + description:

| Asset | Keywords | Boost |
|-------|----------|-------|
| BTC | bitcoin, btc | +12 |
| ETH | ethereum, eth | +12 |
| SOL | solana, sol | +10 |
| HYPE | hyperliquid, hype | +10 |
| Others | matched by symbol/name | +5 |

As more assets are added to Vela's trading universe, this list grows automatically from the `assets` table.

---

## Cross-Source Detection

The most important ranking signal. When multiple outlets report the same story, it's likely significant.

**How it works:**

1. Each headline is converted to a set of trigrams (3-character substrings)
2. For each pair of headlines, compute Jaccard similarity of their trigram sets
3. Similarity ≥ 0.35 = same story cluster
4. The item with the highest source tier becomes the cluster representative
5. Cluster size becomes the `crossSourceCount` for scoring

**Example:**
```
"Ripple launches RLUSD stablecoin on major exchanges"     — The Block (T1)
"Ripple's RLUSD stablecoin goes live on Coinbase, Kraken" — CoinDesk (T1)
"RLUSD by Ripple now available on top crypto exchanges"    — Decrypt (T1)

Trigram similarity: 0.42 → clustered as same story
Cross-source count: 3 → +18 points
Representative: The Block (first T1 in cluster)
```

---

## Content Crons

### Daily Digest

| Setting | Value |
|---------|-------|
| **Cron** | `0 8 * * *` (08:00 UTC daily) |
| **Function** | `daily-digest/index.ts` |
| **Model** | Claude Sonnet |
| **Output** | 3 market-moving items with headlines + explainers |
| **Delimiter** | `\|\|\|` between items (NOT period-based splitting) |
| **Distribution** | Social card (X + Telegram), email digest, app digest page |
| **Framing** | Forward-looking: "3 things moving markets today" |

**Data sources:** Latest signals from DB, CoinGecko batch prices, Fear & Greed index, BTC dominance, top 25 ranked news items.

**Lightweight by design:** ~3 API calls vs ~9+ for the full signal pipeline. Has recovery mechanism — if daily-digest fails, run-signals can generate a fallback digest.

### Breaking News Monitor

| Setting | Value |
|---------|-------|
| **Cron** | `45 * * * *` (every hour at :45) |
| **Function** | `breaking-news/index.ts` |
| **Model** | Claude Sonnet |
| **Threshold** | Score ≥ 75 AND cross-source ≥ 2 |
| **Rate limits** | Max 4 posts/day, min 2h gap between posts |
| **Distribution** | X post + admin Telegram notification |
| **Dedup** | Trigram similarity against recent `social_posts` — prevents re-posting same story |

**Pipeline (10 steps):**
1. Fetch + score all news
2. Filter candidates (score ≥ 75, crossSourceCount ≥ 2)
3. Check daily rate limit (max 4)
4. Check minimum gap (2h since last breaking post)
5. Dedup against recent social_posts via trigram similarity
6. Staging guard (skip if IS_STAGING)
7. Generate tweet via Claude Sonnet
8. Validate tweet content
9. Post to X
10. Log to `social_posts` + admin Telegram

### EOD Report

| Setting | Value |
|---------|-------|
| **Cron** | `5 22 * * *` (22:05 UTC daily) |
| **Function** | `daily-digest/index.ts` with `mode=eod` |
| **Model** | Claude Sonnet |
| **Output** | 3 items that shaped markets today |
| **Distribution** | Dark social card (X + Telegram) |
| **Framing** | Backward-looking: "3 things that shaped markets today" |

Uses the same daily-digest function with a `mode` parameter. The EOD report uses a dark-themed social card and backward-looking language.

---

## Content Quality Rules

### Headline Constraints
- **Max 60 characters** (soft limit), **65 characters** (hard limit)
- If a headline exceeds 65 chars, it is sent back to Claude for rewriting with the constraint enforced
- Only the title (before the em dash) is length-checked — detail text has no cap

### Signal Contradiction Guard
Prevents AI-generated headlines from contradicting the signal direction:
- GREEN/BUY signal + bearish language ("short signal", "going short", "bearish") → replaced with deterministic fallback
- RED/SELL signal + bullish language ("buy signal", "going long", "bullish") → replaced with deterministic fallback

### Delimiter
All multi-item content uses `|||` as the delimiter between items. This replaced period-based splitting which broke on abbreviations like "U.S." and "St." — a production incident on 2026-03-25.

### Time References
Social posts must never use relative time references like "[3h ago]" or "earlier today". Instead:
- Use "recently" or a specific date if absolutely necessary
- Omit time references entirely when possible

### Framing
- Daily digest + breaking news: "markets" not "crypto markets"
- The system covers crypto, equities, commodities, forex, and macro — it is not crypto-only
- Content should reflect general market intelligence with crypto awareness

---

## Asset Briefs (On-Demand)

Generated per signal change via `brief-generator.ts`. Uses Haiku for relevance ranking of asset-specific news, then Sonnet for writing.

| Step | Model | Purpose |
|------|-------|---------|
| 1. Fetch news for asset | — | Filter raw pool by asset keywords |
| 2. Rank by relevance | Haiku | Score news items for asset-specific relevance |
| 3. Generate brief | Sonnet | Write headline + summary from top-ranked items |
| 4. Validate | TypeScript | Contradiction guard, length check |

---

## Scoring Formula Reference

```
score = sourceTierPoints
      + recencyPoints
      + crossSourcePoints
      + trackedAssetBoost
      + impactKeywordPoints
```

| Factor | Values |
|--------|--------|
| Source Tier | T1=15, T2=8, T3=3 |
| Recency | <1h=20, <4h=15, <12h=10, <24h=5, >24h=0 |
| Cross-Source | 2=+10, 3=+18, 4+=+25 |
| Tracked Asset | BTC/ETH=+12, SOL/HYPE=+10, other=+5, none=0 |
| Impact Keywords | "crash/halt/emergency"=+8, "surge/rally"=+6, "SEC/Fed"=+5 |
| **Max possible** | **~110** |

### Impact Keywords (partial list)

| Weight | Keywords |
|--------|----------|
| +8 | crash, halt, emergency, hack, exploit, ban, war, default |
| +6 | surge, rally, plunge, soar, tank, dump, moon |
| +5 | SEC, Fed, FOMC, rate cut, rate hike, regulation, ETF, approval |
| +3 | upgrade, partnership, launch, listing, airdrop |

---

## Key Design Decisions

1. **TypeScript scoring over LLM ranking:** Previous attempts at Haiku-based ranking for digests caused failures and empty briefs. Pure TypeScript scoring is deterministic, zero-cost, and has no failure modes. Haiku ranking is only used for asset-specific briefs where the relevance question is narrower.

2. **Cross-source as primary signal:** A story appearing in 3+ outlets is almost certainly significant. This is the single most valuable ranking signal — more predictive than recency or source tier alone.

3. **Category balancing over pure score sort:** Without balancing, crypto news dominates every digest (more crypto feeds, higher recency). Category floors ensure macro, equities, and commodities get representation proportional to their market importance.

4. **`|||` delimiter over sentence splitting:** Natural language parsing of numbered lists is fragile. A unique delimiter that never appears in natural text eliminates all edge cases.

5. **Lightweight daily-digest function:** The digest doesn't need the full signal engine. Running it as a standalone function with ~3 API calls (vs ~9+ for run-signals) reduces failure surface and cost.

6. **Breaking news decoupled from trades:** Breaking news runs on its own cron, completely independent of the signal/trade pipeline. A breaking news failure never affects trading.
