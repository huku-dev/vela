# Project Context & Roadmap

> *Extracted from CLAUDE.md to reduce session context load. Read this when you need product context or roadmap information.*

---

## What is Vela?

Vela is a **crypto market intelligence platform** that monitors 24/7 and surfaces actionable trading signals for Bitcoin, Ethereum, and other major assets. It's designed for both experienced traders and crypto newcomers who want clear, Plain English analysis without the noise.

**Core Product Principles (The Three Pillars):**
1. **Always Watching** — Vela monitors markets 24/7 and flags key moments automatically
2. **You Stay in Control** — Users approve every decision; Vela never auto-trades
3. **Plain English, No Noise** — Clear explanations, no overwhelming jargon

**Current Status:** Pre-launch development. Building MVP with paper trading, signal dashboard, and daily market digest.

---

## Architecture Details

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

## Roadmap

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
