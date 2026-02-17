# Vela — Project Context for Claude Code

> **Last Updated:** February 2026
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
- **External APIs:**
  - CoinGecko API for live price data
  - Fear & Greed Index API for market sentiment
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
- **signals** table: Stores trading signals (asset, status, timestamp, indicators)
- **track_record** table: Paper trading history (entry price, exit price, P&L)
- **market_digest** table: Daily market summaries

---

## Design System & Brand Identity

### Visual Language: Neobrutalism
Vela uses a **neobrutalist design system** characterized by:
- Thick black borders (3px solid)
- High-contrast colors (cream backgrounds #FFFBF5, black text #0A0A0A)
- Bold typography (Instrument Sans for headings, Inter for body)
- No subtle shadows or gradients — everything is flat and bold

### Semantic Color Tokens (Three-Layer System)
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
// ✅ CORRECT: Use semantic tokens
<div style={{ backgroundColor: 'var(--color-signal-buy)' }}>BUY</div>

// ❌ WRONG: Don't hardcode colors
<div style={{ backgroundColor: '#00D084' }}>BUY</div>
```

### Typography Standards
- **Headings:** Instrument Sans, 700 weight
- **Body:** Inter, 400 weight (500 for emphasis)
- **Signal Status Labels:** 700 weight, uppercase, 14px

### Dark Mode Support
All design tokens have dark mode variants using `prefers-color-scheme`:
```css
@media (prefers-color-scheme: dark) {
  --background-primary: #0A0A0A;
  --text-primary: #FFFBF5;
}
```

**Accessibility:** Vela targets **WCAG AA+ compliance** (7.8:1 contrast ratio minimum).

---

## Coding Standards & Conventions

### TypeScript
- **Always use explicit types.** No `any` unless absolutely necessary.
- Define interfaces in `src/types/` for shared data structures:
  ```typescript
  // src/types/Signal.ts
  export interface Signal {
    id: string;
    asset: string;
    status: 'BUY' | 'SELL' | 'WAIT';
    timestamp: string;
    indicators: {
      ema9: number;
      rsi14: number;
      adx4h: number;
    };
  }
  ```

### Component Standards
1. **Use VelaComponents.tsx whenever possible** instead of raw MUI
   - `<VelaButton>` instead of `<Button>`
   - `<SignalCard>` for displaying signals
   - `<Badge>` for status indicators

2. **Component file structure:**
   ```typescript
   // Imports
   import React from 'react';
   import { Signal } from '../types/Signal';

   // Props interface
   interface SignalCardProps {
     signal: Signal;
     onClick?: () => void;
   }

   // Component
   export const SignalCard: React.FC<SignalCardProps> = ({ signal, onClick }) => {
     // Implementation
   };
   ```

3. **Error boundaries required** for all data-dependent pages:
   ```jsx
   <ErrorBoundary fallback={<ErrorFallbackUI />}>
     <AssetDetail />
   </ErrorBoundary>
   ```

### API Calls & Data Fetching
- **Always show loading states** while fetching data
- **Always handle errors gracefully** with user-friendly messages
- **Show stale data warnings** if data is >5 minutes old (critical for price data)

Example:
```typescript
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);
const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

// Fetch with error handling
try {
  const data = await fetchSignals();
  setLastUpdated(new Date());
} catch (err) {
  setError('Unable to load signals. Please try again.');
  console.error(err);
} finally {
  setLoading(false);
}

