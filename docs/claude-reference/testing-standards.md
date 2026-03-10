# Testing Standards

> *Extracted from CLAUDE.md — see CLAUDE.md for project overview and engineering principles.*

---

## Critical Test Coverage Areas

Vela handles financial data — bugs in these areas directly harm user trust:

### Priority 1: Trust-Critical Calculations
- Track record P&L calculations (must be exact, never misleading)
- Signal status rendering (never show "BUY" for a bearish signal)
- Price change percentages (must match source data)

### Priority 2: Data Handling
- API error handling (CoinGecko, Supabase)
- Stale data detection (>5 min old)
- Loading states for all async operations

### Priority 3: UI Consistency
- Design token usage (no hardcoded colors)
- Dark mode rendering
- Accessibility (ARIA labels, keyboard navigation)

---

## Adversarial Testing (Required for all financial/trading features)

Every feature that touches money, positions, or proposals **must** include adversarial tests.
These go beyond "does it work?" to ask **"can it be exploited?"**

### Naming Convention
`FEATURENAME-ADV:` prefix (e.g., `TRIM-ADV:`, `CLOSE-ADV:`, `TIER-ADV:`)

### Required Attack Vectors
Test each of these for every new financial feature:

1. **Fund extraction** — Can this be used to steal or inflate balances?
2. **Race conditions** — What happens if two concurrent actors trigger this?
3. **Authorization bypass** — Can user A affect user B's data?
4. **Phantom operations** — Can this act on entities that no longer exist?
5. **Scope leakage** — Are DB queries scoped to user_id + asset_id?
6. **Auto-approval abuse** — Does auto-mode still require full_auto + tier check?
7. **Guard bypass** — Do cooldowns, circuit breakers, and limits apply?
8. **Accidental amplification** — Can a partial operation accidentally become a full one?

### Two Test Layers

- **Source-verification tests** (`TRIM:` prefix) — Read source files, assert patterns exist. Fast, catches regressions when code is refactored.
- **Adversarial tests** (`TRIM-ADV:` prefix) — Verify defense-in-depth: that guards exist at multiple layers, ordering is correct, scoping is tight.

### When to Write Adversarial Tests
- Any new `proposal_type` or trade action
- Any change to execution, position update, or P&L logic
- Any change to auto-approval or tier enforcement
- Any new DB mutation in the trading pipeline

### Threat Reports
Every adversarial test session must produce a written threat report (saved to `docs/threat-reports/`) documenting each threat, its severity, the defense mechanism, and any residual risk. See `docs/threat-reports/TEMPLATE.md` for format.

---

## Test File Naming

```
src/components/SignalCard.tsx
src/components/SignalCard.test.tsx  <- Test file
```

---

## Running Tests

### Frontend
```bash
npm run test           # Run all tests (vitest)
npm run test:watch     # Watch mode during development
npm run test:coverage  # Generate coverage report (target: >70% on critical paths)
```

### Backend (Deno)
```bash
deno test --no-check --allow-env --allow-read supabase/functions/_shared/trade-executor.test.ts
deno test --no-check --allow-env --allow-read --filter "TRIM" ...  # Run subset
```

---

## Current Test Counts

- **Frontend:** 522 tests (as of 2026-03-06)
- **Backend:** 559 Deno tests (as of 2026-03-09)

---

## Testing Patterns

- **DEV_BYPASS:** `useAuth.ts` returns mock state when `VITE_DEV_BYPASS_AUTH=true`. Tests use `it.skipIf(IS_DEV_BYPASS)` for non-bypass tests and `it.skipIf(!IS_DEV_BYPASS)` for bypass-specific tests. Source-verification tests (`readFileSync`) run regardless.
- **localStorage mock:** Use `createLocalStorageMock()` + `vi.stubGlobal('localStorage', storageMock)` (same as CookieConsent.test.tsx). jsdom's native localStorage doesn't have `.clear()` in vitest.
- **Backend unit tests mandatory for signal engine changes:** Any change to signal-rules.ts, signal-engine.ts, or indicators.ts MUST include Deno unit tests before commit. Not optional.

---

## Known Structural QA Gaps

### 1. Auth-Exchange → Email Delivery (Identified 2026-03-09)
**Gap:** Dev bypass auth (`VITE_DEV_BYPASS_AUTH=true`) skips `auth-exchange` entirely, so the full signup → profile creation → email delivery pipeline is never tested in local QA or CI.

**Root cause of incident:** `profiles.email` was never populated by `auth-exchange`, so Resend calls silently sent to `null`. This went undetected because dev bypass creates a mock auth state that never calls the edge function.

**Mitigation (deployed):** Fixed `auth-exchange` to correctly populate `profiles.email` from the Privy token.

**Remaining gap:** No automated E2E test covers the real auth-exchange flow. Manual staging test required:
1. Sign up with a real email on staging
2. Verify `profiles.email` is populated in Supabase
3. Trigger a signal flip and verify email is delivered

**Future fix:** Add a staging-only integration test that calls `auth-exchange` with a test Privy token and asserts `profiles.email` is written. Track in `memory/outstanding-testing.md` when created.
