# Dev tools

Two interactive in-repo tools live in `src/dev-tools/` and ship as separate Vite entries (registered in `vite.config.ts`). Run via `pnpm dev`, then visit `/src/dev-tools/<name>.html`. Build outputs land in `dist/src/dev-tools/`.

## Tools

### `component-matrix.tsx` (#06 — component variants)

Renders `MergedSignalCard` and `VelaComponents` primitives in every documented variant on one page. Open before shipping any component change to catch missed states (loading, empty, single, many, error, partial, locked, disabled).

Coverage scope today: `MergedSignalCard` plus the VelaComponents primitive set. Not yet covered: `PositionCard`, `NewsDetail`, `EngagementFooter`, `SharePreviewSheet` (these don't exist at audited paths yet, or are at different paths). Extend coverage when those components land.

### `design-system.tsx` (#05 — living design system)

Every CSS token from `src/styles/vela-design-system.css` grouped by the brand-doc-canonical 19 categories from `VELA-BRAND-SYSTEM-V2.md`, with per-token usage notes. Includes: Brand identity, Surface, Text, Border, Action and brand buttons, Signal direction (RESERVED), Status chips and banners, Functional state, Data viz, Color primitives, Composite type tokens, Type primitives, Spacing, Border widths, Radius, Elevation, Motion, Z-index, Privy modal bridge.

`Signal direction` swatches show a red "Semantically reserved" badge enforcing the rule: never reuse signal-green for non-signal UI.

Light + dark theme toggle flips `data-theme` on `<body>`.

## Adding a new dev tool

Drop a `<name>.tsx` + `<name>.html` pair in `src/dev-tools/`, register the entry in `vite.config.ts` `rollupOptions.input`, and verify with:

```
pnpm build
```

Both new files ship to `dist/src/dev-tools/` automatically.

## Conventions

- **No external dependencies.** System fonts only. Don't add `<link>` tags for Google Fonts or any other CDN.
- **All colors via `var(--token)`.** No hardcoded hex / rgb. The design system snapshot exists specifically to make hardcoded colors visible.
- **No em dashes** in any UI string. Vela voice rule.
- **Action-verb buttons.** "Switch to dark", "Reset edits", "Copy CSS" — not "Click here" or "Click to copy".

## Pattern source

Both tools lift from Thariq Shihipar's HTML effectiveness gallery (`thariqs.github.io/html-effectiveness`). #05 (Living design system) and #06 (Component variants).
