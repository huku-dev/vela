# Design System & Brand Identity Guide

> *Extracted from CLAUDE.md — see CLAUDE.md for project overview and engineering principles.*

---

## Visual Language: Neobrutalism

Vela uses a **neobrutalist design system** characterized by:
- Thick black borders (3px solid)
- High-contrast colors (cream backgrounds #FFFBF5, black text #0A0A0A)
- Bold typography (Instrument Sans for headings, Inter for body)
- No subtle shadows or gradients — everything is flat and bold

---

## Semantic Color Tokens (Three-Layer System)

**DO NOT hardcode colors.** Always use semantic tokens from `vela-design-system.css`:

**Layer 1: Primitives** (base palette)
```css
--green-primary: #00D084
--red-primary: #FF4757
--gray-primary: #EBEBEB
```

**Layer 2: Semantic Tokens** (intent-based)
```css
--color-signal-buy: var(--green-primary)
--color-signal-sell: var(--red-primary)
--color-signal-wait: var(--gray-primary)
```

**Layer 3: Component Usage**
```jsx
// CORRECT: Use semantic tokens
<div style={{ backgroundColor: 'var(--color-signal-buy)' }}>BUY</div>

// WRONG: Don't hardcode colors
<div style={{ backgroundColor: '#00D084' }}>BUY</div>
```

### Signal Status Color Mapping (CRITICAL)

Signal status colors have **semantic meaning** — misusing them breaks user trust:
- **Green = BUY** (bullish signals ONLY)
- **Red = SELL** (bearish signals ONLY)
- **Gray = WAIT** (neutral/no signal)

**Never** use green for anything except bullish signals.
**Never** use red for anything except bearish signals.

---

## Typography Standards

- **Headings:** Instrument Sans, 700 weight
- **Body:** Inter, 400 weight (500 for emphasis)
- **Signal Status Labels:** 700 weight, uppercase, 14px

---

## Dark Mode Support

All design tokens have dark mode variants using `prefers-color-scheme`:
```css
@media (prefers-color-scheme: dark) {
  --background-primary: #0A0A0A;
  --text-primary: #FFFBF5;
}
```

**Note:** V1 is light-only. Dark mode rules are commented out. ~10 components have hardcoded hex colors that would break if dark mode is re-enabled.

**Accessibility:** Vela targets **WCAG AA+ compliance** (7.8:1 contrast ratio minimum).

---

## Brand Voice Guidelines

Every user-facing string must align with one of the **Three Pillars**:

### 1. Always Watching
Emphasizes 24/7 monitoring, automation, proactive alerting.
- "Vela monitors Bitcoin 24/7 and flags key moments"
- "We're watching the market so you don't have to"
- AVOID: "Check back later for updates"

### 2. You Stay in Control
Emphasizes user agency, transparency, no auto-trading.
- "You approve every trade. Vela brings you the right moments."
- "Here's why we think this: [clear explanation]"
- AVOID: "Vela automatically executes when conditions are met"

### 3. Plain English, No Noise
Clear, jargon-free explanations that anyone can understand.
- "Price broke above $45,000, trend is up"
- "Strong buying pressure, momentum is building"
- AVOID: "EMA-9 crossed SMA-50 with bullish MACD divergence"

**When in doubt:** Ask yourself if your grandmother would understand the message. If not, simplify.

---

## Design System Adoption

**Problem:** Some pages use VelaComponents, others use raw MUI.
**Solution:** When editing a page, migrate MUI components to Vela equivalents.
**Check:** Run `grep -r "from '@mui'" src/` to find raw MUI usage.

---

## Design-First for Visual Assets

**Never generate visual assets (images, icons, banners, social graphics) programmatically as a first step.** Always start in Figma.

Programmatic generation (Pillow, Canvas, SVG scripts) produces "good enough" placeholders that linger. Figma-first ensures brand consistency from the start.

**Process:** Design in Figma -> export assets -> use in code. Only use programmatic generation for dynamic/templated content (e.g., trade cards with live data) where Figma templates can't cover it.

If Figma isn't available in the moment, explicitly mark the output as a **placeholder** and log a task to replace it with a proper Figma design.

---

## Key References

- **Full design system specs:** `VELA-BRAND-SYSTEM-V2.md`
- **Brand identity decisions (ADR-006):** `docs/brand-identity.md`
- **Design tokens CSS:** `src/styles/vela-design-system.css`
- **Reusable components:** `src/components/VelaComponents.tsx`
