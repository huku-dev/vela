# Asset Detail v2 — Design Spec

**Status:** Approved 2026-04-27. Ready for implementation.
**Wireframe:** `wireframes/asset-detail-v2.html` (run `cd wireframes && python3 -m http.server` to view, or use repo-root server at `/wireframes/asset-detail-v2.html`)
**Origin:** Sarah onboarding session 2026-04-17. Sarah's quote: *"I just want to be told what to do and why."*

---

## What this brief covers

Three connected pieces:

1. **Asset detail page** — restructured around a verdict-led merged Signal+WPS card, with a position-aware inline action on the position card.
2. **News detail page** — new screen reached by tapping a headline in "What's moving". Vela owns the first read with an AI summary + Vela's interpretation.
3. **Share previews** — bottom-sheet preview before the OS share sheet hands off. Three contexts: with-position, no-position, news.

Plus three backend changes: a new `signal_explanation` LLM task, two new news-detail tasks (`news_summary` + `news_vela_take`), and a smart-refresh trigger for CNN Fear & Greed.

---

## Objectives (Henry, 2026-04-27)

The page must let users immediately understand:

1. **What an asset's current state is** (Buy/Short/Wait, price, position P&L if any)
2. **The narrative around it** (what's happening, what's driving it)
3. **Where it's likely to move** (what would change the picture, named price levels)
4. **How and where Vela is helping** (managing the position, watching for entries, flagging news)

Not all users want the verdict alone — depth must remain accessible (news clickthroughs, technicals one tap away).

---

## Voice rules — non-negotiable

These apply to every user-facing string the redesign touches. The same rules apply to the LLM prompts that generate text for these surfaces.

- **No em dashes.** Periods, commas, colons.
- **Buy / Short / Wait nomenclature.** Never green / red / amber as user-facing copy.
- **Direction-neutral.** Vela trades both long and short. Don't editorialize about market direction. Excitement only attaches to the user's P&L, never to which way price moved.
- **No technical jargon.** No RSI, ADX, EMA, SMA, momentum, volatility, leverage, yield, hawkish, dovish, equities, ETF inflows (unless from news), institutional, derivatives, basis, contango, perp, funding.
- **15-year-old reading level.** A non-investor should follow every line.
- **Active management framing on losses.** "Vela is still managing your position" + "will close at $X to cut losses" — not "stop is X% away" or "Vela closes to limit your loss" (the latter sounds inevitable).

---

## Asset detail page redesign

### Section order, top to bottom

1. **Sticky asset header** — unchanged. Icon, name, price, 24h change.
2. **Position card** (if user has open position on this asset) — unchanged primitive (mint for long, peach for short, P&L hero, entry, leverage, expandable details). The expanded view (chevron tapped) keeps every live primitive: Position size, Entry price, Current price, Time open, Stop-loss with info tooltip, Close position button. NEW: state-aware inline Vela action row at the bottom of the card, present in both collapsed and expanded states (see below).
3. **Merged Signal + WPS card** — REPLACES the live "Tier 1 Key Signal" card AND the "Where Price Stands" card. Single card containing:
   - Signal pill (top, on its own line — fixes the floating-pill issue)
   - Verdict line (Space Grotesk, position-aware lede)
   - Reason paragraph (explains the signal state)
   - 3-up stats row (Last 24H / Last 7D / 7D Range — kept from live WPS, this is core visual variance)
   - "What would change" plain-English paragraph with named price levels
   - "View signal history (N changes in 30 days)" footer link with subtle dotted underline. Hidden when there's no prior history.
4. **What's moving** — REWIRED. Reads from `news_cache` directly (not `brief.detail.events_moving_markets`). Each row: sentiment dot (green/red/grey from `ai_classification.sentiment`), headline, source name in plain text (Bloomberg / CoinDesk / Reuters / The Block — full names, no mono chip), separator dot, catalyst category, relative time. **Each row is a full tappable affordance into the news detail page**, not just the headline text. Three affordance cues stacked: (a) a subtle underline on the headline (gray-300 underline color, 3px offset, matches the signal-history-link label treatment), (b) a trailing right-chevron `›` rendered via `::after` so the HTML stays clean, (c) a hover state that lifts the row background to mint-50 with the chevron sliding 2px right and darkening. The whole row gets `cursor: pointer`. Without these cues the news detail page is undiscoverable and the entire `news_summary` + `news_vela_take` LLM investment goes unused.
5. **Market Mood** — unchanged from live. Existing FearGreedGauge SVG component + plain-English context line. No redesign work; the smart-refresh trigger on importance≥4 news is the only behavioral change (see backend section).
6. **Why we think this** — unchanged from live. Collapsible disclosure rendering the existing IndicatorsSection block (Short-term trend / Longer-term trend / Momentum / Trend strength). No copy or component changes; kept out of the main flow.
7. **Engagement footer** — unchanged. Rate this brief / Share buttons.

