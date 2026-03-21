# Backtest Strategies & Production Config

> Reference for all signal configs in `scripts/backtest.py`.
> Use the **current production strategy** for backtests unless explicitly testing alternatives.
>
> **When a new strategy is greenlit for production, this file MUST be updated:**
> 1. Move the old strategy to the "Previous Production Strategies" section
> 2. Update "Current Production Strategy" with the new config name + parameters
> 3. Update MEMORY.md inline reference
> 4. Update `ACTIVE_CONFIG` in any backtest scripts

---

## Current Production Strategy: PROD_ACTUAL

*Adopted 2026-03-21 after discovering V9_ATR_2_0X backtest config didn't match production behavior.*

**CRITICAL: `PROD_ACTUAL` is the only config that matches production.** V9_ATR_2_0X uses ATR dynamic stops and a 5-day grace period — neither of which are implemented in the production signal engine or trade executor.

**What production actually does:**
- Fixed 8% stop-loss from entry price (trigger order placed on Hyperliquid at entry)
- No grace period — stop is active immediately
- No ATR-based dynamic stop
- 24h EMA cooldown after stop-loss (in `position-monitor.ts`)
- Trailing stop: 5% activation, 2.5% trail (both directions)
- Profit ladder: 15%/25%/35% levels, 10% trim each
- BB2 trades run on **30-minute** candles via `scanner-30m`, NOT 4H

**Full resolved parameters:**

| Parameter | Value | Prod Implementation |
|-----------|-------|---------------------|
| `rsi_long_entry_min/max` | 40 / 70 | signal-engine.ts |
| `rsi_short_entry_min/max` | 30 / 60 | signal-engine.ts |
| `adx_threshold` | 20 | signal-engine.ts |
| `stop_loss_pct` | 8 (fixed) | trade-executor.ts `getStopLossPrice()` |
| `atr_stop_loss` | **false** | Not implemented in prod |
| `grace_period_days` | **0** | Not implemented in prod |
| `anti_whipsaw_window` | 3 bars | signal-engine.ts |
| `rsi_yellow_threshold` | 78 (trim 25%) | signal-rules.ts |
| `rsi_orange_threshold` | 85 (trim 50%) | signal-rules.ts |
| `trim_mode` | `pct_of_original` | position-monitor.ts |
| `rsi_short_yellow/orange` | 22 / 15 | signal-rules.ts |
| `volume_confirm` | true (0.8 threshold) | signal-engine.ts |
| `btc_crash_filter` | true (-5% daily) | signal-rules.ts |
| `portfolio_circuit_breaker` | true (-10% drawdown) | circuit-breakers.ts |
| `profit_ladder_enabled` | true (15/25/35%, 10% each) | position-monitor.ts |
| `pullback_reentry` | true (0.5% EMA buffer, +5% min, 25% add, max 2) | position-monitor.ts |
| `bb_improved` | true (BB2: see 30-min section below) | scanner-30m |
| `trailing_stop_long` | true (5% activate, 2.5% trail) | position-monitor.ts |
| `trailing_stop_short` | true (same thresholds) | position-monitor.ts |
| `pullback_reentry_short` | false | Disabled |
| `late_entry_max_bars` | 6 (24H window) | signal-engine.ts |
| `ema_cooldown_bars` | 6 (24H cooldown) | position-monitor.ts |

**BB2 production config (scanner-30m, separate from main signal):**

| Parameter | Value |
|-----------|-------|
| BB lookback | 10 bars (30-min) |
| BB std dev | 1.5 |
| Hold limit | 8 hours (16 bars) |
| Stop loss | 3% |
| Position size | 0.3x main size |

---

## Backtest Infrastructure Rules

> **These rules are mandatory. Violations led to incorrect strategy decisions in the past.**

### 1. Always use 4H bars for main signal backtests
Production signals run on 4H candles. Daily bars understate trade frequency by ~5x (506 positions on 4H vs ~97 on daily for the same period). **Daily-bar backtests are only useful for quick screening — never for final decisions.**

### 2. BB2 requires 30-minute bars
BB2 runs on `scanner-30m` in production. 4H backtesting is unsuitable for BB2 — the wider Bollinger Bands at 4H naturally align with SMA-50 trend, masking regime effects visible on 30-min. Only 104 days of 30-min data available from Hyperliquid (5000 candle limit). Start logging 30-min candles to Supabase for future analysis.

### 3. Always use `PROD_ACTUAL` as baseline
Never compare against V9_ATR_2_0X or other non-production configs. Any new strategy must beat `PROD_ACTUAL` on 4H bars to be considered.

