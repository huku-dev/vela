# Vela Brand Identity System

> **Version:** 1.0 · **Last Updated:** 2026-02-28
> **Status:** ✅ Implemented

---

## Design Decisions & Rationale

### ADR-006: Brand Identity Redesign

**Context:** The original Vela logo (a stylized V/sail shape) and wordmark (capitalized "Vela" in the body font) were generic, communicating nothing distinctive about the brand. Feedback: "If 'lack of effort' could be personified in a brand identity, it would be this." The brand needed an ownable, memorable identity aligned with Vela's core proposition — always watching the markets.

**Research:** Studied best-in-class identities across fintech and dev tools: Stripe (gradient "S"), Linear (angular marks), Figma (overlapping circles), Vercel (triangle), Raycast (crosshair), Robinhood (feather/arrow), Mercury (winged M), Arc Browser (gradient arc). Key findings:
- Geometric primitives > illustrations
- Hidden dual readings increase memorability (Robinhood feather = arrow)
- One ownable accent color is essential (Stripe "blurple", Robinhood neon green)
- Lowercase wordmarks dominate modern tech brands
- One signature detail in the wordmark is enough — the mark carries personality

**Decision:** Angular eye logomark + bold lowercase wordmark, monochrome-first design.

---

## Brand Elements

### Logomark: Angular Eye

A sharp, geometric eye shape formed by a pointed almond (four straight edges, miter joins) with a rotated diamond iris filled in Signal Green. Evokes watchfulness — "always watching the markets."

**SVG structure (canonical):**
```svg
<!-- Outer eye — 4-point angular almond -->
<polygon
  points="-55,0 0,-28 55,0 0,28"
  stroke="#0A0A0A"
  stroke-width="5"
  fill="none"
  stroke-linejoin="miter"
/>
<!-- Inner iris — rotated diamond, pure green fill -->
<rect
  x="-9" y="-9"
  width="18" height="18"
  rx="2"
  transform="rotate(45)"
  fill="#0FE68C"
/>
```

**Stroke weight note:** The stroke-width was increased from 3.5 → 5 (in SVG viewBox units) to ensure the eye shape reads clearly at typical rendered sizes (32–52px wide). At the original 3.5, the strokes rendered as ~1px and appeared too light/thin in navigation bars and headers.

**Proportions:** 2:1 ratio (width:height). The outer eye points form a ~30° angle at the horizontal axis.

**Monochrome variant:** Remove `fill="#0FE68C"` from iris, add `stroke="#0A0A0A" stroke-width="2.5"` — works in single-color contexts (fax, embossing, stamps).

### Wordmark

Lowercase **"vela"** set in Space Grotesk, weight 800 (ExtraBold).
- Letter-spacing: -0.03em
- No custom letterforms or modifications — the mark carries the identity personality
- Always lowercase, never capitalized

### Lockup

Mark + wordmark sit side by side:
- Gap: 0.25× mark size
- Mark height = wordmark cap height (optical alignment)
- Mark always to the left of wordmark

### Favicon / App Icon

