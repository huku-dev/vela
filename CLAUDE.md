# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Stack:** React 18 + TypeScript + Vite + Supabase + Vercel
> **Product:** Market intelligence — 24/7 monitoring, actionable signals, plain English. Covers crypto, equities, commodities, forex, and more. Not a crypto-only product.

---

## Engineering Preferences

1. **Explicit over clever.** Readable at a glance. No magic.
2. **Minimal diff.** Fewest new abstractions and files touched.
3. **DRY, but not premature abstraction.** Wait for 3 occurrences.
4. **Thoughtfulness on edge cases.** Especially financial data. Ask "what if null / zero / negative / stale?"
5. **Too many tests rather than too few.**
6. **Diagrams for non-trivial flows.** Stale diagrams are worse than none — update in same commit.
7. **Balanced engineering.** Not embarrassing to seniors, understandable to new contributors.

---

## Core Coding Standards

- **TypeScript:** Explicit types always. No `any`. Interfaces in `src/types/`.
- **Components:** Use VelaComponents.tsx over raw MUI. Structure: Imports -> Props -> Component.
- **Error boundaries:** Required on all data-dependent pages.
- **Data fetching:** Loading states, error handling, stale data warnings (>5 min).
- **Naming:** PascalCase components, camelCase utils, kebab-case CSS, snake_case DB tables.
- **Asset IDs:** Lowercase symbol strings (`btc`, `eth`), never UUIDs. Routes: `/asset/btc`.

---

## Critical Rules — NEVER VIOLATE

1. **Never hardcode colors** — use semantic tokens from `vela-design-system.css`
2. **Signal colors are semantic:** Green=BUY, Red=SELL, Gray=WAIT — never misuse
3. **Never hardcode API keys** — env vars only, never commit `.env.local`
4. **New env vars: same commit must update** `.env.example` + `DEPLOY.md` + set staging/prod values
5. **Critical env vars MUST fail loud** — never `?? "testnet"` or any silent default
6. **Post-push CI:** never mark task done until CI green
7. **Post-ship:** update MEMORY.md + CLAUDE.md (routing rules in `docs/claude-reference/documentation-maintenance.md`)
8. **Session retro is MANDATORY and FULL** (6 sections, never abbreviated)
9. **Adversarial tests required** for financial/trading features (`FEATURE-ADV:` prefix)
10. **Design-first for visual assets** — Figma, not programmatic
11. **Notification audience check:** always ask "user, admin, or both?"
12. **Supabase subscriptions:** always unsubscribe in useEffect cleanup
13. **All timestamps UTC in DB,** convert to local for display, always show timezone
14. **Backend deploy via deploy.sh only** (`--staging` or `--prod`, never bare)
15. **Deferred work needs** What/Why/Context/Blocked-by (no phantom tasks)

---

## Common Commands

```bash
# Development
npm run dev          # start Vite dev server
npm run build        # production build
npm run preview      # serve built output locally
npm run type-check   # tsc --noEmit
npm run lint         # ESLint, max-warnings 0
npm run format       # Prettier write

# Tests
npm run test                                      # run all tests (Vitest)
npm run test:watch                                # watch mode
npm run test:coverage                             # v8 coverage report
npm run test -- src/pages/Home.test.tsx           # single test file
npm run test -- -t "pattern"                      # tests matching name

# Git (conventional commits; push to main auto-deploys to Vercel)
git push origin main

# Backend deploy (details: docs/claude-reference/deploy-workflow.md)
cd /Users/henry/crypto-agent
./scripts/deploy.sh --staging
./scripts/deploy.sh --prod
./scripts/verify-deployment.sh --both

# Notion
vela-start | vela-end | vela-tasks list | vela-tasks add
```

Set `VITE_DEV_BYPASS_AUTH=true` in `.env.local` to skip Privy auth for local UI testing. Trading actions won't work (no real JWT), but all read-only pages are fully exercisable. To test the onboarding flow under bypass, run `localStorage.setItem('vela_onboarded', 'false')` in devtools and refresh.

---

## Architecture

### Bundle split

`App.tsx` routes to two code-split paths: public routes (`/terms`, `/privacy`) load without Privy; everything else goes through `AuthShell.tsx`, which lazy-loads `PrivyProvider`. Main chunk stays ~100 KB gzipped; Privy SDK (~300 KB) is deferred until an auth route is visited.

`AuthShell` applies two guards: `DeactivationGate` (intercepts users with `deactivated_at` set) and `OnboardingGate` (redirects un-onboarded users to `/welcome`, with a narrow carve-out for `/?checkout=success`).

