---
name: vela-frontend-qa
description: Frontend QA standards for Vela UI components — design tokens, accessibility, data display, and pre-commit checks. Use when editing React components, pages, styles, or UI code.
---

# Vela Frontend QA

Apply these standards when creating or modifying any React component, page, style, or UI element in the Vela codebase.

## Design Token Rules

**Never hardcode colors.** Always use semantic tokens from `src/styles/vela-design-system.css`.

Three-layer system:
1. **Primitives:** `--green-primary`, `--red-primary`, `--gray-primary`
2. **Semantic tokens:** `--color-signal-buy`, `--color-signal-sell`, `--color-signal-wait`
3. **Component usage:** Reference semantic tokens in JSX/CSS

```jsx
// CORRECT
<div style={{ backgroundColor: 'var(--color-signal-buy)' }}>BUY</div>

// WRONG — never hardcode
<div style={{ backgroundColor: '#00D084' }}>BUY</div>
```

### Signal Color Semantics (CRITICAL)
- **Green = BUY only** (bullish signals)
- **Red = SELL only** (bearish signals)
- **Gray = WAIT only** (neutral)

Never use signal colors for non-signal purposes.

### Brand Colors
- **Signal Green:** `#0FE68C` (CSS: `--vela-signal-green`)
- **Ink:** `#0A0A0A` (CSS: `--vela-ink`)
- **Cream:** `#FFFBF5` (CSS: `--vela-cream`)

## Typography

- **Headings:** Instrument Sans, 700 weight
- **Body:** Inter, 400 weight (500 for emphasis)
- **Signal labels:** 700 weight, uppercase, 14px

## Component Requirements

1. **Use VelaComponents.tsx** over raw MUI (`<VelaButton>` not `<Button>`, `<SignalCard>`, `<Badge>`)
2. When editing a page with raw MUI, migrate to Vela equivalents
3. **File structure:** Imports -> Props interface -> Component
4. **Props:** Always define a TypeScript interface (no inline types, no `any`)

```typescript
interface SignalCardProps {
  signal: Signal;
  onClick?: () => void;
}

export const SignalCard: React.FC<SignalCardProps> = ({ signal, onClick }) => {
  // ...
};
```

## Error Boundaries

All data-dependent pages MUST have error boundaries:
```jsx
<ErrorBoundary fallback={<ErrorFallbackUI />}>
  <AssetDetail />
</ErrorBoundary>
```

## Data Display Rules

### Loading States
- Always show loading state while fetching data
- Show spinner after 300ms (don't flash for fast loads)

### Error States
- Always handle errors gracefully with user-friendly messages
- Never show raw error objects or stack traces

### Stale Data Warnings
- Show stale data indicator if price data is >5 minutes old
- Use `isStale(lastUpdated)` pattern

### P&L Format
- Always say "profit" / "loss": `"+$54 profit"`, `"-$12 loss"`
- Never bare dollar amounts

### Separators
- Use middle dot `·` (U+00B7), not bullet `·` (U+2022)

### Timestamps
- All timestamps UTC in database
- Convert to user's local time for display
- Always show timezone: "Last updated: 2:34 PM PST"

## Accessibility (WCAG AA+)

- **Contrast:** 7.8:1 minimum ratio
- **ARIA labels:** On all interactive elements (SignalCard, LockedSignalCard, buttons)
- **Keyboard navigation:** All workflows must be keyboard-accessible
- **Focus states:** `focus-visible` on buttons, cards, selects
- **Skip navigation:** Skip nav link + main landmark present
- **Not color-only:** Use icons + text alongside color signals

## Brand Voice (for user-facing strings)

**Grandmother test:** If your grandmother wouldn't understand it, simplify.

- Lead with plain English, not jargon
- "Price broke above $45,000, trend is up" (not "EMA-9 crossed SMA-50")
- "Strong buying pressure" (not "RSI divergence")
- Always capitalize first letter of AI-generated bullet points

## Pre-Commit Verification

Before committing UI changes, verify:
1. [ ] No hardcoded colors — all use semantic tokens
2. [ ] Signal colors used correctly (green=BUY, red=SELL, gray=WAIT)
3. [ ] Loading states present for async operations
4. [ ] Error handling for all data fetches
5. [ ] ARIA labels on interactive elements
6. [ ] VelaComponents used (not raw MUI where Vela equivalent exists)
7. [ ] Stale data warning on price displays
