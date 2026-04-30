# News brief image — design spec

**Status:** Locked 2026-04-30. Step 1 (Vercel OG route) implemented. Awaiting Step 2 (backend integration).
**Wireframe:** [`wireframes/news-brief-image-options.html`](../../wireframes/news-brief-image-options.html)
**Driving feedback:** Premium users (Damola, Pedro) reported batching/stockpiling briefs. Two issues: briefs lacked "what's in it for me," and every brief looked the same so nothing felt urgent.

## What changes

Today's macro/news briefs are text-only Telegram messages. New version adds a branded 1600×900 PNG card at the top of each message. Card content is **per-user** (only shows direction rows for assets the user holds).

## Card layout (1600×900, neobrutalist, matches signal flip card)

```
┌──────────────────────────────────────────────────────────┐
│ ◆ vela                                      Apr 30, 2026 │
│                                                            │
│   {Headline}                                               │
│   (Space Grotesk 800, 76px)                                │
│                                                            │
│   {Vela's read — one-line synthesis}                       │
│   (Inter 400, 40px)                                        │
│                                                            │
│   [BULLISH] [◯ HYPE] [◯ BTC]                              │
│   [BEARISH] [◯ OIL]                                        │
│                                                            │
├──────────────────────────────────────────────────────────┤
│ getvela.xyz                              Read full brief →│
└──────────────────────────────────────────────────────────┘
```

### Direction rows — conditional display

