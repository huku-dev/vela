---
paths:
  - "**/*.test.*"
  - "**/*.spec.*"
  - "src/test/**"
  - "src/setupTests.ts"
---

# Testing Rules

**Full reference:** `docs/claude-reference/testing-standards.md`

## Priority Areas
1. **Trust-critical:** P&L calculations, signal status rendering, price change percentages
2. **Data handling:** API errors, stale data (>5 min), loading states
3. **UI consistency:** Design tokens, accessibility

## Adversarial Tests (MANDATORY for financial features)
- Prefix: `FEATURENAME-ADV:` (e.g., `TRIM-ADV:`, `CLOSE-ADV:`)
- Attack vectors to cover: fund extraction, race conditions, auth bypass, phantom operations, scope leakage, auto-approval abuse, guard bypass, accidental amplification
- Two layers: source-verification (`TRIM:`) + adversarial (`TRIM-ADV:`)
- Threat report required in `docs/threat-reports/`

## Patterns
- File naming: `Component.test.tsx` next to `Component.tsx`
- DEV_BYPASS: `it.skipIf(IS_DEV_BYPASS)` for auth-dependent tests
- localStorage mock: `createLocalStorageMock()` + `vi.stubGlobal()`
- Source-verification tests use `readFileSync` — run regardless of bypass

## Commands
```bash
npm run test           # All tests (vitest)
npm run test:watch     # Watch mode
npm run test:coverage  # Coverage report (>70% on critical paths)
```

## Current Counts
- Frontend: 535 tests
- Backend: 1003 tests