### 4. New simulator modifications must be integrated into `simulate_trades()`
**NEVER apply strategy changes as post-processing wrappers.** Wrappers can't model second-order effects (blocked re-entries, changed downstream dynamics). The 7d trailing stop wrapper showed +$4,301; integrated simulation showed -$499 — a $4,800 discrepancy caused by this error.

### 5. Always report position-level metrics
Group trims with parent positions. Trade-level metrics (counting trims and BB2 separately) give misleading win rates. The backtest `group_into_positions()` function is the correct approach.

### 6. Always include trade/position count in output tables
Missing trade counts make results impossible to evaluate for statistical significance.

### 7. Bear market isolation test is mandatory
Any strategy change must be tested specifically on the **Oct 15 2025 — present** choppy/bear period, not just the full 730-day window. The full window is dominated by the Mar 2024 — Oct 2025 bull run, which inflates results for trend-following changes. Example: removing trailing stops showed +$965 on full period but -$214 in the bear period.

### 8. Minimum 730 days for main signal backtests
Shorter windows miss full market cycles. Exception: BB2 on 30-min data (limited to ~104 days by Hyperliquid API).

### 9. Always pass `btc_df` for altcoin crash filtering
Non-BTC assets need BTC price data for the crash filter.

### 10. Position size: $1,000 per trade
Standard across all backtests for comparability. P&L results are per-$1,000 deployed.

---

## Strategy Evolution

| Version | Name | Key Changes | Status |
|---------|------|-------------|--------|
| V1 | `SIGNAL_CONFIG` | Baseline EMA 9/21 cross, RSI gates, ADX>=20, 8% fixed stop, pct-of-remaining trims | Superseded |
| V3 | `IMPROVED_CONFIG` (Enhanced v3) | +5d grace period, +pct_of_original trims, +reverse short yellow, +volume confirm, +ATR 2.0x stop, +BTC crash filter, +circuit breaker, +RSI BB complementary | Superseded |
| V4a-d | Confirmation/RSI Velocity | +confirmation bars, +RSI velocity detection | Experimental, not adopted |
| V5 | Trade Velocity | Disabled old BB. Profit ladder (V5a), pullback re-entry (V5b), DCA (V5c), BB2 (V5d). Combos: V5e-V5h | V5f Full Suite adopted |
| V6a | Trailing Stop (shorts) | 5%/2.5% trailing for shorts, disabled short re-entries | Adopted |
| V6d | Trailing Both | +trailing stop for longs, +late entry 6 bars | Adopted |
| V7 | EMA Cooldown Sweep | 0/4H/8H/12H/24H/48H cooldown. **24H (6 bars) won on both daily and 4H.** | V7_COOLDOWN_24H adopted |
| V8/V8b | EMA Spread / ADX Scaling | Entry filters based on EMA spread | **Rejected** |
| V9 | ATR Multiplier Sweep | 1.3x/1.5x/1.75x/2.0x ATR stop | V9_ATR_2_0X created but **ATR stops never implemented in prod** |
| V9-EQ | Equities/Commodities | Tighter trailing (3%/1.5%) | Adopted for non-crypto |
| PROD_ACTUAL | Production Match | Fixed 8% stop, no grace period, no ATR dynamics | **Current production** |

---

## Backtest Results Log

### 4H Bar Results (trustworthy — matches production timeframe)

| Date | Config | Assets | Days | Positions | Total P&L | Win Rate | Notes |
|------|--------|--------|------|-----------|-----------|----------|-------|
| 2026-03-21 | PROD_ACTUAL | BTC/ETH/HYPE/SOL | 730 | 506 | +$1,580 | 38.9% | Position-level, includes trims. BB2: -$165 |
| 2026-03-21 | PROD_ACTUAL (bear only) | BTC/ETH/HYPE/SOL | ~160 (Oct 25-Mar 26) | 51 | +$619 | 72.5% | Bear/choppy period isolation |

### Daily Bar Results (legacy — understates trade frequency, use for reference only)

| Date | Config | Assets | Days | Trades | Total P&L | Win Rate | Notes |
|------|--------|--------|------|--------|-----------|----------|-------|
| 2026-03-20 | V9_ATR_2_0X | BTC/ETH/HYPE/SOL | 730 | 253 | +$1,092 | 60% | Trade-level (not position-level) |
| 2026-03-21 | PROD_ACTUAL | BTC/ETH/HYPE/SOL | 730 | 97 | +$790 | 52.6% | Trade-level |

### BB2 Results (30-min bars — limited data)

| Date | Config | Assets | Days | Trades | Total P&L | Win Rate | Notes |
|------|--------|--------|------|--------|-----------|----------|-------|
| 2026-03-21 | Current (8h hold, 3% stop) | BTC/ETH/HYPE/SOL | 104 | 920 | +$457 | ~52% | 30-min native. Bull: +$288, Bear: -$646 |

