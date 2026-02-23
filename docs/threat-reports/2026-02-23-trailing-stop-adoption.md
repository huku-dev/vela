# Threat Report: V6a Trailing Stop Adoption

> **Date:** 2026-02-23
> **Feature:** Trailing stop for short positions — tracks peak profit and closes if profit retraces beyond threshold
> **Test file:** `scripts/test_backtest.py`
> **Tests added:** 9 adversarial tests (TRAIL-ADV prefix), 21 additional functional tests

---

## Summary

The V6a trailing stop adds a new exit mechanism for short positions in the backtest engine. When a short position's unrealized profit reaches 5% (activation threshold), the system begins tracking the peak profit. If the profit retraces by 2.5% or more from the peak, the position is closed with reason `"trailing_stop"`. This feature has an attack surface because: (1) it introduces mutable state (`short_peak_profit`) that persists across bars and must reset correctly, (2) it modifies signal flow by overriding `color`/`reason` variables that control position lifecycle, and (3) incorrect behavior could cause premature closes (lost opportunity) or missed closes (lost profit).

---

## Threat Matrix

### THREAT-1: Trailing Stop Fires on Long Position

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Category** | Scope leakage |
| **Attack scenario** | If the trailing stop guard `open_short is not None` were missing or miscoded, a profitable long position that retraces could trigger the trailing stop, closing the long prematurely on a `"green"` signal (which is the ENTRY signal for longs, not exit). |
| **Defense mechanism** | Guard clause at line 1227: `if trailing_stop_short and open_short is not None and color != "green"`. The `open_short is not None` check restricts to short positions only. Long positions use `open_long` which is a separate variable. |
| **Test name** | `TRAIL-ADV-1: test_ADV_never_fires_on_long` |
| **Residual risk** | None. Long and short position objects are entirely separate variables. |

### THREAT-2: Disabled Config Still Triggers

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Category** | Guard bypass |
| **Attack scenario** | If the `trailing_stop_short` boolean check were bypassed or defaulted to True, configs that should not use trailing stops (V5f, V4, etc.) would have their shorts closed prematurely. |
| **Defense mechanism** | Guard clause at line 1227: `if trailing_stop_short and ...`. The variable defaults to `False` at line 1156: `config.get("trailing_stop_short", False)`. Only V6a/V6c configs set it to True. |
| **Test name** | `TRAIL-ADV-2: test_ADV_disabled_config_never_triggers` |
| **Residual risk** | None. Default is False, feature is opt-in. |

### THREAT-3: Peak Profit State Leaks Between Trades

| Field | Value |
|---|---|
| **Severity** | High |
| **Category** | Accidental amplification |
| **Attack scenario** | If `short_peak_profit` is not reset when a short closes or a new short opens, the next short inherits the peak from the previous trade. This could cause the trailing stop to fire immediately on a new trade (if the inherited peak is high), or never fire (if the inherited peak makes the retrace calculation wrong). |
| **Defense mechanism** | `short_peak_profit = 0.0` is set at 4 locations: (1) initialization before the main loop, (2) short close via green signal, (3) short close via yellow event, (4) short open (both DCA and non-DCA paths). |
| **Test name** | `STATE-1: test_peak_resets_after_trailing_close`, `STATE-2: test_peak_resets_after_green_close`, `STATE-4: test_consecutive_trailing_stops_independent` |
| **Residual risk** | Low. If a new short close path is added in the future without resetting `short_peak_profit`, the state could leak. Mitigated by the 4-location reset pattern. |

### THREAT-4: Short Re-entry Despite Gate

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Category** | Guard bypass |
| **Attack scenario** | If `pullback_reentry_short` config is ignored, short positions closed by trailing stop could immediately re-enter, amplifying losses (the original re-entry problem that cost -$305 in V5f). |
| **Defense mechanism** | Per-direction gate at line 1165: `pullback_reentry_short_enabled = config.get("pullback_reentry_short", pullback_reentry_enabled)`. All V6 configs set `pullback_reentry_short: False`. The gate is checked before any short re-entry logic. |
| **Test name** | `TRAIL-ADV-3: test_ADV_reentry_gate_blocks_short_reentry` |
| **Residual risk** | None. Gate defaults to the global `pullback_reentry_enabled` which is a safe fallback. |