### Variant copy reference

For each signal state, the verdict and reason copy is locked. Always position-aware in the verdict line, signal-focused in the reason.

#### Wait + open long, in profit (e.g. up 8.2%)

- **Verdict:** "Your long is up 8.2%."
- **Reason:** "Vela is on Wait. The Buy setup that opened the trade is still holding above $69,000, and no new shift to take profit has emerged."
- **Position card inline action** (visible because position is at least 2% above entry):
  - Subject: "Profit target $77,500."
  - Description: "Vela trims part of the position to lock in profit. The rest stays open if the move continues."

#### Wait + open long, slightly down (e.g. down 2.1%, stop more than 2% away)

- **Verdict:** "Your long is down 2.1%."
- **Reason:** "Vela is on Wait. Bitcoin has pulled back inside its recent range, but the Buy setup that opened the trade hasn't broken down."
- **Position card inline action:** NONE. Showing the stop when far from triggering implies inevitable loss. Position card stays clean.

#### Wait + open long, close to stop (e.g. down 5.1%, stop within 2%)

- **Verdict:** "Your long is down 5.1%."
- **Reason:** "Vela is on Wait. The Buy setup is under pressure but hasn't broken down. Vela stays in the trade until it does."
- **Position card inline action** (visible because stop is within 2% threshold):
  - Subject: "Vela is still managing your position."
  - Description: "Will close at $66,400 to cut losses, 1.2% below current price."
  - **Voice rule applied:** active management framing. NOT "Vela closes at $X to limit your loss" (sounds inevitable).

#### Buy + no position

- **Verdict:** "Vela has flipped Bitcoin to Buy."
- **Reason** (3 sentences — the trust-building "why the flip"):
  1. The price action that triggered the flip with named price level: "Bitcoin pushed above $74,000 yesterday, the level Vela watches for new entries."
  2. The supporting catalyst: "Record ETF inflows hit at the same time, strengthening the case."
  3. What Vela will do next: "A trade proposal will follow if the setup confirms."
- No position card.

#### Short + no position

- **Verdict:** "Vela has flipped Bitcoin to Short."
- **Reason** (3 sentences):
  1. "Bitcoin broke below $63,000, the level it had been holding for weeks."
  2. "News flow turned more negative on the new SEC investigation news."
  3. "A trade proposal to short Bitcoin will follow if the setup confirms."

### Position-card inline-action rules

The inline Vela action at the bottom of the position card is state-aware. Show:

| Position state | Inline content |
|---|---|
| Up ≥ 2% from entry | Profit target line (subject + description above) |
| Up < 2% from entry | None |
| Down with stop > 2% away | None |
| Down with stop ≤ 2% away | Protective management line (subject + description above) |

Both cases use the same visual treatment: small green diamond (Vela iris), bold subject, smaller description.

### Multiple profit targets

When `positions.take_profit_price` and ladder logic produce 2+ trim levels, show **only the next unhit target**. Do NOT show "1 of 3 targets" indicator — avoids setting expectations on targets that may never trigger.

### What gets cut from the live page

- Standalone "Signal History" card (rolled into the merged card as a footer link)
- "Where Price Stands" as a standalone card (merged into Signal card)
- The text-paragraph "what would change" (replaced with named price levels in plain English)
- TriggerCard primitive (was already removed from live, do not re-add — it clashed with WPS)

### What stays exactly as-is

- Sticky asset header
- Position card primitives (P&L hero, mint/peach tinting, expand chevron, manual close confirm). The expanded state continues to show Position size, Entry price, Current price, Time open, Stop-loss with info tooltip, and Close position button. The new inline Vela action row sits at the bottom of the card in both collapsed and expanded states.
- FearGreedGauge SVG and Market Mood card
- "Why we think this" disclosure containing existing IndicatorsSection
- Engagement footer (Rate / Share)
- Tier comparison sheet
- All routing / data-fetching that doesn't relate to the merged card

---

## Free-tier gating

