# Vela — Project Context for Claude Code

> **Stack:** React 18 + TypeScript + Vite + Supabase + Vercel
> **Product:** Crypto market intelligence — 24/7 monitoring, actionable signals, plain English

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
npm run dev | build | preview | type-check | lint

# Tests
npm run test | test:watch | test:coverage

# Git (conventional commits, auto-deploys to Vercel on push)
git push origin main

# Backend deploy (details: docs/claude-reference/deploy-workflow.md)
cd /Users/henry/crypto-agent
./scripts/deploy.sh --staging
./scripts/deploy.sh --prod
./scripts/verify-deployment.sh --both

# Notion
vela-start | vela-end | vela-tasks list | vela-tasks add
```

---

## Context Loading — Read On Demand

Do NOT pre-load these files. Read ONLY when the task matches:

| When you are... | Read first |
|-----------------|------------|
| Editing CSS, components, or styling | `docs/claude-reference/design-system-guide.md` |
| Writing or modifying tests | `docs/claude-reference/testing-standards.md` |
| Handling API keys, env vars, or auth | `docs/claude-reference/security-checklist.md` |
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

---

**Remember:** Vela is about **trust**. Every design choice, every line of code, every user-facing message should reinforce that users are in control and getting accurate, honest information.
