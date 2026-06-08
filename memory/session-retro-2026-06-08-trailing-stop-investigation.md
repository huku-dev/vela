# Session Retrospective: Trailing Stop Drop Investigation

**Date:** 2026-06-08  
**Branch:** `claude/trailing-stop-drop-investigation-qXIfz`  
**Sessions spanning this investigation:** June 5 (2 sessions) + June 8 (this session)

---

## 1. What triggered the investigation

The starting question: **are Vela's trailing stops exiting positions too early?** Specifically — are there cases where the trailing stop fires, the signal is still active, and price then continues meaningfully in the trade direction? If yes, how much profit is being left on the table, and does it suggest the trailing stop parameters need tuning?

The investigation was qualitative at first (looking at individual exits) but the real value was going quantitative — measuring the foregone move across all closed positions, not just anecdotes.

---

## 2. What was built

### `scripts/foregone_move_analysis.py` (June 5)

A standalone Python script that:
1. Queries all closed positions from Supabase (`status = closed`, up to 1000 rows)
2. For each position, fetches 1h candles from Hyperliquid's `candleSnapshot` API for the 48h window after `closed_at`
3. Computes direction-adjusted foregone move at +1h, +4h, +12h, +24h, +48h windows
4. Flags positions where the signal was still active at close (`closed_at - created_at < 24h`)
5. Outputs a CSV + console summary with: by-asset breakdown, distribution bucketed by magnitude (0–1% / 1–3% / 3–5% / 5–10% / 10–20% / 20%+), top 10 biggest missed opportunities

**Key implementation detail confirmed by DB audit:** `current_price` in the positions table is the actual exit mark price at close time. Verified by `entry_price * (1 ± closed_pnl_pct/100) ≈ current_price` on every row. This matters because the foregone calculation uses `current_price` as the baseline.

**Symbol mapping corrections required (two fixes across June 5):**
- All non-crypto assets use Hyperliquid's HIP-3 xyz deployer format: `xyz:AAPL`, `xyz:NVDA`, etc.
- WTI crude oil: `xyz:CL` not `OIL` or `xyz:OIL`
- S&P 500 index: `xyz:SPX` not `SPX500`
- Crypto (BTC, ETH, SOL, HYPE, ZEC) are native HL perpetuals — no prefix

### `.claude/commands/trailing-stop-analysis.md` (June 8)

A custom Claude Code slash command chip (`/trailing-stop-analysis`) that tells a local Claude Code session exactly what to run and why. Necessary because the cloud Claude Code environment blocks outbound HTTP, preventing the script from reaching the HL API.

---

## 3. Why the investigation stalled — the candle coverage gap

Before the chip existed, we were trying to validate the analysis using Supabase's `candles_30m` table as a sanity check. This revealed a major coverage gap:

**81 trailing stop exits. Only 29 have any post-close candle data in Supabase.**

| Asset | Exits | Covered | Gap |
|-------|-------|---------|-----|
| HYPE | 15 | 15 | 0 |
| BTC | 5 | 5 | 0 |
| ETH | 5 | 4 | 1 |
| OIL | 11 | 3 | 8 |
| SOL | 7 | 1 | 6 |
| AAPL, NVDA, AMZN, MSFT, META, ZEC, NATGAS, SILVER, SKHX, SNDK, SPCX | 33 | 0 | 33 |

Root cause: **`candles_30m` is populated as a side effect of the BB2 scanner (`scanner-30m`).** When BB2 was disabled for non-BTC/HYPE assets around April 17, the candle logging stopped too. BTC and HYPE retained continuous coverage only because BB2 stayed active for them.

This was **not a bug** — the user confirmed BB2 was intentionally killed for those assets.

**Why this matters for the investigation:** The Supabase-based analysis path would only cover 29/81 positions — a 64% blind spot skewed toward crypto. The `foregone_move_analysis.py` script bypasses this entirely by pulling directly from the HL API, so it covers all 81.

---

## 4. Storage/cron impact assessment (decision pending)

Assessed the cost of re-enabling candle logging for all 22 active assets independent of BB2:

- **Storage:** 22 assets × 48 candles/day × ~120 bytes/row = ~3.2 MB/month. With 90-day rolling retention: capped at ~11 MB forever. Negligible.
- **Cron impact:** `scanner-30m` would add ~20 more HL GET calls per run. ~2-3 extra seconds per invocation. Well within edge function timeout.
- **Recommendation:** Decouple candle logging from BB2 in `scanner-30m`, add 90-day rolling delete. Decision not yet made.

---

## 5. Open items — what the next session needs to do

**Primary: Run the analysis locally**

```bash
cd ~/vela && git pull origin main
# then in Claude Code:
/trailing-stop-analysis
```

The script fetches 48h of HL candles for all 81 trailing stop exits and produces `foregone_move_analysis.csv`. That CSV is the actual deliverable of this entire investigation.

**Questions the analysis will answer:**
- What % of trailing stop exits continued >2% in trade direction within 24h?
- What's the distribution of foregone move? (Mostly 0–3%, or are there 10–20%+ exits?)
- Do exits where `signal_still_active = true` (closed within 24h of entry) have worse foregone move? These are re-entry candidates.
- Is the problem concentrated in specific assets or broad?

**Secondary (backend, separate session):** Decouple candle logging from BB2 in `scanner-30m`. Low storage cost, small cron impact. Keeps Supabase self-sufficient for future analyses.

---

## 6. Prompting feedback

The "chip" request was clear in intent but the word itself is ambiguous — "chip" isn't a formal Claude Code term. "Custom slash command" or "a `.claude/commands/` file" resolves the ambiguity instantly.

The ask "why did it only cover 20 positions" came in after context compaction — harder to answer accurately without the full history. Stating the expected number upfront ("I expected ~81 trailing stop positions to be covered") would have made the gap immediately actionable.

---

## 7. Efficiency feedback

Two wasted round-trips on June 5:
1. Wrong HL symbols for non-crypto (missing `xyz:` prefix). A single test HL query before writing the full script would have caught this.
2. Missing `tabulate` in `requirements-backtest.txt`. Should grep the imports list before finalising requirements files.

On June 8, retro was started from post-compaction context only, missing the June 5 build work. Should pull branch commit history before starting any session documentation.

---

## 8. Key facts for future sessions

- **81 trailing stop exits** as of 2026-06-08
- **Top assets by exit count:** HYPE 15, OIL 11, NVDA 8, SOL 7, AAPL 7, BTC 5, ETH 5, AMZN 5, MSFT 4, GOLD 3
- **HL symbol format for HIP-3 xyz deployer perps:** `xyz:TICKER` (e.g. `xyz:AAPL`, `xyz:CL` for oil, `xyz:SPX`)
- **Native HL perps:** BTC, ETH, SOL, HYPE, ZEC — no prefix
- **`current_price` in positions table** = mark price at close time (confirmed correct)
- **`candles_30m` coverage** tied to BB2 scanner — disabling BB2 for an asset kills its candle feed
- **Script:** `scripts/foregone_move_analysis.py`
- **Chip:** `.claude/commands/trailing-stop-analysis.md` → `/trailing-stop-analysis`
- **Cannot run in cloud Claude Code** — HL API outbound HTTP blocked; must run locally