When a free-tier user opens an asset their plan doesn't include, the asset detail page applies a paywall treatment to the analytical surfaces while keeping the real-time signal status and public data visible. Implementation extends the existing `LockedSignalCard` primitive pattern; the new card has more surface area to gate (verdict line, reason, stats row, named price levels, signal history), so the free-tier treatment renders the full card with a blur filter rather than a one-line teaser. This makes the depth of paid content visible and stops the user from concluding "I'm only missing a sentence."

### Signal+WPS card on free tier

The locked card is a single card with no nested chrome. The pill, blurred preview, and upgrade pitch are all sections of the same card separated by thin dividers — same way any normal card stacks its sections. No floating overlay, no card-on-card.

- **Signal pill stays real.** The Wait/Buy/Short pill renders with full color and the actual signal status. Free-tier users see the current state without paying. Builds trust and lets the upgrade pitch land in context.
- **Lock glyph in the top-right corner** (small, 18×18, gray). One unobtrusive marker that the card is gated.
- **Compact blurred preview underneath the pill.** Just the verdict line and reason paragraph, blurred with `filter: blur(4.5px)`. Establishes "there's real analysis behind this" without bloating the card with the full WWC + stats + history (those would more than triple the card height for no extra clarity).
- **Upgrade pitch is plain inline content** below the blurred preview, separated by a thin gray-200 divider. No border, no shadow, no nested-card chrome. Sections in order: muted eyebrow `Upgrade required`, Space Grotesk title `Unlock {Asset} signals`, three short bullets, Signal-Green primary CTA `Upgrade to unlock`, muted `Plans from $10/mo` subline.
- **Tap anywhere on the card** routes to the plan picker (`navigate('/account?tab=plan')`). Analytics: `LOCKED_CARD_CLICKED`.
- **"Why we think this" disclosure is hidden.** The indicators it reveals are signal-derived.
- **Engagement footer (Rate / Share) is hidden.** No brief to rate, and Share is itself a paid surface.

### News detail page on free tier

- **The story panel stays open.** "The story" is an AI summary of public news content. Same source content the user could read on Bloomberg / CoinDesk directly, just digested. No gate.
- **Vela's read is gated, but the conclusion is visible.** The directional dot (green/red/grey) and the headline ("Bullish for Bitcoin", etc.) render unblurred. The supporting paragraph is blurred.
- **Same single-card pattern, compact variant.** Below the blurred body paragraph and a thin divider sits the inline upgrade pitch with tighter spacing. Eyebrow `Upgrade required`, title `Unlock Vela's read on the news`, three tight bullets, same CTA + price subline.
- **"Read full article on {source}" link stays active.** The user can always reach the underlying news regardless of tier.
- **"More on {asset} today" section** stays open with the same row tappable affordance.

### Why a single-card pattern

- **No card-inside-card.** A floating overlay over a card reads as two stacked components even when the inner one has no border, and absolute positioning made the overlay overlap the pill or bleed beyond the card boundary on the smaller news-detail surface. The single-card pattern keeps the card's own boundary as the only frame, with the upgrade pitch rendering as just another section of that card.
- **Blurred preview conveys depth without bloating.** Showing only the verdict line + reason paragraph signals "there's real analysis here." The earlier full WWC + stats + history blur made the card 3× taller for the same message.
- **Plainer copy, fewer cute phrases.** No "stop-loss / profit ladder", no "shifts the setup". Friend-not-finance-pro: "Vela trades Bitcoin for you and looks after the position", "A heads-up when news could move the price."

**Copy by surface**

