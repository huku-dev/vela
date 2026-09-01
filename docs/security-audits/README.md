# Security Audits

Monthly STRIDE + OWASP audits of both Vela repos (`crypto-agent-frontend`, `crypto-agent`).

Run automatically on the 1st of each month by the `monthly-security-audit` scheduled task.

**Every audit report belongs in this directory and must be committed in the same session it is written.**
Never `reports/` (untracked, periodically cleaned). An uncommitted report is the same as no audit.

---

## Series

| Month | Report | Committed | Notes |
|---|---|---|---|
| 2026-04 | — | ❌ | Ran; fixes committed (`6d4e805`) but no report file written. |
| 2026-05 | [2026-05-06](2026-05-06-monthly-audit.md) | ✅ `46f5018` | 16 findings; 13 later closed. |
| 2026-06 | — | ❌ | Scheduled run produced no artifact. Coverage gap. |
| 2026-07 | [2026-07-02](2026-07-02-monthly-audit.md) | ✅ `aafc07e`+ (recovered 2026-09-01) | Written 2026-07-02 but committed only after being found in a git stash on 2026-09-01. No CRITICAL/HIGH app-level findings at the time. |
| 2026-08 | [2026-08-02](2026-08-02-monthly-audit.md) | ✅ `aafc07e`+ (recovered 2026-09-01) | 2 CRITICAL (cron secret leak regression; `scanner-30m` unauthenticated), 2 HIGH, 3 MEDIUM. Written + moved to this dir but never committed until recovered from stash on 2026-09-01. |
| 2026-09 | [2026-09-01](2026-09-01-monthly-audit.md) | ✅ | Aug C1 (cron secret) FIXED + live-verified. **Still open: C2 `scanner-30m` (CRITICAL), + `e2e-prod-test` mainnet trade/JWT-forge (CRITICAL, new), ~13 ungated fns (HIGH).** New: anon-executable `admin_llm_cost_*` RPCs. npm audit 75. |

---

## Recurring failure: uncommitted reports

Four of six monthly runs (Apr, Jun, Jul, Aug) left no committed record at the time. Jul and Aug were
recovered from git stashes on 2026-09-01 — the Aug report carried 2 CRITICAL findings that were
effectively invisible for a month as a result. The task spec now mandates committing the report
before the run ends; keep this table current, and a blank/❌ row is the signal that a month was missed.
