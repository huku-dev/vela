# Vela — Project Context for Claude Code

> **Last Updated:** March 2026
> **Project:** Vela Crypto Market Intelligence Platform
> **Stack:** React + TypeScript + Vite + Supabase + Vercel

---

## What is Vela?

Vela is a **crypto market intelligence platform** that monitors 24/7 and surfaces actionable trading signals for Bitcoin, Ethereum, and other major assets. It's designed for both experienced traders and crypto newcomers who want clear, Plain English analysis without the noise.

**Core Product Principles (The Three Pillars):**
1. **Always Watching** — Vela monitors markets 24/7 and flags key moments automatically
2. **You Stay in Control** — Users approve every decision; Vela never auto-trades
3. **Plain English, No Noise** — Clear explanations, no overwhelming jargon

**Current Status:** Pre-launch development. Building MVP with paper trading, signal dashboard, and daily market digest.

---

## Architecture Overview

### Tech Stack
- **Frontend:** React 18 + TypeScript + Vite
- **Styling:** Custom CSS (Vela Design System) + Material-UI components
- **Backend:** Supabase (PostgreSQL database + real-time subscriptions)
- **External APIs:** CoinGecko (prices), Fear & Greed Index (sentiment)
- **Deployment:** Vercel (main branch auto-deploys to production)
- **Version Control:** Git + GitHub

### Key Directories
```
crypto-agent-frontend/
├── src/
│   ├── components/        # React components (mix of custom + MUI)
│   │   └── VelaComponents.tsx  # Vela-branded reusable components
│   ├── pages/            # Page-level components (Home, AssetDetail, etc.)
│   ├── styles/           # CSS files
│   │   └── vela-design-system.css  # Design tokens (colors, spacing, typography)
│   ├── services/         # API clients (Supabase, CoinGecko)
│   └── types/            # TypeScript interfaces
├── scripts/              # Python automation scripts (Notion integration, session management)
├── public/               # Static assets
└── CLAUDE.md            # This file
```

### Database Schema (Supabase)
- **signals** table: Trading signals (asset, status, timestamp, indicators)
- **track_record** table: Paper trading history (entry price, exit price, P&L)
- **market_digest** table: Daily market summaries

---

## Engineering Preferences

These principles guide judgment calls when multiple valid approaches exist:

1. **Explicit over clever.** Code should be readable at a glance. No magic, no tricks. If someone reading the code has to pause and think "wait, how does this work?", it's too clever.
2. **Minimal diff.** Achieve the goal with the fewest new abstractions and files touched. Adding a parameter to an existing function beats creating a new one.
3. **DRY, but not premature abstraction.** Don't extract a shared abstraction until you see the same pattern three times.
4. **Thoughtfulness over speed on edge cases.** Especially for financial data, P&L, and signal logic. Ask "what happens when this is null / zero / negative / stale?"
5. **Too many tests rather than too few.** When in doubt about whether something needs a test, write the test.
6. **Diagrams for non-trivial flows.** Use ASCII diagrams in plan files and code comments. **Stale diagrams are worse than no diagrams** — if you touch code with an inline diagram, update it in the same commit.
7. **Balanced engineering.** "Would I be embarrassed showing this to a senior engineer?" catches under-engineering. "Would a new contributor understand this in 10 minutes?" catches over-engineering.

---

## Core Coding Standards

- **TypeScript:** Explicit types always. No `any` unless absolutely necessary. Interfaces in `src/types/`.
- **Components:** Use VelaComponents.tsx over raw MUI. Structure: Imports -> Props interface -> Component.
- **Error boundaries:** Required on all data-dependent pages.
- **Data fetching:** Always show loading states, handle errors gracefully, show stale data warnings (>5 min).
- **Naming:** PascalCase components, camelCase utils, kebab-case CSS, snake_case DB tables.

---

## Critical Rules — NEVER VIOLATE

These 15 rules have caused production incidents or major regressions when forgotten:

1. **Never hardcode colors** — use semantic tokens from `vela-design-system.css`
2. **Signal colors are semantic:** Green=BUY, Red=SELL, Gray=WAIT — never misuse
3. **Never hardcode API keys** — env vars only, never commit `.env.local`
4. **New env vars: same commit must update** `.env.example` + `DEPLOY.md` + set staging/prod values
5. **Critical env vars MUST fail loud** — never `?? "testnet"` or any silent default
6. **Post-push CI:** never mark task done until CI green
7. **Post-ship:** update MEMORY.md + CLAUDE.md immediately after shipping (routing rules + line budgets in `docs/claude-reference/documentation-maintenance.md` — main files must stay ≤200 lines)
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
npm run dev | build | preview | type-check | lint

# Tests
npm run test | test:watch | test:coverage

# Notion
vela-start | vela-end | vela-tasks list | vela-tasks add

# Git (conventional commits, post-commit hook logs to Notion)
git push origin main  # Auto-deploys to Vercel

# Backend deploy (full pipeline in docs/claude-reference/deploy-workflow.md)
cd /Users/henry/crypto-agent
./scripts/deploy.sh --staging    # Migrations + functions
./scripts/deploy.sh --prod       # After staging verified
./scripts/verify-deployment.sh --both
```

---

## Project Goals & Roadmap

### Current Phase: MVP Development
**Goal:** Launch a functional paper trading dashboard that demonstrates Vela's value.

**In Progress:**
- Signal dashboard, asset detail pages, track record, daily digest (all done)
- Real-time notifications (Telegram) — in progress
- Customizable signal parameters UI — in progress

### Future Phases
- Production launch (Sentry, performance monitoring, user feedback)
- Real money integration, multi-asset support, mobile app

---

## Plan Mode Protocol

### Scope Challenge First (4 questions before any plan)
1. **What already exists?** Search for code that solves sub-problems. List it.
2. **What is the minimum viable change?** Flag anything deferrable -> "NOT in scope."
3. **Complexity smell:** >8 files or >2 new modules? Flag and justify.
4. **Who is this for?** Which ICP does this serve? (see `docs/ICPs.md`). If it only serves one, is that the right priority? If it serves none, question whether it belongs in the roadmap.

### Web Research Nudge
When planning involves unfamiliar territory (new APIs, integrations, libraries, or patterns not already in the codebase), prompt for web research: "Research best practices and known issues for [topic] using web search." Skip for routine changes to well-understood parts of the codebase.

### Review Phases (for big changes)
Architecture -> Code Quality -> Tests -> Performance. Pause for user feedback between each.

### When to Ask for Review
Before merging code that affects: P&L calculations, signal status logic, API key handling, design system breaking changes, database schema migrations.

---

## Reference Documentation

Detailed procedures extracted into reference docs (Claude reads on-demand when relevant):

| Document | Contents |
|----------|----------|
| `docs/claude-reference/design-system-guide.md` | Tokens, brand voice, typography, a11y, neobrutalism |
| `docs/claude-reference/testing-standards.md` | Test priorities, adversarial protocol, commands |
| `docs/claude-reference/security-checklist.md` | API keys, env var safety, RLS rules |
| `docs/claude-reference/deploy-workflow.md` | deploy.sh, CI verification, Notion commands |
| `docs/claude-reference/qa-checklist.md` | Smoke test, pre-launch checklist, perf targets |
| `docs/claude-reference/session-routines.md` | Start/end routines, retro format, ADRs, deferred work |
| `docs/claude-reference/documentation-maintenance.md` | CLAUDE.md/MEMORY.md update procedures, routing rules, topic file lifecycle, line budgets |

Existing project docs:
- `VELA-BRAND-SYSTEM-V2.md` — Full design system implementation specs
- `docs/brand-identity.md` — Logo/color decisions (ADR-006)
- `docs/threat-reports/TEMPLATE.md` — Adversarial test threat report format

---

**Remember:** Vela is about **trust**. Every design choice, every line of code, every user-facing message should reinforce that users are in control and getting accurate, honest information. When in doubt, prioritize transparency and clarity over cleverness.
