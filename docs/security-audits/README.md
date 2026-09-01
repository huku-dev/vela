# Security Audits

Monthly security audit reports for the Vela platform (frontend + backend repos). Written by the scheduled `monthly-security-audit` task. Reports must be committed in the same run that produces them — an uncommitted report is the same as no audit (the 2026-04, 2026-06, 2026-07 and 2026-08 runs left no durable record).

| Date | Report | Highlights |
|---|---|---|
| 2026-05-06 | [2026-05-06-monthly-audit.md](2026-05-06-monthly-audit.md) | C1 run-signals ungated; H1-H3 ungated notification fns; M4 plaintext OTPs; npm audit 24 findings |
| 2026-09-01 | [2026-09-01-monthly-audit.md](2026-09-01-monthly-audit.md) | 13/15 May findings fixed (all CRIT/HIGH). New: anon-executable `admin_llm_cost_*` RPCs (M2); 10 cron fns still ungated (M1); npm audit up to 75. pg_cron + RLS live-verified clean |