// Show stale data indicator
{lastUpdated && isStale(lastUpdated) && (
  <div className="stale-indicator">⚠️ Data may be outdated</div>
)}
```

### Naming Conventions
- **Components:** PascalCase (`SignalCard.tsx`)
- **Utilities:** camelCase (`formatPrice.ts`)
- **CSS files:** kebab-case (`vela-design-system.css`)
- **Database tables:** snake_case (`track_record`)

---

## Brand Voice Guidelines

Every user-facing string must align with one of the **Three Pillars**:

### 1. Always Watching
Emphasizes 24/7 monitoring, automation, proactive alerting.
- ✅ "Vela monitors Bitcoin 24/7 and flags key moments"
- ✅ "We're watching the market so you don't have to"
- ❌ "Check back later for updates"

### 2. You Stay in Control
Emphasizes user agency, transparency, no auto-trading.
- ✅ "You approve every trade. Vela brings you the right moments."
- ✅ "Here's why we think this: [clear explanation]"
- ❌ "Vela automatically executes when conditions are met"

### 3. Plain English, No Noise
Clear, jargon-free explanations that anyone can understand.
- ✅ "Price broke above $45,000, trend is up"
- ✅ "Strong buying pressure, momentum is building"
- ❌ "EMA-9 crossed SMA-50 with bullish MACD divergence"

**When in doubt:** Ask yourself if your grandmother would understand the message. If not, simplify.

---

## Testing Standards

### Critical Test Coverage Areas
Vela handles financial data — bugs in these areas directly harm user trust:

**Priority 1: Trust-Critical Calculations**
- Track record P&L calculations (must be exact, never misleading)
- Signal status rendering (never show "BUY" for a bearish signal)
- Price change percentages (must match source data)

**Priority 2: Data Handling**
- API error handling (CoinGecko, Supabase)
- Stale data detection (>5 min old)
- Loading states for all async operations

**Priority 3: UI Consistency**
- Design token usage (no hardcoded colors)
- Dark mode rendering
- Accessibility (ARIA labels, keyboard navigation)

### Test File Naming
```
src/components/SignalCard.tsx
src/components/SignalCard.test.tsx  ← Test file
```

### Running Tests
```bash
npm run test           # Run all tests
npm run test:watch     # Watch mode during development
npm run test:coverage  # Generate coverage report (target: >70% on critical paths)
```

---

## Security Checklist

### API Keys & Secrets
- ✅ All API keys in environment variables (`.env.local`, never committed)
- ✅ Notion token in `~/.notion-config.json` (outside repo)
- ✅ Supabase keys in Vercel environment variables
- ❌ **NEVER** hardcode API keys in source code
- ❌ **NEVER** commit `.env.local` to git

### Pre-commit security check:
```bash
# This should be automated in git hooks
grep -r "ntn_" src/  # Check for Notion tokens
grep -r "sk-" src/   # Check for API keys
```

### Input Validation
- All user inputs must be validated (XSS prevention)
- All API responses must be validated before rendering
- Use TypeScript interfaces to enforce data shapes

---

## Common Commands

### Development
```bash
npm run dev           # Start dev server (localhost:5173)
npm run build         # Build for production
npm run preview       # Preview production build locally
npm run type-check    # Run TypeScript compiler (no output)
npm run lint          # Run ESLint (when configured)
```

### Notion Integration (Session Management)
```bash
vela-start            # Show session status: git changes, tasks, recent activity
vela-end              # Log decisions and tasks to Notion
vela-tasks list       # List all tasks from Notion
vela-tasks add        # Add a new task
vela                  # cd to project directory
```

### Git Workflow
```bash
git add [files]
git commit -m "feat: add signal detail page"  # Conventional commits format
# Post-commit hook automatically logs to Notion changelog
git push origin main  # Auto-deploys to Vercel
```

---

## Architectural Decision Records (ADRs)

For significant architectural choices, document in Notion "Decisions" database using this format:

**Template:**
```markdown
# ADR-XXX: [Decision Title]

## Context
What problem are we solving? What constraints exist?

## Decision
What did we choose? Why this approach?

## Consequences
**Pros:** What do we gain?
**Cons:** What are the tradeoffs?
**Alternatives Considered:** What did we reject and why?

