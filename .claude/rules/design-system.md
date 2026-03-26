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