### THREAT-5: Zero/Negative Profit Activates Trailing Stop

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Category** | Guard bypass |
| **Attack scenario** | If zero or negative profit values could satisfy `short_peak_profit >= trailing_stop_activation`, the trailing stop could fire on losing positions, closing them with reason "trailing_stop" instead of letting them run to ATR stop or EMA cross. |
| **Defense mechanism** | Activation check: `short_peak_profit >= trailing_stop_activation` (default 5.0%). Zero and negative profits can never reach 5%. The peak only ratchets upward (`if current_profit > short_peak_profit`), so negative values can't corrupt the peak. |
| **Test name** | `TRAIL-ADV-4: test_ADV_zero_profit_does_not_activate`, `TRAIL-ADV-5: test_ADV_negative_profit_does_not_activate` |
| **Residual risk** | None. Standard float comparison handles this correctly. |

### THREAT-6: Extreme Price Movements Cause Arithmetic Errors

| Field | Value |
|---|---|
| **Severity** | Low |
| **Category** | Runtime error |
| **Attack scenario** | Very large prices (BTC at $50,000) or very small prices (sub-cent tokens) could cause floating point overflow, underflow, or division-by-zero in the profit calculation `((entry_price - price) / entry_price) * 100`. |
| **Defense mechanism** | Standard Python float64 arithmetic handles the range. Division by entry_price is safe because entry_price is always > 0 (it's a market price). The calculation is the same formula used throughout the backtest for all P&L calculations. |
| **Test name** | `TRAIL-ADV-6: test_ADV_extreme_large_price`, `TRAIL-ADV-7: test_ADV_extreme_small_price` |
| **Residual risk** | None for standard price ranges. Theoretical edge case: entry_price = 0 would cause division by zero, but this can't happen with real market data. |

### THREAT-7: Hardcoded Parameters Bypass Config

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Category** | Guard bypass |
| **Attack scenario** | If activation and trail thresholds were hardcoded instead of read from config, users/developers couldn't tune the trailing stop behavior, and config changes would silently fail. |
| **Defense mechanism** | All params read from config dict: `config.get("trailing_stop_activation_pct", 5.0)` and `config.get("trailing_stop_trail_pct", 2.5)`. Defaults are sensible fallbacks, not hardcoded behavior. |
| **Test name** | `TRAIL-ADV-8: test_ADV_custom_params_respected` |
| **Residual risk** | None. Config-driven with safe defaults. |

---

## Severity Guide

- **Critical** — Direct fund loss, position manipulation, or unauthorized trade execution.
- **High** — Could lead to fund loss under specific conditions (race window, stale state).
- **Medium** — Data integrity issue that could mislead users or corrupt audit trail.
- **Low** — UX issue, information leak, or edge case that degrades trust but doesn't move money.

---

## Architecture Notes

**Defense-in-depth for exit priority:** The trailing stop is the THIRD check in the exit priority chain: (1) ATR stop-loss (absolute loss protection), (2) EMA cross signal (trend reversal), (3) trailing stop (profit protection). Each sets `color = "green"` and subsequent checks are guarded by `color != "green"`, ensuring strict priority ordering.

**State management pattern:** `short_peak_profit` follows the same reset pattern as other per-position state variables (`ladder_trims_short`, `reentry_pieces_short`, etc.) — reset on both close and open. This is consistent with the existing codebase pattern.

**Backtest-only scope (current phase):** The trailing stop is currently implemented only in the backtest engine (`scripts/backtest.py`). Production signal engine implementation (in `crypto-agent-backend`) is a separate phase. The production implementation will require: (1) `peak_profit_pct` column on `paper_trades` and `positions` tables, (2) trailing stop check in both the 4H signal loop and the 2-minute position monitor, (3) `"trailing_stop"` added to the `SignalReason` TypeScript type.

**Long trade isolation verified:** All 5 long-isolation tests confirm that V6a makes zero changes to long/buy trade behavior. The trailing stop code path is completely isolated to short positions via the `open_short is not None` guard.