Angular eye mark on a dark (#0A0A0A) rounded-square background with cream (#FFFBF5) strokes. Green diamond iris. Ensures contrast on both light and dark browser UI.

---

## Color System

| Token | Hex | Usage |
|-------|-----|-------|
| Signal Green | `#0FE68C` | Brand accent, logomark iris, positive states, CTA highlights |
| Ink | `#0A0A0A` | Primary dark, text, logomark strokes (light mode) |
| Cream | `#FFFBF5` | Primary light, page backgrounds, logomark strokes (dark mode) |

**Why #0FE68C?** Warmer than the original Tailwind green-500 (#22C55E). More distinctive, ownable, and energetic. Tested across light/dark contexts for sufficient contrast.

**CSS custom properties:**
```css
--vela-signal-green: #0FE68C;
--vela-ink: #0A0A0A;
--vela-cream: #FFFBF5;
```

---

## 30° System Angle

The brand uses a consistent 30° angle throughout:
- The outer eye shape's diagonal edges
- Implied rotation of the diamond iris
- Can be applied to decorative elements, section dividers, accent strokes

This creates visual coherence without being heavy-handed.

---

## Signal Pulse Animation

Expanding diamond rings that radiate from the logomark iris. Used for:
- New signal detected
- Trade proposal ready
- Position alert / notification

**Implementation:** CSS `@keyframes vela-pulse-ring` in `vela-design-system.css`.
- Two concentric rings expanding from the iris center
- Staggered 0.5s delay between rings
- 1.8s duration, ease-out curve, infinite loop
- Uses `::before` and `::after` pseudo-elements
- Respects `prefers-reduced-motion` (animation disabled)

**Usage:**
```html
<div class="vela-signal-pulse vela-signal-pulse--active">
  <VelaLogo variant="mark" />
</div>
```

Add `--active` class to trigger, remove to stop.

---

## Directions Explored & Rejected

### Direction 1: False Cross Diamond ❌
Based on the Vela constellation's False Cross asterism — four stars forming a diamond. Rejected: too basic, constellation reference too technical/niche, users wouldn't connect the dots (literally).

### Direction 2: Abstract Sail ❌
Asymmetric quadrilateral evoking a sail (vela = sail in Latin). Rejected: too abstract in isolation, hard to own, too close to generic shapes. 2D interpretation somewhat interesting but not distinctive enough.

### Direction 3A: Radar Sweep ❌
Full radar display with ring, crosshairs, and sweep beam. Rejected: too literal, "radar" is overplayed in fintech/monitoring products.

### Direction 3B: Smooth Eye ❌
Two curved arcs forming a smooth almond eye with circular iris. Rejected: too obviously an eye, "creepy surveillance" connotation, not distinctive.

### Direction 3C: Angular Eye ✅ (Selected)
Sharp-cornered eye with straight edges, miter joins, diamond iris. Why it won: distinctive silhouette, geometric (not organic), the shape variation between outer and inner enhances memorability, green diamond iris has clear "signal detected" meaning.

### Custom Drawn Wordmarks ❌
Multiple custom letterform approaches explored (rising crossbar ligature, shared e/l stem, green v-stroke). All rejected: "too thin, too playful," user preferred the bold weight of Space Grotesk from exploration sheets. Decision: let the mark do the talking, keep the wordmark clean and bold.

### Wordmark Modifications ❌
Tested: green diamond dot above 'a', green accent on 'v' stroke, other detail additions. All rejected in favor of no modification — simpler is stronger when the mark already carries the identity.

---

## Files Modified

| File | Repo | Change |
|------|------|--------|
| `src/components/VelaLogo.tsx` | crypto-agent-frontend | New angular eye mark + lowercase wordmark |
| `public/favicon.svg` | crypto-agent-frontend | Angular eye on dark background |
| `public/favicon.svg` | vela-marketing | Same favicon |
| `src/components/Nav.astro` | vela-marketing | New logomark + "vela" wordmark |
| `src/components/Footer.astro` | vela-marketing | New logomark (cream strokes for dark bg) |
| `public/og-image.svg` | vela-marketing | Rebuilt with new identity |
| `src/styles/vela-design-system.css` | crypto-agent-frontend | Signal Green tokens + pulse animation |
| `src/styles/global.css` | vela-marketing | Signal Green tokens |

---

## Future Evolution

- **Wordmark customization:** The clean Space Grotesk 800 base can evolve with a subtle custom detail once the mark is established. Don't rush this.
- **Signal pulse in product:** Apply to notification badges, trade proposal arrival, signal card headers.
- **Animation on marketing site:** Hero section could feature the mark with pulse on scroll-into-view.
- **Brand color expansion:** Signal Green is the primary accent. Secondary colors (if needed) should complement, not compete.
