---
paths:
  - "src/components/**"
  - "src/pages/**"
  - "src/styles/**"
  - "src/App.tsx"
---

# Design System Rules

**Full reference:** `docs/claude-reference/design-system-guide.md`

## Color Tokens (NEVER hardcode)
- Use semantic tokens from `vela-design-system.css` — never hex values in components
- Signal colors are semantic: Green=BUY (`--color-signal-buy`), Red=SELL (`--color-signal-sell`), Gray=WAIT (`--color-signal-wait`)
- Never use green for anything except bullish signals. Never use red for anything except bearish.

## Components
- Use `VelaComponents.tsx` over raw MUI. When editing a page, migrate MUI components to Vela equivalents.
- Structure: Imports -> Props interface -> Component
- Error boundaries required on all data-dependent pages

## Typography
- Headings: Instrument Sans 700. Body: Inter 400 (500 for emphasis).

## Brand Voice (Three Pillars)
1. **Always Watching** — 24/7 monitoring. Never "check back later."
2. **You Stay in Control** — User approves everything. Never imply auto-trading.
3. **Plain English** — No jargon (EMA, RSI, MACD). If grandma wouldn't understand, simplify.

## Bidirectional Framing
- SELL/RED = "going short" (active opportunity), NOT "stepping aside"
- GREEN/BUY = "going long". WAIT = direction-neutral.
- Never assume default position is long.

## Copy Style
- No em dashes. Use commas, periods, or colons instead.
- Middle dot `·` (U+00B7) is the standard separator.
- Dollar P&L: always "+$54 profit" / "-$12 loss". On social/public: percentage-only.
- Capitalize first letter of AI-generated bullet points.
- **Display-time capitalization for stored-lowercase data**. Catalyst categories (`flows`, `leadership`, `geopolitical`) are stored lowercase in `news_cache.ai_classification.catalysts` because they're enum values for the classifier. Capitalize on render. Pattern: a small `capitalize(s)` helper at the bottom of the component file. Don't mutate the column or the upstream data.

## Wireframe fidelity (mandatory before claiming UI work done)

When implementing from approved wireframes:

1. **Read the wireframe's actual CSS first.** Computed styles, hover states, transitions, CSS variable values. Don't approximate from screenshots — they miss interactions, exact padding, shadow offsets.
2. **Render every variant in the actual browser preview.** A spec with N variants needs all N rendered. "I tested V1 and trust V2-N work because they share CSS classes" is pattern matching, not verification, and misses bugs that only fire when data triggers a specific branch.
3. **At the production-target viewport.** Vela is mobile-first: always `preview_resize` to mobile (375x812) and screenshot. Desktop is secondary.
4. **With realistic data covering each variant.** If dev mocks only cover one branch, build a temporary render harness with hardcoded mock state for each variant. Without state coverage, half the variants render empty/fallback states that hide whether the real-data path matches.
5. **Side-by-side comparison, not from memory.** When comparing impl to wireframe, the wireframe HTML must be open beside the impl screenshot. Memory blurs values; explicit comparison catches `--mint-50` vs `--lavender-50`, `inline-flex` vs `flex`, missing `margin-left: auto`, `border:none` wiping a `borderTop`, etc.
6. **The wireframe IS the spec.** Match it pixel-for-pixel. If you think something should be different, flag it as a suggestion, don't just implement your version. Caveat: wireframes occasionally have arithmetic errors (e.g. asset-detail-v2 V2b says "1.2% below current price" with a stop > current). Trust impl logic over wireframe text when they contradict; flag the wireframe as the bug.

User feedback patterns:
- "go back to the wireframe and look at it properly" → you skipped step 1
- "this is quite sloppy stuff" → you skipped 2-5 and shipped without systematic verification
- "I want to also see all scenarios from the wireframes tested in preview" → step 2 wasn't done; build a harness, screenshot every variant, then revert before commit

## Render harness anti-pattern

When building a dev-only harness to verify variants (good practice), the *surrounding* sections of the page (engagement footer, "why we think this" disclosure, asset header) must use the REAL production components, not placeholder mocks. Mocks invite confusion when the user reviews the harness — they read placeholder padding/styling as a regression in the real app.

If the harness must wrap the components in a full page layout, render the actual production component. If you can't (because it depends on hooks that aren't available in the harness context), don't render a placeholder — render nothing.

## Loading vs fetched-and-empty (distinct states)

When fetching data for a page, distinguish three states explicitly:
- `!fetched` → page-loading view (`<VelaLogo variant="mark" size={48} pulse />` + "Loading X…" — matches the existing app pattern)
- `fetched && data === null` → terminal not-found view (with back button)
- `fetched && data !== null` → render the page

A single `data: T | null` doesn't distinguish loading from empty. Add a separate `[fetched, setFetched] = useState(false)` boolean (or rename for clarity: `loaded`, `metaLoaded`, etc.) that flips true after the query *settles*, regardless of whether it returned data. Without this, the page sits on "Loading…" forever when the row genuinely doesn't exist.

## Inline-style CSS gotcha: `border: none` wipes earlier `borderTop`

Avoid this pattern in inline styles:
```tsx
<button style={{ borderTop: '1px solid var(--gray-200)', border: 'none', /* ... */ }} />
```
The later `border: none` is the shorthand and silently wipes `borderTop`. The button renders without the divider you specified.

Fix: own the divider on a wrapper div, not the interactive element:
```tsx
<div style={{ borderTop: '1px solid var(--gray-200)', paddingTop: 'var(--space-3)' }}>
  <button style={{ border: 'none', /* ... */ }}>...</button>
</div>
```

## Helper chains with empty-string fallbacks

`?? ` does NOT coerce empty string to null. `||` does. When chaining helper fallbacks where one helper returns `""` for unknown inputs (e.g. `getCoinIcon('')` returns `""`), use `||` and a trailing `|| null`:
```tsx
const iconUrl =
  asset?.icon_url ||
  (asset?.coingecko_id ? getCoinIcon(asset.coingecko_id) : null) ||
  null;
```
Without the trailing `|| null`, an empty string propagates and `<img src="">` fires a request for the page URL itself.

## Dollar formatting (cross-reference financial-code.md)

Use `toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })` for P&L hero values, position size, entry/current price strings. Output: "$2,830", "$7.50", "$1,750.45". Comma separator is required; trailing zeros drop on round amounts. NEVER use `.toFixed(2)` directly on dollar values — produces "$1750.00" without commas.
