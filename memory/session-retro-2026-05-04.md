# Session Retro — 2026-05-04

## What was accomplished

- Added upgrade_close + Deno isolate + signals schema notes to `memory/trade-system-architecture.md`
- Committed + deployed `upgrade_close` feature (4841e87): `trading-types.ts`, `proposal-generator.ts`, `notify.ts`, `bb2.test.ts` (47 tests), migration `20260501000001`. Staging + prod.
- Diagnosed and designed fix for BB2 proposals firing when EMA signal is GREEN (user had no open position after EMA proposal expired)
- Implemented BB2 aligned sizing (fdb5796): when BB2 direction matches current EMA signal color, fire at full normal size instead of 0.5×. All other BB2 norms preserved (positionType bb2_30m, 1h expiry, 1.5% stop-loss, BB2 cooldown honored). 7 new FEATURE-ADV tests (bb2.test.ts: 47 → 54). Staging + prod.

## Prompting feedback

- "there is definitely a trade system file" — precise correction. Should have searched `~/.claude/projects/` memory directory before concluding the file didn't exist.
- "a BB2 entry is a BB2 entry" — model scope-cut. One sentence collapsed 80% of implementation complexity. Act on this style of statement immediately without second-guessing.
- Product design conversation was well-structured: user challenged each proposal with a concrete counterexample rather than a vague rejection.

## Efficiency feedback

- Searched wrong location for topic files initially (`/Users/henry/crypto-agent/` instead of `~/.claude/projects/.../memory/`). Should always search both locations in parallel.
- First design proposal ("re-emit every 4H cycle") had the stale-entry flaw the user caught immediately. Should have thought through "signal persists while price runs 15%" before proposing.
- QA agent was correctly sequenced. Phase 0 QA found real structural issues (cooldown gate ordering, TP ladder, stop-loss asymmetry). Would have shipped a subtly wrong implementation without it.
- "5-line change" claim understated scope before QA ran. QA correctly flagged ~20-30 lines.

## Learnings

- `signals` table has `signal_color`. `indicator_snapshots` does NOT. scanner-30m's signals query was only selecting `id` — one query change needed.
- EMA proposals are transition-triggered, not state-checked per cycle. The gap (user misses EMA, falls through to BB2) is a known architectural limitation. BB2 aligned sizing is the partial mitigation; full fix deferred.
- Pre-existing type errors in scanner-30m: 7 `TS2769` on `scanner_events` inserts. Not caused by session changes. Confirmed by stash/unstash test.

## MEMORY.md / docs updates

- `memory/trade-system-architecture.md`: updated with upgrade_close pattern, Deno isolate lifetime, signals table schema.
- MEMORY.md: BB2 regime gate bullet updated; test count updated; this retro entry added to Topic File Index.

## Open items

- **`generateBB2Proposals` 4H path:** Function defaults to `positionType: "bb2"` (not `bb2_30m`), suggesting a 4H BB2 caller (possibly `run-signals` or `bb2-shadow-resolve`). That caller may also need `signalColor` passed for aligned sizing to apply there too. Not investigated.
- **EMA proposal re-emission on persistence:** Consciously deferred. Full fix requires `run-signals` to be state-checked (not transition-triggered). BB2 aligned sizing is the accepted partial mitigation.
- **scanner-30m pre-existing type errors:** 7 `TS2769` on `scanner_events` inserts. Worth fixing in a future cleanup session.