| Surface | Eyebrow | Title | Bullets |
|---------|---------|-------|---------|
| Asset detail signal card | `Upgrade required` | `Unlock {Asset} signals` | See why Vela calls Wait, Buy, or Short · Vela trades {Asset} for you and looks after the position · A heads-up when news could move the price |
| News detail Vela's read | `Upgrade required` | `Unlock Vela's read on the news` | Plain-English take on news that matters · Tied to your {Asset} position · A heads-up only when it counts |

### What stays open across both surfaces

- Asset header (icon, name, price, 24h change). Public market data.
- "What's moving {asset}" section on the asset detail page. News headlines, sentiment dots, source bylines, time stamps, full row tappable.
- Market Mood (Fear & Greed gauge + context line). Public data.
- The story panel and source link on news detail pages.

### One nudge per page

Each page has exactly one upgrade prompt: the locked Signal+WPS card on the asset detail page, or the locked Vela's read card on the news detail page. No additional banners, no top-bar, no overlays, no double-CTAs. Tapping the locked card routes to the plan picker (`navigate('/account?tab=plan')`). Reuse the `LOCKED_CARD_CLICKED` analytics event already wired on the existing component, plus a new `LOCKED_NEWS_TAKE_CLICKED` for the news detail variant.

### Why this approach

- The signal pill stays real so the user gets immediate value from every visit (current state, current price, news, mood). The paywall sits exactly where the proprietary analysis lives.
- Blurring the full card instead of a one-line teaser conveys the depth of paid content. A user who only sees a one-line teaser concludes "not much here." A user who sees a fully-shaped multi-paragraph card with three stats, named price levels, and a history footer concludes "there's a real analysis here."
- Same primitive on both surfaces (asset detail signal card + news detail Vela's read), same upgrade copy pattern, same single-nudge rule. Predictable.

---

## News detail page (new)

Reached by tapping any headline in the asset detail page's "What's moving" section.

### Section order, top to bottom

1. **‹ Back to Bitcoin** link, top-left only. (NOT a top-right Share — that clogged the UI and used the wrong arrow direction.)
2. **News headline** (Space Grotesk, large)
3. **Source meta row:** source name in plain text (Bloomberg / CoinDesk / Reuters / The Block — full names, no abbreviation chip) · separator dot · catalyst category · relative time. Same primitive as the asset detail page WhatsMoving section, consistent byline component across both surfaces. The dot is rendered as a CSS `::before` pseudo-element on the category span (`content: "·"`, muted color, 6px right margin) so the byline reads naturally without an extra DOM node.
4. **Asset price strip** (NEW) — small chip showing icon + asset name + current price + 24h change. Reinforces the asset-news connection.
5. **The story** (white card) — AI-generated 3-5 sentence factual summary. Lead with the most important fact.
6. **Vela's read** (lavender card matching the in-app "What Vela is doing" pattern) — sentiment label (Bullish/Bearish/Neutral for the asset, dot-prefixed) + 2-3 sentence interpretation.
7. **Read full article** (CTA, full-width black button with ↗ arrow)
8. **More on Bitcoin today** — same `wm-row` component as the asset page WhatsMoving, with sentiment dot + headline + source chip + catalyst + time. Each row links to its own news detail page.
9. **Share footer** — single full-width "Share" button. Matches the engagement footer pattern on the asset detail page.

### Empty / fail state

When LLM generation fails, times out, both providers exhausted, or `news_cache.summary` cache is empty:

- Headline + source meta row + asset price strip render normally (no LLM dependency)
- The story + Vela's read cards collapse into ONE calm message:
  - Bold: "Vela's read isn't ready yet."
  - Body: "Try again in a minute. The full article is one tap away below."
  - Vela diamond mark goes grey (off, not alarming)
- Read full article CTA still works — user has a path forward
- More on Bitcoin today still renders (no per-article LLM dependency for the related list)
- No technical reasons surfaced to the user. No "API timeout" or "service unavailable" jargon.

### Order rationale

The story comes BEFORE Vela's read. Users need to know what happened before getting our interpretation. (Earlier draft had the order reversed; corrected per Henry 2026-04-27.)

---

## Share previews

Tapping Share opens a bottom sheet showing exactly what will be shared. User confirms before the OS share sheet hands off.

### Visual chassis (all modes)

The shared image follows the existing marketing share-card pattern from `src/design-mockups/share-card.html`:

- **Aspect ratio:** 1200×628 landscape (Twitter / OG-image standard)
- **Background:** `#FFFBF5` cream
- **Top accent bar:** 5px in signal color (Signal Green for Buy / red for Short / amber for Wait)
- **Header row:** large asset icon (36px circle in production, scales to 52px on the actual rendered image) + asset name in Space Grotesk Black + ticker chip + signal pill (rounded marketing-style, top-right)
- **Footer:** Vela angular-eye logomark + "vela" wordmark + getvela.xyz + date

### Three modes

#### Mode A — with position (toggle ON, default)

Trade block in the body:
- Entry → Now arrow row with mono prices
- Hero return % (Space Grotesk Black, large)
- Open-since label below

Plus a one-sentence context line ("Vela's Buy signal still holding above $69k. No new shift to take profit yet.")

**Privacy rule (locked):** dollar P&L is **never** in the share image. Side, entry, current, open date, return % only.

#### Mode A toggle OFF (collapses to insight card)

Trade block disappears. Card collapses to the same shape as Mode B — hero price + 24h change + plain-English context. Useful when the user wants to share Vela's analysis without revealing they're in the trade.

#### Mode B — no position

- Hero price (large mono) + 24h change beside it
- 2-sentence context (verdict + reason)