### Auth flow

Privy login triggers a POST to the `auth-exchange` edge function (Bearer: Privy token). It returns a Supabase JWT (1h TTL), cached in `tokenCacheRef` with a 5-min buffer. Concurrent `exchangeToken` calls deduplicate via an `inflightRef` promise lock to prevent thundering herd.

Two Supabase clients: `supabase` (public anon, `src/lib/supabase.ts`) for unauthenticated reads (assets, signals, briefs), and `supabaseClient` from `useAuthContext()` for RLS-protected user data (proposals, positions, wallet). Under dev bypass, `supabaseClient` is the anon client — RLS tables return zero rows silently.

### Data hooks (`src/hooks/useData.ts`)

`useDashboard` fetches assets, signals, briefs, and digest in parallel. Data is cached at **module level** (not React state) so it persists across navigations and is seeded immediately on mount. Auto-refreshes every 15 minutes. `useAssetDetail` hydrates instantly from the module cache, then re-fetches fresh data.

Prices use Hyperliquid mid-prices as primary (toggle via `VITE_PRICE_PRIMARY=coingecko`). CoinGecko is fallback. Non-crypto assets (equities, commodities) use the builder-perp API (`metaAndAssetCtxs?dex=...`).

### Tier gating

`useSubscription` fetches from the edge function, caches in localStorage (`vela_subscription_cache`) to prevent free-tier flash on navigation. `useTierAccess` wraps it and exposes `partitionAssets` / `canAccessAsset` / `startCheckout` / `openPortal`. `0 = unlimited` for `max_active_positions`, `max_position_size_usd`, `max_assets`. `sizing_slots` is always a positive int (never 0).

Asset display order is defined in `ASSET_DISPLAY_ORDER` inside `useData.ts` (frontend-only, no DB column). `partitionAssets` slices the sorted list — free users get position 0 (BTC), Standard gets positions 0–7.

### OG image generation (`api/og/`)

Vercel serverless functions (Node.js) use `satori` + `sharp` to render social cards. Shared utilities in `api/og/_shared.ts` handle font loading (cached across invocations), brand color constants, and the SVG→PNG pipeline. Rules: PNG data URIs only (Gmail strips SVG), dimensions via inline styles, `html(string)` not tagged template for string interpolation.

---

## Context Loading

### Auto-loaded via `.claude/rules/` (path-scoped, no action needed)

| Rule file | Activates on | Deep-dive reference |
|-----------|-------------|---------------------|
| `rules/design-system.md` | `src/components/`, `src/pages/`, `src/styles/` | `docs/claude-reference/design-system-guide.md` |
| `rules/testing.md` | `*.test.*`, `*.spec.*` | `docs/claude-reference/testing-standards.md` |
| `rules/security.md` | `.env*`, `src/lib/supabase*`, `src/lib/auth*` | `docs/claude-reference/security-checklist.md` |
| `rules/financial-code.md` | `*trade*`, `*proposal*`, `*position*`, `*pnl*` | N/A (standalone) |

### Read on demand (workflow-triggered, not path-scoped)

| When you are... | Read first |
|-----------------|------------|
| Deploying or running CI | `docs/claude-reference/deploy-workflow.md` |
| QA testing or pre-launch checks | `docs/claude-reference/qa-checklist.md` |
| Starting or ending a session | `docs/claude-reference/session-routines.md` |
| Editing CLAUDE.md or MEMORY.md | `docs/claude-reference/documentation-maintenance.md` |
| Touching brand, logos, or design specs | `VELA-BRAND-SYSTEM-V2.md` + `docs/brand-identity.md` |
| Working on Hyperliquid, trading, or backend | `memory/backend-patterns.md` |
| Working on signal engine or briefs | MEMORY.md Signal Engine Architecture section |
| Working on social posting or content | `memory/social-media-playbook.md` |
| Working on subscriptions or emails | `memory/subscription-emails.md` |
| Needing product context, roadmap, or plan mode | `docs/claude-reference/project-context.md` |
| Planning a non-trivial implementation | `docs/claude-reference/project-context.md` (Plan Mode Protocol) |
| Writing adversarial threat reports | `docs/threat-reports/TEMPLATE.md` |
| Auditing components or design tokens, or adding a dev tool | `docs/claude-reference/dev-tools.md` |

---

**Remember:** Vela is about **trust**. Every design choice, every line of code, every user-facing message should reinforce that users are in control and getting accurate, honest information.
<!-- ROUTING-VERIFIED: 163 lines -->
