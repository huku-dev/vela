---
paths:
  - "src/**/*trade*"
  - "src/**/*proposal*"
  - "src/**/*position*"
  - "src/**/*pnl*"
  - "src/**/*balance*"
  - "src/**/*deposit*"
  - "src/**/*withdraw*"
---

# Financial Code Rules

## Data Display
- Dollar P&L: always "+$54 profit" / "-$12 loss" — never bare amounts
- On social/public: percentage-only (dollar P&L misleading without position size)
- All timestamps UTC in DB, convert to local for display, always show timezone
- Stale data warnings required for data >5 min old

## Testing Gate
- Adversarial tests (`FEATURE-ADV:` prefix) REQUIRED before any commit
- Never deploy financial features without tests written and passing first
- Threat report in `docs/threat-reports/` for new attack surfaces

## Edge Cases
- Always ask: "what if null / zero / negative / stale?"
- Tier config `0` = unlimited (not zero). Guard: `if (tierConfig.max_X > 0 && value > tierConfig.max_X)`
- Hyperliquid $10 minimum order value

## Notification Privacy
- Every notification function must use shared helpers from `notify.ts`
- Never inline Supabase queries for user routing (2026-03-19 breach lesson)
- Always ask "user, admin, or both?" for notification audience