## Status
✅ Implemented | 🟡 In Progress | ❌ Rejected
```

**Example ADRs logged so far:**
- ADR-001: Semantic Color Tokens for Signal Status
- ADR-002: Supabase for Backend (vs. custom API)
- ADR-003: Paper Trading Before Real Trading

---

## Common Pitfalls & Gotchas

### 1. CoinGecko API Rate Limits
- **Free tier:** 10-50 calls/minute (varies)
- **Solution:** Cache price data for 60 seconds minimum
- **Fallback:** Show stale data with warning instead of crashing

### 2. Supabase Real-Time Subscriptions
- Don't forget to unsubscribe in `useEffect` cleanup:
  ```typescript
  useEffect(() => {
    const subscription = supabase
      .channel('signals')
      .on('postgres_changes', { ... }, handleChange)
      .subscribe();

    return () => subscription.unsubscribe(); // ← Critical
  }, []);
  ```

### 3. Design System Adoption Inconsistency
- **Problem:** Some pages use VelaComponents, others use raw MUI
- **Solution:** When editing a page, migrate MUI components to Vela equivalents
- **Check:** Run `grep -r "from '@mui'" src/` to find raw MUI usage

### 4. Signal Status Color Mapping
- **CRITICAL:** Signal status colors have semantic meaning:
  - Green = BUY
  - Red = SELL
  - Gray = WAIT
- **Never** use green for anything except bullish signals
- **Never** use red for anything except bearish signals

### 5. Time Zone Handling
- All timestamps in Supabase are UTC
- Convert to user's local time for display
- Always show time zone in UI: "Last updated: 2:34 PM PST"

---

## Performance Targets

### Load Time
- **LCP (Largest Contentful Paint):** < 2.5 seconds
- **FID (First Input Delay):** < 100ms
- **CLS (Cumulative Layout Shift):** < 0.1

### Bundle Size
- **Main bundle:** < 200KB gzipped
- **Lazy load** AssetDetail page components
- **Code split** by route

### API Response Times
- **CoinGecko price fetch:** < 1 second
- **Supabase query:** < 500ms
- **Show loading spinner** after 300ms (don't flash for fast loads)

---

## Pre-Launch Checklist

Before deploying to production, verify:

**Security:**
- [ ] All API keys in environment variables (not hardcoded)
- [ ] `.env.local` in `.gitignore`
- [ ] No sensitive data in git history

**Quality:**
- [ ] Test coverage >70% on trust-critical paths (P&L, signal status)
- [ ] All TypeScript errors resolved (`npm run type-check`)
- [ ] Build succeeds without warnings (`npm run build`)

**UX:**
- [ ] Error boundaries on all data-dependent pages
- [ ] Loading states for all async operations
- [ ] Stale data indicators (>5 min) on price data
- [ ] Dark mode tested on all pages
- [ ] Mobile responsive (375px, 768px, 1024px breakpoints)

**Accessibility:**
- [ ] Lighthouse accessibility score > 90
- [ ] Keyboard navigation works for all workflows
- [ ] All interactive elements have focus states
- [ ] Color is not the only signal differentiator (use icons + text)

**Brand:**
- [ ] All user-facing copy reviewed against Three Pillar framework
- [ ] Design system tokens used (no hardcoded colors)
- [ ] Typography consistent (Instrument Sans for headings, Inter for body)

---

## Getting Help

### Key Documentation
- **Design System:** See `VELA-README.md` and `src/styles/vela-design-system.css`
- **Notion Workspace:** [Vela Project Hub](https://notion.so/vela) (Product, Design, Engineering, Activity Log)
- **Brand System V2.0:** See Notion > Design > Brand System page

### When to Use Plan Mode
Use Claude Code's **plan mode** for:
- Changes affecting 3+ files
- New feature architecture
- Breaking changes or refactors
- Database schema changes

### When to Ask for Review
Before merging code that affects:
- P&L calculations or signal status logic
- API key handling or security
- Design system breaking changes
- Database schema migrations

---

## Project Goals & Roadmap

### Current Phase: MVP Development
**Goal:** Launch a functional paper trading dashboard that demonstrates Vela's value.

**In Progress:**
- ✅ Signal dashboard (Home page)
- ✅ Asset detail pages
- ✅ Track record / paper trading history
- ✅ Daily market digest
- 🟡 Real-time notifications (Telegram)
- 🟡 Customizable signal parameters UI

### Next Phase: Production Launch
- [ ] Test infrastructure (Jest + React Testing Library)
- [ ] Error tracking (Sentry integration)
- [ ] Performance monitoring (bundle size, load times)
- [ ] User feedback collection
- [ ] Marketing landing pages

### Future Phases
- Real money integration (after paper trading proves accurate)
- Multi-asset support (expand beyond BTC/ETH)
- Mobile app (React Native)
- Advanced charting and technical analysis tools

---

## Notes for Claude Code Sessions

### Session Start Routine
1. Run `vela-start` to see project status
2. Review any "Next" priority tasks from Notion
3. Check git status for uncommitted changes

### Session End Routine
1. Run `vela-end` to log decisions and tasks
2. Ensure all tests pass
3. Commit with conventional commit message
4. Push to trigger Vercel deployment

### If You're Stuck
- Check this file (CLAUDE.md) for conventions
- Review recent Notion changelog for context
- Check Notion Decisions database for past architectural choices
- Read relevant ADRs before proposing alternative approaches

---

**Remember:** Vela is about **trust**. Every design choice, every line of code, every user-facing message should reinforce that users are in control and getting accurate, honest information. When in doubt, prioritize transparency and clarity over cleverness.