# Methodology: Play A — HIP-4 mechanical arb monitor + manual trader (Henry-only v1)

**Status:** pre-registered. Locked before any work starts.

**Date:** 2026-05-05

---

## 1. Goal

Build a HIP-4 quote monitor that detects mechanical arbitrage dislocations (YES + NO + fees < $1) and surfaces them to Henry in real time, with a thin execution path so Henry can trade them himself. Outcome: validate whether the arb opportunity is real, frequent, and tradeable, before deciding if/how to expose it to Vela users.

This is research infrastructure with a tradeable surface for one user (Henry). It is not a Vela product feature in v1.

---

## 2. What it does

### 2.1 Quote monitor

- Polls HIP-4 quotes via HL info endpoint at a tight cadence (target 5s, fall back to 15s if rate-limited)
- For each active HIP-4 binary market, computes:
  - `yes_ask + no_ask + estimated_fees`
  - `yes_bid + no_bid + estimated_fees`
- Logs all dislocations where the arb expression < $1.00 to a local SQLite table `hip4_dislocations` with: timestamp, market_id, yes_ask, no_ask, fees, edge_per_dollar, depth_at_quote
- Logs all polling samples (whether dislocation or not) to `hip4_snapshots` for frequency / liquidity tracking

### 2.2 Henry-facing alerts

- Telegram bot (reuse Vela's existing Telegram infra under his admin chat ID) sends an alert when:
  - Dislocation > $0.005 edge per $1 of capital (configurable)
  - And quote depth ≥ $500 notional on the thinner leg (filters out unfillable noise)
- Alert format: market title, edge size, max-fillable size at quote, expected hold to settlement, suggested action

### 2.3 Automated execution with hard safeguards

Updated 2026-05-05: defaulted from manual to automated. Manual would miss most opportunities given dislocation lifetime. Safety comes from bounded sizing and hard-coded gates, not human-in-the-loop.

- Quote poller detects dislocation, re-fetches quotes immediately for freshness verification
- Aborts if quote moved >0.3% or depth dropped below threshold in the re-fetch
- Submits matched YES + NO buy orders as a batch via HL execution adapter
- Logs fills, computes realized arb edge after slippage and fees
- Post-fill Telegram notification to Henry (information, not approval gate)

**Hard safeguards (all enforced in code, no soft overrides):**

| Safeguard | Threshold | Action |
|-----------|-----------|--------|
| Max position size per opportunity | $1,000 notional | Cap order to this size |
| Daily capital deployment cap | $10,000 across all opportunities | Halt new entries when hit, resume next day |
| Minimum edge threshold | 0.5% per $1 capital after fees | No fire below this |
| Quote freshness check | re-fetch <2s before order, abort if moved >0.3% | Skip opportunity |
| Per-market position cap | max one open position per market at a time | Skip if existing position open |
| Kill switch | env var `PLAY_A_ENABLED=false` or DB flag | Halt execution within next poll cycle |
| Settlement divergence alert | realized PnL diverges from expected by >50% | Halt new entries, require manual re-enable |
| Anomalous settle detection | unusual price action in 5min pre-settle, or disputed settle | Halt new entries, alert |

Kill switch and halts are checked every polling cycle. Bot fails closed (no execution) if any check fails.

### 2.4 Position tracking

- `hip4_positions` table tracks open arb positions with: market_id, fill_prices, sizes, fees_paid, expected_pnl, settlement_status
- On settlement, compute realized PnL and reconcile against expected
- Surface a daily summary to Henry: dislocations seen, opportunities executed, realized PnL, capital deployed

---

## 3. Decision criteria for expansion to users

After 4 weeks of operation, evaluate:

- **Frequency:** how many dislocations > 0.5% edge are observed per day? (If <1, this is too rare to build a user-facing product around.)
- **Capacity:** what's the average notional fillable per opportunity at the alerted edge? (If average is <$1k, capacity is too thin for users.)
- **Realized vs expected edge:** what's the post-slippage capture rate? (If <50%, execution friction makes it unviable.)
- **Settlement risk:** any disputed or anomalous settlements during the window? (Any single anomaly is a hard block on user expansion.)
- **HIP-4 multi-market progress:** how many markets are listed? (If still single BTC daily after 4 weeks, expansion is structurally premature regardless of bot performance.)

**Go-to-users criteria (all must be true):**
- Frequency ≥ 3 opportunities per day at edge ≥ 0.5%
- Average capacity ≥ $5k per opportunity
- Realized edge ≥ 70% of quoted edge
- Zero anomalous settlements
- HIP-4 has ≥3 active markets

If any fails, the bot continues running for Henry's personal use but is not productionized for users until the failing criterion is addressed.

---

## 4. Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| Settlement manipulation (banging-the-close on thin order books) | Size cap per opportunity. Henry confirms each trade. Log all fills with timestamps for post-mortem. |
| HL API rate-limiting kills the monitor | Exponential backoff, alert if monitor goes dark for >5 min |
| Capital lockup until settlement | All capital is Henry's, not Vela's. Sized small. |
| Quote staleness vs fill price | Refetch quotes immediately before order submission. Abort if quote moved >0.5% from alert. |
| HIP-4 USDH ↔ USDC basis | If HIP-4 collateral is USDH and Vela funds are in USDC, account for any conversion cost. Verify before first trade. |
| Logging too much (noise) | Dislocation alerts only above thresholds. Snapshots logged at lower verbosity. |

---

## 5. Engineering scope

| Component | Estimate |
|-----------|----------|
| Quote poller + dislocation detector | 60 min |
| SQLite schema + persistence | 30 min |
| Telegram alert wiring (reuse infra) | 30 min |
| Manual execution CLI | 60 min |
| Position tracking + settlement reconciliation | 45 min |
| Daily summary | 15 min |
| Local-only deployment (no cron-board impact) | nil |

Total: ~3.5 hours. Runs locally on Henry's machine (or a tiny VPS) so it's outside the Vela cron board entirely.

---

## 6. Out of scope explicitly

- User-facing exposure (Henry-only capital, no users in v1)
- Multi-strike combinatorial arb (defer until HIP-4 has multi-strike)
- Cross-venue arb against Kalshi (separate Play, not in scope)
- Hedging or delta management (binaries held to settlement)
- HIP-4 quote market making (separate scope, requires HL builder fee approval)

---

## 7. Outputs

- `tools/hip4-arb-monitor/monitor.py` — quote poller
- `tools/hip4-arb-monitor/execute.py` — manual execution CLI
- `tools/hip4-arb-monitor/schema.sql` — local SQLite schema
- `tools/hip4-arb-monitor/README.md` — Henry's runbook
- After 4 weeks of operation: `findings/04-play-a-results.md` with go-to-users decision