---

## Disproven Hypotheses (2026-03-21 session)

> These all looked promising on daily bars but failed on proper 4H integrated simulation.

| Hypothesis | Daily Bar Result | 4H Integrated Result | Why It Failed |
|------------|-----------------|---------------------|---------------|
| Remove trailing stop entirely | +$965 (730d) | -$214 (bear period) | Bull market artifact. Trail protects in chop. |
| 7d trailing stop delay | +$4,301 (wrapper) | -$499 (integrated) | Wrapper couldn't model blocked re-entries. |
| 48h EMA cooldown | +$605 vs 24h | -$304 vs 24h | Daily bar artifact. On 4H, 48h blocks winning trades. |
| No trailing stop + scaling-in | +$3,271 (wrapper) | Not tested integrated | Combined wrapper result, likely also inflated. |

---

## Validated Improvements (ready to implement)

| Change | P&L Impact (4H) | Confidence | Implementation |
|--------|-----------------|------------|----------------|
| Skip entries when \|momentum\| > 10% | +$683 (24 trades removed) | High | New filter in signal-engine.ts |
| Skip entries when ATR > 8% | +$599 (5 HYPE trades removed) | High (HYPE-specific, useful for new listings) | New filter in signal-engine.ts |

## BB2 Improvements (validated on 30-min, limited data)

| Change | P&L Impact (30-min) | Confidence | Implementation |
|--------|---------------------|------------|----------------|
| Stop 3% → 1.5% | +$497 | Medium (104 days) | Config change in scanner-30m |
| Hold 8h → 16h | +$376 | Medium (104 days) | Config change in scanner-30m |
| Direction-align with SMA-50 regime | avoids -$646 bear drag | Medium (104 days) | New gate in scanner-30m |

---

## Active Research

### Losing Position Patterns (2026-03-21)
- 70.8% of losers were NEVER profitable from bar 1
- Best predictive features: bb_position > 0.9, RSI at entry > 53, vol_ratio < 1.42, momentum > 1.64%
- Compound filter needed — no single feature is precise enough
- ETH longs are structurally weak (19.2% win rate vs 43.7% for ETH shorts)

### Scaling-In (2026-03-21)
- Signal-driven adds (Option 1) showed +$131 standalone on 4H
- Only viable on un-trimmed positions (sequence gate)
- Deferred until main filters are implemented and validated

### BB2 Direction-Aware Filtering
- Signal color alignment doesn't work — all BB2 fires during GREY signals
- SMA-50 alignment doesn't work on 4H — bands naturally align with trend
- Must be tested on 30-min data (where regime effects are visible)
- Need to start logging 30-min candles for future analysis

### Bar-1 Loser Prediction
- Compound filter combining bb_position + vol_ratio + momentum could catch 30%+ of "never profitable" trades
- Needs careful tuning to avoid filtering winners with similar entry features

---

## Backtest Scripts

| Script | Purpose | Bar Size |
|--------|---------|----------|
| `backtest.py` | Main backtest engine, all configs | Daily or 4H |
| `strategy_comparison_4h.py` | Compare all configs on 4H bars | 4H |
| `cooldown_sweep_4h.py` | EMA cooldown optimization | 4H |
| `bb2_analysis_30m.py` | BB2 trade analysis on native timeframe | 30-min |
| `bb2_analysis_4h.py` | BB2 analysis (limited utility) | 4H |
| `loser_analysis_4h.py` | Losing position commonalities | 4H |
| `momentum_filter_analysis.py` | Momentum + bar-1 loser patterns | 4H |
| `bear_market_backtest.py` | Bear period isolation test | Daily |
| `bear_market_7d_trail.py` | 7d trail in bear conditions | Daily |
| `audit_trim_pnl.py` | Trim P&L accounting verification | 4H |
| `hold_time_backtest.py` | Hold time vs trailing stop variants | Daily |
| `trailing_stop_variants_backtest.py` | ATR/time/direction trail variants | Daily |
| `v10_candidate_backtest.py` | Combined 7d trail + scaling-in | Daily |
| `combined_strategy_backtest.py` | No trail + scaling-in combined | Daily |
| `prod_baseline_rerun.py` | PROD_ACTUAL baseline validation | Daily |
| `test_integrated_7d_trail.py` | Integrated (not wrapper) 7d trail | Daily |
| `test_4h_bars.py` | 4H data validation and comparison | 4H |
| `sequence_gate_analysis.py` | Scaling-in sequence gate viability | Daily |
| `scaling_in_backtest.py` | Scaling-in options comparison | Daily |
| `atr_filter_analysis.py` | ATR threshold filter analysis | 4H |
