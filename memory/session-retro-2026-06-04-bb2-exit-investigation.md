---
name: session-retro-2026-06-04-bb2-exit-investigation
description: Session retro for BB2 1-hour close investigation
metadata:
  type: project
---

# Session Retro — 2026-06-04 BB2 Exit Investigation

## What was done

Short investigation session. User noticed a BB2 BTC trade opened and closed in exactly 1 hour (+$0.29 profit) and wanted to know if something was wrong.

Used `vela-debug` to pull DB state. Diagnosis: clean `signal_red` / `bb2_exit` close. RSI entered the lower band (43.08 vs lower band 43.23) at the 17:30 candle, then crossed back above 50 (to 50.17) on the very next 30m candle (18:30). Position-monitor acted on the scanner event and closed at +1.04%.

Follow-up: user asked whether the RSI-crosses-50 exit was new (since prior BB2 trades closed after 16h). Answer: always existed since 2026-03-09 (f3a8869). Prior 16h closes were hold-time expiry (RSI never crossed 50 within the window). Today's entry was shallow (barely outside band) and BTC mean-reverted fast.

## Code changes

None. Read-only investigation.

## Tests

Skipped — no code changed.

## Open items

None.

## Prompting feedback

None.

## Efficiency notes

`vela-debug` + git history search answered the question cleanly in two turns. No wasted steps.