- **User holds bullish-tagged assets** → show `BULLISH` row with their held bullish assets
- **User holds bearish-tagged assets** → show `BEARISH` row with their held bearish assets
- **User holds neither** → no direction rows (card shows only headline + Vela's read)
- **Neutral assets are never shown** — too noisy when many assets are neutral

When watchlist ships, add a watchlist tier between positions and "no exposure": positions → watchlist → hide.

### Direction pill labels

- `BULLISH` (signal-green bg, ink text) — not "BULLISH FOR"
- `BEARISH` (signal-red bg, cream text) — not "BEARISH FOR"

### Asset chips

- Circular icon (68×68, 3px ink border) + ticker (Space Grotesk 800, 38px)
- White background, 4px ink border, 100px height
- Padding `14px 32px 14px 14px`, gap 16px between icon and ticker
- No per-chip direction label or arrow (direction is owned by the row pill)
- Icons resolve from `/public/icons/<ticker>.png` (stocks/commodities) or coingecko CDN (crypto, via `getCoinIcon()`)
- Fallback: monogram circle (first letter) when icon is unresolved

### Direction pills

- 100px height, padding `0 32px`, 4px ink border
- Inter 800, 28px, uppercase, letter-spacing 0.06em
- 24px gap between pill and chips

### When no chips (no exposure)

- Body uses `flex: 1` + `justify-content: center` — vertically centers content
- Headline bumped to 96px, Vela's read bumped to 50px
- Without this, the empty middle of the card felt void at thumbnail size

### Footer

- Black bar, 88px tall, full-width
- `getvela.xyz` left, `Read full brief →` (signal-green) right
- The CTA in the image footer is brand-consistent with signal flip card; the actual link is a native Telegram button (see caption section)

## Telegram caption format

Caption (HTML parse mode — switched from Markdown after QA found that
real-world headlines contain `*`, `` ` ``, `[`, `_` which break Markdown
bold parsing):

```
📰 <b>{Headline}</b>

{Tighter 1-2 sentence summary}

<b>Vela's read:</b> {personalized verdict line}
```

Only `<`, `>`, `&` need escaping in HTML mode — much smaller collision
surface than Markdown.

Plus a **native Telegram inline keyboard** appended to the message via `reply_markup`:

```json
{
  "inline_keyboard": [
    [{"text": "Read full brief", "url": "https://app.getvela.xyz/news/<id>"}]
  ]
}
```

Native button > markdown link: bigger tap target, more idiomatic, frees caption space for content. The 📰 prefix matches the existing `broadcastMarketAlert` convention so the new image-first format feels continuous with briefs users already recognize.

When user has no exposure: omit only the `*Vela's read:*` line. Headline, summary, and inline keyboard button stay.

### Vela's read templates

- **Bullish only:** `Bullish for your {assets} long(s).`
- **Bearish only:** `Mildly bearish for your {assets} long(s). We're monitoring closely.`
- **Mixed:** `Bullish for your {bullish} long, but mildly bearish for your {bearish} long. We're monitoring closely.`
- **No exposure:** Hide the entire `*Vela's read:*` line.

### Voice notes

- Use "but" to connect bullish + bearish in mixed case (not comma)
- "mildly bearish" softens without sugar-coating; honest about direction matters
- "We're monitoring closely" reinforces the always-watching brand pillar — only used when the verdict has bearish content
- Avoid "tailwind" / "headwind" — not plain English per voice rules. Use "bullish" / "bearish" or "boosts" / "pressures"

## Per-user image — cost mitigation

Per-user image generation is more expensive than a single cached image, but manageable:

1. **Cache by position-set hash via URL params.** Same approach as existing `api/og/signal.ts` — pass held-asset list as URL params (`?bullish=HYPE,BTC&bearish=`). Vercel's edge cache dedupes by URL automatically. Two users with the same held-asset intersection get the same cached PNG. Realistic position diversity should collapse 1000 users to 5–20 unique images per brief.
2. **No further optimization until traffic warrants it.** Ship the per-user version with URL-param caching, measure actual render volume, optimize if costs become real.

Do not pre-render templates per direction-state. Don't build a hybrid where the image is generic and personalization is caption-only — Henry rejected this approach because the chips already convey direction; the caption duplicating "Bullish for X" is redundant. The new model: image and caption both adapt to the user, image carries the visual hook, caption carries the explicit verdict.

## Implementation status

### ✅ Step 1 done — Vercel OG route

- File: `api/og/news.ts`
- GET `/api/og/news?bullish=HYPE,BTC&bearish=OIL&headline=...&velaRead=...&date=...`
- Auth via `OG_IMAGE_SECRET` Bearer header (same as `signal.ts`)
- Cache-Control: `public, max-age=3600, s-maxage=3600` — Vercel edge dedupes by URL
- Fallback monogram circle if icon unresolved
- Locally tested via `scripts/test-og-news-handler.mjs` (handler-level test, four cases)
- Type check passes

### ⏳ Step 2 — backend integration (next session)

1. **Add `"news"` type to `generateImageViaVercel()`** in `crypto-agent/supabase/functions/_shared/social-poster.ts`. Pattern matches existing `"signal"` GET form.
2. **Find the news-brief send path.** Likely `breaking-news` edge function → `broadcastMarketAlert` in `_shared/notify.ts`. The current flow does text-only Telegram broadcast; we replace with `sendPhoto` per-user.
3. **Per-user logic.** For each opted-in user:
   - Query held positions (likely from `positions` table, status open)
   - Intersect with news-cache tagged assets (`news_cache.ai_classification` — verify column shape against schema)
   - Build `bullishHeld[]` and `bearishHeld[]`
   - Build OG URL with those params (image cached by Vercel edge; users with same intersections share cached PNG)
   - Build caption with 📰 prefix, summary, `*Vela's read:*` line (or omit if no exposure)
   - Send via Telegram `sendPhoto` with `reply_markup` inline keyboard button
4. **Vela's read templates.** See "Vela's read templates" section above. Implement as a helper that takes the held arrays and returns the line (or `null` for no exposure).
5. **Schema verification before writing.** Query `news_cache.ai_classification` to confirm the bullish/bearish per-asset structure (per project rule "Query the schema before writing migrations or references").
6. **Permanence note.** Add a comment on the `news_cache` migration that the table is a permanent record (no auto-cleanup) — protects deep links from breaking later.
7. **Staging E2E.** Trigger a test brief send to admin chat, verify rendering + button + deep link.
8. **QA review** before commit per project rules.

## Throwaway test artifact

`scripts/test-news-brief-telegram.mjs` rendered both single-direction and mixed-direction cards locally and sent to admin Telegram. Used to validate the design before committing to integration. Can be deleted once the production path ships.

## Voice / brand rules referenced

- No em dashes (use colons, commas, periods)
- Plain English (no "tailwind" / "headwind")
- Bidirectional framing: green = bullish, red = bearish
- Always-watching pillar: "We're monitoring closely" reinforces, doesn't placate