#### Mode C — news detail share

Same chassis but lead is news, not price.

- Pill at top-right reads "Bullish" / "Bearish" / "Neutral" (no "read" suffix — outsiders don't have in-app context for what "read" means)
- News headline as the lead
- Source chip + source name + relative time
- Vela's read as the body paragraph
- Article URL goes in the **caption**, not on the image, so the image stays clean

### Caption clarity

Confusing the caption with the image was an issue in earlier drafts. The fix:

- Image preview has explicit "IMAGE (1200×628)" label above it
- Caption block has its own labeled section: "CAPTION · sent with the image"
- Hint text below the label: "This text goes in the post or message body, not in the image. You can edit it."
- Editable textarea with auto-generated default copy

The caption goes wherever the OS share sheet routes (Twitter post body, WhatsApp message body, iMessage text). Vela doesn't control destination-specific formatting.

---

## Backend changes

### 1. New LLM task: `signal_explanation` (free-tier)

**Purpose:** generate the 3-sentence "why the flip" reason copy that lives in the merged Signal+WPS card on the asset detail page.

**Why a new task vs reusing Sonnet brief:** Sonnet brief stays for the broader market narrative (it weaves multi-asset context better than qwen, per the daily-digest shadow logs). The signal_explanation is focused, repetitively-shaped, and runs frequently — a good fit for free-tier qwen. Cost stays $0 even with news-catalyst regen.

**Routing (in `_shared/llm/registry.ts`):**
```ts
signal_explanation: {
  primary:  { provider: "nvidia", model: "qwen/qwen3.5-122b-a10b" },
  fallback: { provider: "groq",   model: "llama-3.3-70b-versatile" },
  // Sonnet last-resort safety net only — fires < 0.1% of cases based on news-classify telemetry
  lastResort: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
  tier: "cheap",
  maxTokens: 400,
  temperature: 0.2,
  timeoutMs: 30_000,
  jsonSchema: SIGNAL_EXPLANATION_SCHEMA,
}
```

**Storage:** `briefs.detail.signal_explanation_plain` (string) OR new `signals.signal_explanation_plain` column. Either works; the former is simpler since briefs already exist per signal flip.

**Generation triggers (locked):**
- Signal color flip (always)
- Substantial news catalyst change for the asset — specifically when `news-enrich` classifies an `importance >= 4` row affecting that asset, OR sentiment skew on the asset's recent news flips materially. Same trigger pattern as the existing asset-intel smart-refresh.

**Cadence estimate:** ~3-5 signal flips/asset/month + ~5-10 catalyst-driven refreshes/asset/month = ~8-15 calls/asset/month, all $0.

**Prompt (locked):**
```
You are explaining why Vela's signal just flipped on a single asset. The reader is on the asset's
page in the Vela app. They need to understand WHAT caused the flip, in plain English, in 3 short
sentences.

INPUT: asset name, the new signal direction (Buy / Short / Wait), the price level that triggered
the flip, the top 1-2 catalysts from recent news, and one sentence on what Vela will do next
(send a proposal, hold, watch).

OUTPUT: exactly 3 sentences in this shape.
1. The price action that triggered the flip. Name the price level.
2. The supporting catalyst. Name the event.
3. What Vela will do next.

VOICE:
- Knowledgeable friend, not analyst
- 15-year-old reading level
- No em dashes
- No jargon (no RSI, ADX, EMA, momentum, volatility, leverage, yield, hawkish, dovish, equities,
  inflows, derivatives, basis, contango)
- Direction-neutral framing: describe events factually. Don't say "the market is doing well"
  because Vela trades both directions.
- Buy / Short / Wait, never green / red / amber

Output JSON: { "signal_explanation_plain": "..." }
```

### 2. New LLM task: `news_summary` (free-tier, lazy)

**Purpose:** generate "The story" paragraph on the news detail page.

**Routing:** same chain as signal_explanation (NVIDIA qwen → Groq qwen → Sonnet last-resort).

**Storage:** `news_cache.summary` (new column). Cached after first generation so subsequent views are free.

**Trigger:** lazy. Generated on first tap into the news detail page when `news_cache.summary IS NULL`. If both free-tier providers fail, the empty/fail state renders.

**Prompt (locked):**
```
You are summarizing a news article for a market intelligence app. The reader tapped the
headline because they care about a specific asset. They want the facts before getting Vela's
interpretation.

INPUT: full article body, headline, source.

OUTPUT: 3-5 sentences. Lead with the most important fact. Capture: what happened, the key
numbers, the named entities (companies, people, regulators) that anchor the story.

VOICE:
- Plain English, no jargon
- No em dashes
- No editorializing about the market or asset direction
- Don't say "this is bullish/bearish" — that's the Vela's read job, not the story summary's
- Direction-neutral: describe events factually

Output JSON: { "summary": "..." }
```

### 3. New LLM task: `news_vela_take` (free-tier, lazy)

**Purpose:** generate "Vela's read" card on the news detail page.

**Routing:** same chain.

**Storage:** `news_cache.vela_take` (jsonb column with `{ sentiment, body }`). Cached.

**Trigger:** lazy, generated alongside news_summary on first detail-page tap.

**Prompt (locked):**
```
You are writing Vela's interpretation of a news story for a specific asset. The user already
saw the factual summary above; this is your read.

INPUT: news headline, news body, the asset, the asset's current Vela signal (Buy/Short/Wait),
and the news classification (sentiment, importance, catalyst category) from our pipeline.

OUTPUT JSON:
{
  "sentiment": "bullish" | "bearish" | "neutral",   // for THIS asset, not the market overall
  "vela_take": "2-3 sentences. Don't repeat facts from the summary, build on them. Anchor to
                a historical pattern when relevant. Reference the current Vela signal if and
                only if it adds context."
}

VOICE:
- Knowledgeable friend, not analyst
- No em dashes
- Plain English
- Direction-neutral framing of market context. Excitement attaches to the user's potential
  P&L, not to which way price moved.
- Buy / Short / Wait, never green / red / amber

Examples of good Vela's read shape:
- "Bullish for Bitcoin. Flows this size historically come at the start of multi-month rallies.
   Aligns with Vela's current Buy signal on Bitcoin."
- "Neutral for Bitcoin. The DOJ news is a political shift, not a direct Bitcoin catalyst.
   Watch how Bitcoin's reaction holds over the next few sessions."
- "Bearish for Ethereum. New regulatory pressure tends to compress the asset for weeks, not
   days. Vela's Wait signal makes sense until clarity returns."
```

### 4. WhatsMoving rewire (asset detail page)

Today, "What's moving Bitcoin" reads from `brief.detail.events_moving_markets` (Sonnet-extracted at brief generation time). This staleness lags the news pipeline.

**Change:** read from `news_cache` directly, filtered to rows where `relevant_assets` contains the asset's symbol (lowercase) and `published_at` is within last 48h. Order by `published_at DESC`, limit 10.

**Visual:** each row keeps the existing column shape but adds:
- 8px sentiment dot at the start (green/red/grey from `ai_classification.sentiment`)
- Source chip (mono abbreviation) — replace the current underlined plain-text source
- Catalyst category (from `ai_classification.catalysts[0]`)
- Headline becomes the click target → opens news detail page (NOT a redirect to source URL)

### 5. Market Mood gauge improvements

#### Source confirmation

| Asset class | Index | Refresh cadence | Cache |
|---|---|---|---|
| Crypto (BTC, ETH, SOL, HYPE) | Crypto Fear & Greed (alternative.me) | Per-brief, live fetch | None |
| Equities + Commodities + Indices | CNN Fear & Greed | Daily 07:30 UTC + smart-refresh | `market_context_cache.cnn_fg` |

CNN F&G is **market-wide, not per-asset**. Same value reads for every non-crypto asset.

#### Smart-refresh on news catalyst (NEW)

In addition to the daily 07:30 UTC cron, refresh the CNN F&G value when `news-enrich` classifies an `importance >= 4` non-crypto news item. The classification is qwen's job (already happening in the news pipeline), the trigger is a fire-and-forget call to `market-context-refresh`. Same pattern as the asset-intel briefs smart-refresh.

#### Fallback chain (NEW)

When the brief generation fails to write a `fear_greed` string into `detail.market_context`:

1. Attempt regeneration via the free-tier chain: NVIDIA qwen primary → Groq qwen fallback
2. Only if both free-tier providers fail, hide the gauge

Also fixes the existing fallback-path bug at `brief-generator.ts:1577-1579` that wrote to `detail.market_context.sentiment` (frontend regex doesn't read this key) instead of `fear_greed`. Rename to `fear_greed`.

---

## Files that will be touched

### Backend (`/Users/henry/crypto-agent`)

| File | Change |
|---|---|
| `supabase/functions/_shared/llm/registry.ts` | Add `signal_explanation`, `news_summary`, `news_vela_take` task entries |
| `supabase/functions/_shared/llm/types.ts` | Extend `TaskName` union |
| `supabase/migrations/{ts}_news_cache_summary_columns.sql` | New columns: `news_cache.summary text`, `news_cache.vela_take jsonb` |
| `supabase/migrations/{ts}_signal_explanation.sql` | Routing flag seed; new field on briefs.detail OR new column on signals |
| `supabase/functions/run-signals/index.ts` | After signal flip + brief gen, fire `signal_explanation` task |
| `supabase/functions/news-enrich/index.ts` | After importance≥4 classify on non-crypto asset, fire `market-context-refresh` smart trigger |
| `supabase/functions/_shared/news-detail-generate.ts` (new) OR inline | Lazy LLM call for news_summary + news_vela_take, with empty/fail state handling |
| `supabase/functions/_shared/brief-generator.ts` | Fix fallback path key (`sentiment` → `fear_greed`); add free-tier regen chain when AI brief fails |
| `supabase/functions/_shared/asset-intel-trigger.ts` | Already has `triggerSmartRefresh`; reuse pattern |

### Frontend (`/Users/henry/crypto-agent-frontend`)

| File | Change |
|---|---|
| `src/pages/AssetDetail.tsx` | Replace "Tier 1 Key Signal" + WPS sections with merged card; add inline action to position card; rewire WhatsMoving to news_cache; signal-history conditional rendering |
| `src/pages/NewsDetail.tsx` (new) | New route `/news/:newsId`. Renders the news detail page (story card, Vela's read card, asset chip, share footer, related stories). |
| `src/components/SharePreviewSheet.tsx` (new) | Bottom-sheet pattern. Three modes: with-position (toggle), no-position, news. Renders the landscape share card image via canvas (similar to `ShareTradeCard.tsx`'s pattern). |
| `src/components/AssetChip.tsx` (new, optional) | Reused on news detail page header |
| `src/components/SignalCard.tsx` (new) | The merged Signal+WPS card. Or merge into AssetDetail.tsx if not reused |
| `src/components/PositionCard.tsx` (existing, modify) | Add state-aware inline Vela action |
| `src/AppRoutes.tsx` | Add news detail route |

---

## Out of scope / deferred

- **Decisions log page** ("Vela passed on entries at $A and $B because of Y") — was explored in earlier wireframe revs, parked. Inline summary considered as part of "What Vela is doing" but rejected because it duplicates the position card / signal history. Revisit if user research surfaces demand for full transparency on skipped setups.
- **Telegram fan-out on `signal_explanation` regeneration.** When the explanation refreshes due to news catalyst, send a TG message to users with positions on that asset (or opted-in alerts), deep-linked to the asset page. Telegram bot has the broadcast infrastructure in `notify.ts`. Separate sprint, but `signal_explanation` should include a `generated_at` timestamp so we can detect "this is newer than last sent."
- **Multiple profit targets visualization** — locked to "next unhit only" for v1. Revisit when ladder logic produces multi-target trades regularly.
- **Per-stock or per-commodity sentiment index** — CNN F&G is market-wide. There's no per-asset sentiment gauge today. Could be a future qwen-generated asset-specific mood reading, but not in this scope.
- **Free-tier asset detail page treatment** — partial-let-in vs current "tap blocked" — explored in earlier revs, parked. Revisit when conversion data warrants.
- **Web/desktop layout** — same content centered at 600w with bottom-nav PWA shell. Already validated in rev 4 wireframe. No desktop-specific work in this scope.

---

## Decisions locked (full list)

| # | Decision |
|---|---|
| 1 | Verdict-led page: pill on its own line, position-aware verdict line, signal-focused reason |
| 2 | Merge Signal History card into Signal+WPS card via "View signal history" link footer |
| 3 | Position-card inline action is state-aware: profit target when up ≥ 2% from entry, protective management when stop ≤ 2% away, nothing otherwise |
| 4 | Stop framing: "Vela is still managing your position" leads, not "stop is X% away" |
| 5 | Profit target copy: "Vela trims part of the position to lock in profit. The rest stays open if the move continues." |
| 6 | Multiple profit targets: show next unhit only |
| 7 | Signal explanation: 3-sentence "why the flip" structure (price action, catalyst, Vela's next step) |
| 8 | Signal explanation generation: new dedicated free-tier task (qwen primary, Groq fallback, Sonnet last-resort) |
| 9 | Signal explanation regeneration: on signal_color flip AND substantial news catalyst change |
| 10 | "View signal history" treatment: subtle dotted underline + bolder chevron. Hidden when no history. |
| 11 | News rewire: read from `news_cache` directly with sentiment dot, source chip, catalyst tag, relative time |
| 12 | News detail page is a new screen reachable from any "What's moving" headline |
| 13 | News detail order: The story FIRST, Vela's read SECOND |
| 14 | News detail summary length: ~5 lines max each |
| 15 | News detail Share is a footer button (not top-right). Single full-width button |
| 16 | News detail asset price strip persists between source meta row and content |
| 17 | LLM chain for all 3 new tasks: NVIDIA qwen → Groq qwen → Sonnet last-resort |
| 18 | News detail empty/fail state: collapsed single message, no technical jargon, full article CTA still works |
| 19 | CNN F&G smart-refresh on importance≥4 non-crypto news (qwen-classified pipeline triggers re-fetch) |
| 20 | Fear & Greed gauge fallback chain: free-tier regen attempt before hiding |
| 21 | Share preview chassis: 1200×628 landscape card matching marketing share-card.html pattern |
| 22 | Share preview: dollar P&L is NEVER shared. Toggle controls trade-detail block (entry/now/return % only) |
| 23 | Share preview Mode A toggle ON: entry → now arrow + hero return % + open-since |
| 24 | Share preview Mode B & toggle OFF: hero price + 24h + 2-sentence context |
| 25 | Share preview Mode C (news): pill says "Bullish" / "Bearish" / "Neutral" only, no "read" suffix |
| 26 | Caption is sent WITH the image, not on it. Explicit label + hint text in the sheet UI |
| 27 | Engagement footer (Rate / Share) preserved on all asset detail variants |
| 28 | News detail footer: Share only, no Rate (different content type than a brief) |
| 29 | All voice rules: no em dashes, no jargon, Buy/Short/Wait, direction-neutral, 15-year-old reading level |
| 30 | Free-tier gating: signal pill (Wait/Buy/Short) stays REAL on the asset detail page so users see the current state. The full analytical card (verdict, reason, stats, WWC, history) is rendered then blurred so the depth of paid content is visible. "Why we think this" and engagement footer hidden. News + Fear/Greed stay open. |
| 30b | News detail free-tier: "The story" panel stays open (public news digest). "Vela's read" is gated. Sentiment dot + bullish/bearish/neutral headline stay visible; the supporting paragraph is blurred. "Read full article on {source}" link stays active. |
| 30c | Upgrade pitch is INLINE content within the locked card (eyebrow + title + 3 value bullets + Signal-Green CTA + price subline), separated from the blurred preview by a thin divider. NO floating overlay, NO nested card chrome — single card with the pitch as just another section. Plainer copy: no "stop-loss / profit ladder / shifts the setup". Eyebrow is `Upgrade required`, title is `Unlock {Asset} signals` (drops the redundant "Vela's"). |
| 31 | Position card expanded state preserves all live primitives (Position size, Entry price, Current price, Time open, Stop-loss with info tooltip, Close position button). Inline Vela action row sits below in both collapsed and expanded states. |
| 32 | Source byline format: full source name in plain text + CSS pseudo-element separator dot before the catalyst category. No abbreviation chip. |
| 33 | "What's moving" rows are full-row tappable. Three stacked affordance cues: subtle underline on the headline (gray-300, 3px offset), trailing right-chevron via `::after`, hover state lifts row to mint-50 + slides chevron 2px right. Required for news detail page discoverability. |

---

## Implementation phasing suggestion

If splitting the work:

**Phase 1 — backend foundation (no UI exposure):**
- Add 3 new LLM tasks to registry
- Schema migrations for `news_cache.summary` + `news_cache.vela_take` + `signal_explanation_plain`
- Wire `signal_explanation` generation into `run-signals` after brief gen
- Wire smart-refresh trigger from `news-enrich`
- Brief-generator fallback fix (sentiment → fear_greed) + free-tier regen chain

**Phase 2 — asset detail page redesign:**
- Merged Signal + WPS card
- Position card inline action (state-aware)
- WhatsMoving rewire (read from news_cache)
- "View signal history" subtle treatment
- Voice rules applied across all generated copy

**Phase 3 — news detail page:**
- New route + component
- Lazy generation of summary + vela_take
- Empty/fail state
- Asset price strip

**Phase 4 — share previews:**
- SharePreviewSheet component
- Three modes
- Canvas-rendered landscape card image
- Wire from existing engagement footer

Each phase ships independently. Order can flex but phase 1 unblocks phases 2-3.
