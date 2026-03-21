#!/usr/bin/env python3
"""
Trailing Stop Variants Backtest
===============================
Tests 3 alternative trailing stop designs against the V9_ATR_2_0X baseline
and a "no trailing stop" variant.

Variant 1: ATR-scaled trailing stop (entry-time ATR, fixed for trade duration)
  - Activation: Nx ATR(14) profit, Trail: Mx ATR(14)
  - Multipliers: (1.5/0.75), (2.0/1.0), (2.5/1.25), (3.0/1.5)

Variant 2: Time-delayed trailing stop
  - Standard 5%/2.5% trailing, but only activates after N days
  - Delays: 7d, 10d, 14d, 21d

Variant 3: Direction-specific trailing stop
  - Shorts trail / Longs no trail (and vice versa)

Usage:
    python scripts/trailing_stop_variants_backtest.py
"""

import sys
import time
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

# Import infrastructure from the main backtest module
sys.path.insert(0, str(Path(__file__).resolve().parent))
from backtest import (
    ASSETS_HL,
    HL_SLEEP_SECONDS,
    POSITION_SIZE_USD,
    V9_ATR_2_0X,
    calculate_indicators,
    evaluate_signal,
    check_yellow_events,
    fetch_ohlc,
    generate_signals,
    _snapshot_indicators,
)

# ---------------------------------------------------------------------------
# Config variants
# ---------------------------------------------------------------------------

# Baseline: V9_ATR_2_0X (current production)
BASELINE = {**V9_ATR_2_0X, "name": "Baseline (V9_ATR_2_0X)"}

# No trailing stop at all
NO_TRAIL = {
    **V9_ATR_2_0X,
    "name": "No Trailing Stop",
    "trailing_stop_short": False,
    "trailing_stop_long": False,
}

# -- Variant 1: ATR-scaled trailing (entry-time ATR, fixed) --
# We use a custom flag "trailing_stop_entry_atr" to signal our modified
# simulate_trades to capture ATR at entry and use it throughout.
V1_ATR_1_5_0_75 = {
    **V9_ATR_2_0X,
    "name": "V1: ATR Trail 1.5x/0.75x",
    "trailing_stop_atr_mode": False,  # disable per-bar ATR mode
    "trailing_stop_entry_atr": True,  # our custom flag
    "trailing_stop_entry_atr_activation": 1.5,
    "trailing_stop_entry_atr_trail": 0.75,
}

V1_ATR_2_0_1_0 = {
    **V9_ATR_2_0X,
    "name": "V1: ATR Trail 2.0x/1.0x",
    "trailing_stop_atr_mode": False,
    "trailing_stop_entry_atr": True,
    "trailing_stop_entry_atr_activation": 2.0,
    "trailing_stop_entry_atr_trail": 1.0,
}

V1_ATR_2_5_1_25 = {
    **V9_ATR_2_0X,
    "name": "V1: ATR Trail 2.5x/1.25x",
    "trailing_stop_atr_mode": False,
    "trailing_stop_entry_atr": True,
    "trailing_stop_entry_atr_activation": 2.5,
    "trailing_stop_entry_atr_trail": 1.25,
}

V1_ATR_3_0_1_5 = {
    **V9_ATR_2_0X,
    "name": "V1: ATR Trail 3.0x/1.5x",
    "trailing_stop_atr_mode": False,
    "trailing_stop_entry_atr": True,
    "trailing_stop_entry_atr_activation": 3.0,
    "trailing_stop_entry_atr_trail": 1.5,
}

# -- Variant 2: Time-delayed trailing stop --
# Uses the standard 5%/2.5% trailing, but only activates after N days.
# Each bar = 4 hours, so days * 6 = bars.
V2_DELAY_7D = {
    **V9_ATR_2_0X,
    "name": "V2: Trail after 7d",
    "trailing_stop_atr_mode": False,  # use fixed 5%/2.5%
    "trailing_stop_activation_pct": 5.0,
    "trailing_stop_trail_pct": 2.5,
    "trailing_stop_delay_bars": 7 * 6,  # 42 bars = 7 days
}

V2_DELAY_10D = {
    **V9_ATR_2_0X,
    "name": "V2: Trail after 10d",
    "trailing_stop_atr_mode": False,
    "trailing_stop_activation_pct": 5.0,
    "trailing_stop_trail_pct": 2.5,
    "trailing_stop_delay_bars": 10 * 6,
}

V2_DELAY_14D = {
    **V9_ATR_2_0X,
    "name": "V2: Trail after 14d",
    "trailing_stop_atr_mode": False,
    "trailing_stop_activation_pct": 5.0,
    "trailing_stop_trail_pct": 2.5,
    "trailing_stop_delay_bars": 14 * 6,
}

V2_DELAY_21D = {
    **V9_ATR_2_0X,
    "name": "V2: Trail after 21d",
    "trailing_stop_atr_mode": False,
    "trailing_stop_activation_pct": 5.0,
    "trailing_stop_trail_pct": 2.5,
    "trailing_stop_delay_bars": 21 * 6,
}

# -- Variant 3: Direction-specific trailing stop --
V3_SHORT_ONLY = {
    **V9_ATR_2_0X,
    "name": "V3: Trail shorts only",
    "trailing_stop_short": True,
    "trailing_stop_long": False,
}

V3_LONG_ONLY = {
    **V9_ATR_2_0X,
    "name": "V3: Trail longs only",
    "trailing_stop_short": False,
    "trailing_stop_long": True,
}

ALL_CONFIGS = [
    BASELINE,
    NO_TRAIL,
    # Variant 1: ATR-scaled
    V1_ATR_1_5_0_75,
    V1_ATR_2_0_1_0,
    V1_ATR_2_5_1_25,
    V1_ATR_3_0_1_5,
    # Variant 2: Time-delayed
    V2_DELAY_7D,
    V2_DELAY_10D,
    V2_DELAY_14D,
    V2_DELAY_21D,
    # Variant 3: Direction-specific
    V3_SHORT_ONLY,
    V3_LONG_ONLY,
]

ASSETS = ["bitcoin", "ethereum", "hyperliquid", "solana"]
DAYS = 730
POSITION_SIZE = 1000


# ---------------------------------------------------------------------------
# Modified simulate_trades with entry-time ATR trailing stop support
# ---------------------------------------------------------------------------

def simulate_trades_v11(
    df: pd.DataFrame,
    position_size: float = POSITION_SIZE,
    config: dict = BASELINE,
    btc_df: pd.DataFrame | None = None,
    is_btc: bool = False,
) -> list[dict]:
    """
    Modified simulate_trades that supports Variant 1 (entry-time ATR trailing stop).

    The key difference from the original: when `trailing_stop_entry_atr` is True,
    ATR(14) is captured at entry time and stays fixed for the trade duration,
    rather than using the current bar's ATR.

    All other behavior is identical to the original simulate_trades.
    """
    trades: list[dict] = []
    open_long: dict | None = None
    open_short: dict | None = None
    long_remaining_frac: float = 1.0
    short_remaining_frac: float = 1.0
    trim_mode = config.get("trim_mode", "pct_of_remaining")

    # RSI BB complementary trades
    bb_open_long: dict | None = None
    bb_open_short: dict | None = None
    bb_long_bars: int = 0
    bb_short_bars: int = 0
    bb_hold_days = config.get("rsi_bb_hold_days", 5)
    rsi_bb_enabled = config.get("rsi_bb_complementary", False)
    bb_trend_filter = config.get("rsi_bb_trend_filter", False)
    bb_cooldown_days = config.get("rsi_bb_cooldown_days", 0)
    bb_long_cooldown_until: int = -1
    bb_short_cooldown_until: int = -1

    # EMA cooldown after stop-loss
    ema_cooldown_bars = config.get("ema_cooldown_bars", 0)
    ema_long_cooldown_until: int = -1
    ema_short_cooldown_until: int = -1

    # Confirmation gates
    confirmation_bars = config.get("confirmation_bars", 0)
    consecutive_green: int = 0
    consecutive_red: int = 0
    pending_green_entry: dict | None = None
    pending_red_entry: dict | None = None

    # RSI velocity
    rsi_velocity_enabled = config.get("rsi_velocity_enabled", False)
    rsi_velocity_threshold = config.get("rsi_velocity_threshold", 15)
    rsi_velocity_action = config.get("rsi_velocity_action", "warn")

    # BTC crash filter
    btc_crash_enabled = config.get("btc_crash_filter", False) and not is_btc and btc_df is not None
    btc_crash_threshold = config.get("btc_crash_threshold", -5.0)

    # Profit ladder
    profit_ladder_enabled = config.get("profit_ladder_enabled", False)
    profit_ladder_levels = config.get("profit_ladder_levels", [15, 25, 35])
    profit_ladder_fractions = config.get("profit_ladder_fractions", [0.10, 0.10, 0.10])
    ladder_trims_long: list[int] = []
    ladder_trims_short: list[int] = []

    # Pullback re-entry
    pullback_reentry_enabled = config.get("pullback_reentry", False)
    pullback_ema_buffer_pct = config.get("pullback_ema_buffer_pct", 0.5)
    pullback_min_profit_pct = config.get("pullback_min_profit_pct", 5.0)
    pullback_add_frac = config.get("pullback_add_frac", 0.25)
    pullback_max_adds = config.get("pullback_max_adds", 2)
    reentry_pieces_long: list[dict] = []
    reentry_pieces_short: list[dict] = []
    pullback_adds_long: int = 0
    pullback_adds_short: int = 0

    # DCA
    dca_enabled = config.get("dca_enabled", False)
    dca_tranches = config.get("dca_tranches", [0.25, 0.25, 0.25, 0.25])
    dca_interval_bars = config.get("dca_interval_bars", 2)
    dca_max_adverse_pct = config.get("dca_max_adverse_pct", 3.0)
    dca_active_long: bool = False
    dca_active_short: bool = False
    dca_tranche_idx_long: int = 0
    dca_tranche_idx_short: int = 0
    dca_last_fill_bar_long: int = -999
    dca_last_fill_bar_short: int = -999
    dca_first_entry_price_long: float = 0.0
    dca_first_entry_price_short: float = 0.0

    # BB2
    bb2_enabled = config.get("bb_improved", False)
    bb2_hold_days = config.get("bb_improved_hold_days", 2)
    bb2_stop_pct = config.get("bb_improved_stop_pct", 3.0)
    bb2_position_mult = config.get("bb_improved_position_mult", 0.3)
    bb2_cooldown_days = config.get("bb_improved_cooldown_days", 2)
    bb2_open_long: dict | None = None
    bb2_open_short: dict | None = None
    bb2_long_bars: int = 0
    bb2_short_bars: int = 0
    bb2_long_cooldown_until: int = -1
    bb2_short_cooldown_until: int = -1

    # Trailing stop config
    trailing_stop_short = config.get("trailing_stop_short", False)
    trailing_stop_long = config.get("trailing_stop_long", False)
    trailing_stop_activation = config.get("trailing_stop_activation_pct", 5.0)
    trailing_stop_trail = config.get("trailing_stop_trail_pct", 2.5)
    trailing_stop_atr_mode = config.get("trailing_stop_atr_mode", False)
    trailing_stop_atr_activation = config.get("trailing_stop_atr_activation", 1.5)
    trailing_stop_atr_trail = config.get("trailing_stop_atr_trail", 0.75)
    trailing_stop_delay_bars = config.get("trailing_stop_delay_bars", 0)

    # NEW: Entry-time ATR trailing stop (Variant 1)
    entry_atr_mode = config.get("trailing_stop_entry_atr", False)
    entry_atr_activation_mult = config.get("trailing_stop_entry_atr_activation", 2.0)
    entry_atr_trail_mult = config.get("trailing_stop_entry_atr_trail", 1.0)

    short_peak_profit: float = 0.0
    long_peak_profit: float = 0.0

    # Entry-time ATR values (captured at position open, fixed for duration)
    long_entry_atr_pct: float = 0.0
    short_entry_atr_pct: float = 0.0

    # Per-direction ladder/reentry config
    short_ladder_levels = config.get("short_ladder_levels", profit_ladder_levels)
    short_ladder_fractions = config.get("short_ladder_fractions", profit_ladder_fractions)
    pullback_reentry_short_enabled = config.get("pullback_reentry_short", pullback_reentry_enabled)

    for bar_idx, (date, row) in enumerate(df.iterrows()):
        price = row["close"]
        rsi14 = row["rsi_14"]

        # ── BTC crash filter ──
        if btc_crash_enabled and open_long is not None:
            if date in btc_df.index:
                btc_return = btc_df.loc[date].get("daily_return_pct", 0)
                if not pd.isna(btc_return) and btc_return <= btc_crash_threshold:
                    entry_price = open_long["entry_price"]
                    pnl_pct = round(((price - entry_price) / entry_price) * 100, 2)
                    pnl_usd = round(long_remaining_frac * pnl_pct / 100 * position_size, 2)
                    trades.append({
                        **open_long,
                        "exit_date": str(date),
                        "exit_price": round(price, 2),
                        "exit_signal_color": "red",
                        "exit_signal_reason": f"btc_crash ({btc_return:+.1f}%)",
                        "pnl_pct": pnl_pct,
                        "pnl_usd": pnl_usd,
                        "remaining_pct": round(long_remaining_frac * 100, 1),
                        "status": "closed",
                        "exit_indicators": _snapshot_indicators(row),
                    })
                    open_long = None
                    long_remaining_frac = 1.0
                    long_peak_profit = 0.0
                    long_entry_atr_pct = 0.0
                    continue

        # Evaluate signal
        color, reason = evaluate_signal(
            row, open_trade=open_long, config=config, bar_index=bar_idx
        )

        # Short stop-loss check
        if open_short is not None and color != "green":
            short_color, short_reason = evaluate_signal(
                row, open_trade=open_short, config=config, bar_index=bar_idx
            )
            if short_color == "green" and short_reason in ("atr_stop_loss", "stop_loss"):
                color, reason = short_color, short_reason

        # ── Trailing stop for SHORTS ──
        _short_bars_held = (bar_idx - open_short["entry_bar_index"]) if open_short is not None else 0
        if trailing_stop_short and open_short is not None and color != "green" and _short_bars_held >= trailing_stop_delay_bars:
            entry_price = open_short["entry_price"]
            current_profit = ((entry_price - price) / entry_price) * 100
            if current_profit > short_peak_profit:
                short_peak_profit = current_profit

            # Determine activation/trail thresholds
            _ts_activation = trailing_stop_activation
            _ts_trail = trailing_stop_trail
            if entry_atr_mode and short_entry_atr_pct > 0:
                # Variant 1: use entry-time ATR (fixed)
                _ts_activation = short_entry_atr_pct * entry_atr_activation_mult
                _ts_trail = short_entry_atr_pct * entry_atr_trail_mult
            elif trailing_stop_atr_mode:
                # Original: use current bar's ATR
                _bar_atr = row.get("atr_pct", float("nan"))
                if not pd.isna(_bar_atr):
                    _ts_activation = _bar_atr * trailing_stop_atr_activation
                    _ts_trail = _bar_atr * trailing_stop_atr_trail

            if (short_peak_profit >= _ts_activation
                    and (short_peak_profit - current_profit) >= _ts_trail):
                color, reason = "green", "trailing_stop"

        # ── Trailing stop for LONGS ──
        _long_bars_held = (bar_idx - open_long["entry_bar_index"]) if open_long is not None else 0
        if trailing_stop_long and open_long is not None and color != "red" and _long_bars_held >= trailing_stop_delay_bars:
            entry_price = open_long["entry_price"]
            current_profit = ((price - entry_price) / entry_price) * 100
            if current_profit > long_peak_profit:
                long_peak_profit = current_profit

            _ts_activation = trailing_stop_activation
            _ts_trail = trailing_stop_trail
            if entry_atr_mode and long_entry_atr_pct > 0:
                _ts_activation = long_entry_atr_pct * entry_atr_activation_mult
                _ts_trail = long_entry_atr_pct * entry_atr_trail_mult
            elif trailing_stop_atr_mode:
                _bar_atr = row.get("atr_pct", float("nan"))
                if not pd.isna(_bar_atr):
                    _ts_activation = _bar_atr * trailing_stop_atr_activation
                    _ts_trail = _bar_atr * trailing_stop_atr_trail

            if (long_peak_profit >= _ts_activation
                    and (long_peak_profit - current_profit) >= _ts_trail):
                color, reason = "red", "trailing_stop"

        # ── Profit ladder ──
        trimmed_this_bar = False

        if profit_ladder_enabled and open_long is not None and long_remaining_frac > 0.1:
            entry_price = open_long["entry_price"]
            profit_pct = ((price - entry_price) / entry_price) * 100
            for lvl_idx, (level, frac) in enumerate(zip(profit_ladder_levels, profit_ladder_fractions)):
                if lvl_idx not in ladder_trims_long and profit_pct >= level:
                    trim_of_original = min(frac, long_remaining_frac)
                    if trim_of_original > 0.01:
                        trim_usd = round(trim_of_original * position_size * profit_pct / 100, 2)
                        trades.append({
                            "direction": "trim",
                            "entry_date": open_long["entry_date"],
                            "entry_price": open_long["entry_price"],
                            "entry_signal_color": "green",
                            "entry_signal_reason": "ema_cross_up",
                            "entry_indicators": open_long["entry_indicators"],
                            "exit_date": str(date),
                            "exit_price": round(price, 2),
                            "exit_signal_color": "green",
                            "exit_signal_reason": f"ladder_{level}pct",
                            "pnl_pct": round(profit_pct, 2),
                            "pnl_usd": trim_usd,
                            "trim_pct": round(trim_of_original * 100, 1),
                            "status": "closed",
                            "exit_indicators": _snapshot_indicators(row),
                        })
                        long_remaining_frac -= trim_of_original
                        ladder_trims_long.append(lvl_idx)
                        trimmed_this_bar = True

        if profit_ladder_enabled and open_short is not None and short_remaining_frac > 0.1:
            entry_price = open_short["entry_price"]
            profit_pct = ((entry_price - price) / entry_price) * 100
            for lvl_idx, (level, frac) in enumerate(zip(short_ladder_levels, short_ladder_fractions)):
                if lvl_idx not in ladder_trims_short and profit_pct >= level:
                    trim_of_original = min(frac, short_remaining_frac)
                    if trim_of_original > 0.01:
                        trim_usd = round(trim_of_original * position_size * profit_pct / 100, 2)
                        trades.append({
                            "direction": "trim",
                            "entry_date": open_short["entry_date"],
                            "entry_price": open_short["entry_price"],
                            "entry_signal_color": "red",
                            "entry_signal_reason": "ema_cross_down",
                            "entry_indicators": open_short["entry_indicators"],
                            "exit_date": str(date),
                            "exit_price": round(price, 2),
                            "exit_signal_color": "green",
                            "exit_signal_reason": f"ladder_{level}pct",
                            "pnl_pct": round(profit_pct, 2),
                            "pnl_usd": trim_usd,
                            "trim_pct": round(trim_of_original * 100, 1),
                            "status": "closed",
                            "exit_indicators": _snapshot_indicators(row),
                        })
                        short_remaining_frac -= trim_of_original
                        ladder_trims_short.append(lvl_idx)
                        trimmed_this_bar = True

        # ── Yellow events: partial trim on LONG ──
        if open_long is not None and long_remaining_frac > 0.1 and not trimmed_this_bar:
            yellow_event = check_yellow_events(rsi14, direction="long", config=config)
            if yellow_event is not None:
                entry_price = open_long["entry_price"]
                pnl_pct_at_trim = round(((price - entry_price) / entry_price) * 100, 2)
                if yellow_event == "strong_take_profit":
                    raw_trim_frac = config["trim_pct_orange"]
                else:
                    raw_trim_frac = config["trim_pct_yellow"]
                if trim_mode == "pct_of_original":
                    trim_of_original = min(raw_trim_frac, long_remaining_frac)
                else:
                    trim_of_original = round(long_remaining_frac * raw_trim_frac, 4)
                trim_usd = round(trim_of_original * position_size * pnl_pct_at_trim / 100, 2)
                if trim_of_original > 0.05:
                    trades.append({
                        "direction": "trim",
                        "entry_date": open_long["entry_date"],
                        "entry_price": open_long["entry_price"],
                        "entry_signal_color": "green",
                        "entry_signal_reason": "ema_cross_up",
                        "entry_indicators": open_long["entry_indicators"],
                        "exit_date": str(date),
                        "exit_price": round(price, 2),
                        "exit_signal_color": "yellow",
                        "exit_signal_reason": yellow_event,
                        "pnl_pct": pnl_pct_at_trim,
                        "pnl_usd": trim_usd,
                        "trim_pct": round(trim_of_original * 100, 1),
                        "status": "closed",
                        "exit_indicators": _snapshot_indicators(row),
                    })
                    long_remaining_frac -= trim_of_original

        # ── Yellow events: partial cover on SHORT ──
        if open_short is not None and short_remaining_frac > 0.1 and not trimmed_this_bar:
            yellow_event = check_yellow_events(rsi14, direction="short", config=config)
            if yellow_event is not None:
                entry_price = open_short["entry_price"]
                pnl_pct_at_trim = round(((entry_price - price) / entry_price) * 100, 2)
                if yellow_event == "strong_take_profit":
                    raw_trim_frac = config["trim_pct_orange"]
                else:
                    raw_trim_frac = config["trim_pct_yellow"]
                if trim_mode == "pct_of_original":
                    trim_of_original = min(raw_trim_frac, short_remaining_frac)
                else:
                    trim_of_original = round(short_remaining_frac * raw_trim_frac, 4)
                trim_usd = round(trim_of_original * position_size * pnl_pct_at_trim / 100, 2)
                if trim_of_original > 0.05:
                    trades.append({
                        "direction": "trim",
                        "entry_date": open_short["entry_date"],
                        "entry_price": open_short["entry_price"],
                        "entry_signal_color": "red",
                        "entry_signal_reason": "ema_cross_down",
                        "entry_indicators": open_short["entry_indicators"],
                        "exit_date": str(date),
                        "exit_price": round(price, 2),
                        "exit_signal_color": "yellow",
                        "exit_signal_reason": yellow_event,
                        "pnl_pct": pnl_pct_at_trim,
                        "pnl_usd": trim_usd,
                        "trim_pct": round(trim_of_original * 100, 1),
                        "status": "closed",
                        "exit_indicators": _snapshot_indicators(row),
                    })
                    short_remaining_frac -= trim_of_original

        # ── RSI velocity ──
        if rsi_velocity_enabled and not trimmed_this_bar:
            rsi_delta = row.get("rsi_delta", 0)
            if not pd.isna(rsi_delta) and abs(rsi_delta) >= rsi_velocity_threshold:
                if rsi_delta > 0 and rsi14 > 60 and open_long is not None and long_remaining_frac > 0.1:
                    if rsi_velocity_action == "close":
                        entry_price = open_long["entry_price"]
                        pnl_pct = round(((price - entry_price) / entry_price) * 100, 2)
                        pnl_usd = round(long_remaining_frac * pnl_pct / 100 * position_size, 2)
                        trades.append({
                            **open_long,
                            "exit_date": str(date),
                            "exit_price": round(price, 2),
                            "exit_signal_color": "yellow",
                            "exit_signal_reason": f"rsi_velocity ({rsi_delta:+.0f})",
                            "pnl_pct": pnl_pct,
                            "pnl_usd": pnl_usd,
                            "remaining_pct": round(long_remaining_frac * 100, 1),
                            "status": "closed",
                            "exit_indicators": _snapshot_indicators(row),
                        })
                        open_long = None
                        long_remaining_frac = 1.0
                        long_peak_profit = 0.0
                        long_entry_atr_pct = 0.0

                if rsi_delta < 0 and rsi14 < 40 and open_short is not None and short_remaining_frac > 0.1:
                    if rsi_velocity_action == "close":
                        entry_price = open_short["entry_price"]
                        pnl_pct = round(((entry_price - price) / entry_price) * 100, 2)
                        pnl_usd = round(short_remaining_frac * pnl_pct / 100 * position_size, 2)
                        trades.append({
                            **open_short,
                            "exit_date": str(date),
                            "exit_price": round(price, 2),
                            "exit_signal_color": "yellow",
                            "exit_signal_reason": f"rsi_velocity ({rsi_delta:+.0f})",
                            "pnl_pct": pnl_pct,
                            "pnl_usd": pnl_usd,
                            "remaining_pct": round(short_remaining_frac * 100, 1),
                            "status": "closed",
                            "exit_indicators": _snapshot_indicators(row),
                        })
                        open_short = None
                        short_remaining_frac = 1.0
                        short_peak_profit = 0.0
                        short_entry_atr_pct = 0.0

        # ── Close LONG on red signal ──
        if open_long is not None and color == "red":
            entry_price = open_long["entry_price"]
            pnl_pct = round(((price - entry_price) / entry_price) * 100, 2)
            pnl_usd = round(long_remaining_frac * pnl_pct / 100 * position_size, 2)
            trades.append({
                **open_long,
                "exit_date": str(date),
                "exit_price": round(price, 2),
                "exit_signal_color": "red",
                "exit_signal_reason": reason,
                "pnl_pct": pnl_pct,
                "pnl_usd": pnl_usd,
                "remaining_pct": round(long_remaining_frac * 100, 1),
                "status": "closed",
                "exit_indicators": _snapshot_indicators(row),
            })
            for piece in reentry_pieces_long:
                piece_pnl_pct = round(((price - piece["entry_price"]) / piece["entry_price"]) * 100, 2)
                piece_pnl_usd = round(piece["frac"] * piece_pnl_pct / 100 * position_size, 2)
                trades.append({
                    "direction": "reentry",
                    "entry_date": piece["entry_date"],
                    "entry_price": piece["entry_price"],
                    "entry_signal_color": "green",
                    "entry_signal_reason": "pullback_reentry",
                    "entry_indicators": piece["entry_indicators"],
                    "exit_date": str(date),
                    "exit_price": round(price, 2),
                    "exit_signal_color": "red",
                    "exit_signal_reason": reason,
                    "pnl_pct": piece_pnl_pct,
                    "pnl_usd": piece_pnl_usd,
                    "status": "closed",
                    "exit_indicators": _snapshot_indicators(row),
                })
            if ema_cooldown_bars > 0 and reason in ("stop_loss", "atr_stop_loss"):
                ema_long_cooldown_until = bar_idx + ema_cooldown_bars
            open_long = None
            long_remaining_frac = 1.0
            long_peak_profit = 0.0
            long_entry_atr_pct = 0.0
            ladder_trims_long = []
            reentry_pieces_long = []
            pullback_adds_long = 0
            dca_active_long = False
            dca_tranche_idx_long = 0

        # ── Close SHORT on green signal ──
        if open_short is not None and color == "green":
            entry_price = open_short["entry_price"]
            pnl_pct = round(((entry_price - price) / entry_price) * 100, 2)
            pnl_usd = round(short_remaining_frac * pnl_pct / 100 * position_size, 2)
            trades.append({
                **open_short,
                "exit_date": str(date),
                "exit_price": round(price, 2),
                "exit_signal_color": "green",
                "exit_signal_reason": reason,
                "pnl_pct": pnl_pct,
                "pnl_usd": pnl_usd,
                "remaining_pct": round(short_remaining_frac * 100, 1),
                "status": "closed",
                "exit_indicators": _snapshot_indicators(row),
            })
            for piece in reentry_pieces_short:
                piece_pnl_pct = round(((piece["entry_price"] - price) / piece["entry_price"]) * 100, 2)
                piece_pnl_usd = round(piece["frac"] * piece_pnl_pct / 100 * position_size, 2)
                trades.append({
                    "direction": "reentry",
                    "entry_date": piece["entry_date"],
                    "entry_price": piece["entry_price"],
                    "entry_signal_color": "red",
                    "entry_signal_reason": "pullback_reentry",
                    "entry_indicators": piece["entry_indicators"],
                    "exit_date": str(date),
                    "exit_price": round(price, 2),
                    "exit_signal_color": "green",
                    "exit_signal_reason": reason,
                    "pnl_pct": piece_pnl_pct,
                    "pnl_usd": piece_pnl_usd,
                    "status": "closed",
                    "exit_indicators": _snapshot_indicators(row),
                })
            if ema_cooldown_bars > 0 and reason in ("stop_loss", "atr_stop_loss"):
                ema_short_cooldown_until = bar_idx + ema_cooldown_bars
            open_short = None
            short_remaining_frac = 1.0
            short_peak_profit = 0.0
            short_entry_atr_pct = 0.0
            ladder_trims_short = []
            reentry_pieces_short = []
            pullback_adds_short = 0
            dca_active_short = False
            dca_tranche_idx_short = 0

        # ── Confirmation gate ──
        ema9 = row["ema_9"]
        ema21 = row["ema_21"]

        if color == "green" and reason == "ema_cross_up":
            consecutive_green = 1
            consecutive_red = 0
            pending_green_entry = _snapshot_indicators(row)
        elif consecutive_green > 0 and ema9 > ema21:
            consecutive_green += 1
        elif consecutive_green > 0:
            consecutive_green = 0
            pending_green_entry = None

        if color == "red" and reason == "ema_cross_down":
            consecutive_red = 1
            consecutive_green = 0
            pending_red_entry = _snapshot_indicators(row)
        elif consecutive_red > 0 and ema9 < ema21:
            consecutive_red += 1
        elif consecutive_red > 0:
            consecutive_red = 0
            pending_red_entry = None

        # ── Open new positions ──
        if open_long is None and consecutive_green > 0:
            if ema_cooldown_bars > 0 and bar_idx <= ema_long_cooldown_until:
                pass
            elif confirmation_bars <= 0 or consecutive_green >= confirmation_bars:
                if confirmation_bars <= 0 and not (color == "green" and reason == "ema_cross_up"):
                    pass
                else:
                    open_long = {
                        "direction": "long",
                        "entry_date": str(date),
                        "entry_price": round(price, 2),
                        "entry_signal_color": "green",
                        "entry_signal_reason": "ema_cross_up_confirmed" if confirmation_bars > 0 else reason,
                        "entry_indicators": _snapshot_indicators(row),
                        "entry_bar_index": bar_idx,
                    }
                    long_remaining_frac = 1.0
                    long_peak_profit = 0.0
                    # Capture ATR at entry for Variant 1
                    _entry_atr = row.get("atr_pct", float("nan"))
                    long_entry_atr_pct = _entry_atr if not pd.isna(_entry_atr) else 0.0
                    consecutive_green = 0

        if open_short is None and consecutive_red > 0:
            if ema_cooldown_bars > 0 and bar_idx <= ema_short_cooldown_until:
                pass
            elif confirmation_bars <= 0 or consecutive_red >= confirmation_bars:
                if confirmation_bars <= 0 and not (color == "red" and reason == "ema_cross_down"):
                    pass
                else:
                    open_short = {
                        "direction": "short",
                        "entry_date": str(date),
                        "entry_price": round(price, 2),
                        "entry_signal_color": "red",
                        "entry_signal_reason": "ema_cross_down_confirmed" if confirmation_bars > 0 else reason,
                        "entry_indicators": _snapshot_indicators(row),
                        "entry_bar_index": bar_idx,
                    }
                    short_remaining_frac = 1.0
                    short_peak_profit = 0.0
                    _entry_atr = row.get("atr_pct", float("nan"))
                    short_entry_atr_pct = _entry_atr if not pd.isna(_entry_atr) else 0.0
                    consecutive_red = 0

        # ── Late entry ──
        if reason == "late_entry":
            if color == "green" and open_long is None:
                if ema_cooldown_bars > 0 and bar_idx <= ema_long_cooldown_until:
                    pass
                else:
                    open_long = {
                        "direction": "long",
                        "entry_date": str(date),
                        "entry_price": round(price, 2),
                        "entry_signal_color": "green",
                        "entry_signal_reason": "late_entry",
                        "entry_indicators": _snapshot_indicators(row),
                        "entry_bar_index": bar_idx,
                    }
                    long_remaining_frac = 1.0
                    long_peak_profit = 0.0
                    _entry_atr = row.get("atr_pct", float("nan"))
                    long_entry_atr_pct = _entry_atr if not pd.isna(_entry_atr) else 0.0

            elif color == "red" and open_short is None:
                if ema_cooldown_bars > 0 and bar_idx <= ema_short_cooldown_until:
                    pass
                else:
                    open_short = {
                        "direction": "short",
                        "entry_date": str(date),
                        "entry_price": round(price, 2),
                        "entry_signal_color": "red",
                        "entry_signal_reason": "late_entry",
                        "entry_indicators": _snapshot_indicators(row),
                        "entry_bar_index": bar_idx,
                    }
                    short_remaining_frac = 1.0
                    short_peak_profit = 0.0
                    _entry_atr = row.get("atr_pct", float("nan"))
                    short_entry_atr_pct = _entry_atr if not pd.isna(_entry_atr) else 0.0

        # ── Pullback re-entry for longs ──
        if (pullback_reentry_enabled and open_long is not None
                and pullback_adds_long < pullback_max_adds
                and not trimmed_this_bar):
            entry_price = open_long["entry_price"]
            profit_pct = ((price - entry_price) / entry_price) * 100
            ema21_val = row["ema_21"]
            ema_distance_pct = ((price - ema21_val) / ema21_val) * 100
            if profit_pct >= pullback_min_profit_pct and ema_distance_pct <= pullback_ema_buffer_pct:
                reentry_pieces_long.append({
                    "entry_price": round(price, 2),
                    "entry_date": str(date),
                    "frac": pullback_add_frac,
                    "entry_indicators": _snapshot_indicators(row),
                })
                pullback_adds_long += 1

        # ── Pullback re-entry for shorts ──
        if (pullback_reentry_short_enabled and open_short is not None
                and pullback_adds_short < pullback_max_adds
                and not trimmed_this_bar):
            entry_price = open_short["entry_price"]
            profit_pct = ((entry_price - price) / entry_price) * 100
            ema21_val = row["ema_21"]
            ema_distance_pct = ((ema21_val - price) / ema21_val) * 100
            if profit_pct >= pullback_min_profit_pct and ema_distance_pct <= pullback_ema_buffer_pct:
                reentry_pieces_short.append({
                    "entry_price": round(price, 2),
                    "entry_date": str(date),
                    "frac": pullback_add_frac,
                    "entry_indicators": _snapshot_indicators(row),
                })
                pullback_adds_short += 1

        # ── BB2 complementary trades ──
        if bb2_enabled:
            sma50 = row.get("sma_50", float("nan"))
            rsi_lower_bb = row.get("rsi_lower_bb", float("nan"))
            rsi_upper_bb = row.get("rsi_upper_bb", float("nan"))

            # BB2 long
            if bb2_open_long is not None:
                bb2_long_bars += 1
                bb2_entry_price = bb2_open_long["entry_price"]
                bb2_pnl_pct = ((price - bb2_entry_price) / bb2_entry_price) * 100
                if bb2_long_bars >= bb2_hold_days or bb2_pnl_pct <= -bb2_stop_pct or color == "red":
                    bb2_pnl_usd = round(bb2_position_mult * bb2_pnl_pct / 100 * position_size, 2)
                    trades.append({
                        **bb2_open_long,
                        "exit_date": str(date),
                        "exit_price": round(price, 2),
                        "exit_signal_color": "red" if bb2_pnl_pct <= -bb2_stop_pct else "grey",
                        "exit_signal_reason": "bb2_stop" if bb2_pnl_pct <= -bb2_stop_pct else "bb2_expire",
                        "pnl_pct": round(bb2_pnl_pct, 2),
                        "pnl_usd": bb2_pnl_usd,
                        "status": "closed",
                        "exit_indicators": _snapshot_indicators(row),
                    })
                    if bb2_pnl_pct <= -bb2_stop_pct:
                        bb2_long_cooldown_until = bar_idx + bb2_cooldown_days
                    bb2_open_long = None
                    bb2_long_bars = 0
            elif (not pd.isna(rsi_lower_bb) and rsi14 <= rsi_lower_bb
                    and bar_idx > bb2_long_cooldown_until
                    and open_long is None):
                if not bb_trend_filter or (not pd.isna(sma50) and price > sma50):
                    bb2_open_long = {
                        "direction": "bb2_long",
                        "entry_date": str(date),
                        "entry_price": round(price, 2),
                        "entry_signal_color": "green",
                        "entry_signal_reason": "bb2_oversold",
                        "entry_indicators": _snapshot_indicators(row),
                        "entry_bar_index": bar_idx,
                    }
                    bb2_long_bars = 0

            # BB2 short
            if bb2_open_short is not None:
                bb2_short_bars += 1
                bb2_entry_price = bb2_open_short["entry_price"]
                bb2_pnl_pct = ((bb2_entry_price - price) / bb2_entry_price) * 100
                if bb2_short_bars >= bb2_hold_days or bb2_pnl_pct <= -bb2_stop_pct or color == "green":
                    bb2_pnl_usd = round(bb2_position_mult * bb2_pnl_pct / 100 * position_size, 2)
                    trades.append({
                        **bb2_open_short,
                        "exit_date": str(date),
                        "exit_price": round(price, 2),
                        "exit_signal_color": "green" if bb2_pnl_pct <= -bb2_stop_pct else "grey",
                        "exit_signal_reason": "bb2_stop" if bb2_pnl_pct <= -bb2_stop_pct else "bb2_expire",
                        "pnl_pct": round(bb2_pnl_pct, 2),
                        "pnl_usd": bb2_pnl_usd,
                        "status": "closed",
                        "exit_indicators": _snapshot_indicators(row),
                    })
                    if bb2_pnl_pct <= -bb2_stop_pct:
                        bb2_short_cooldown_until = bar_idx + bb2_cooldown_days
                    bb2_open_short = None
                    bb2_short_bars = 0
            elif (not pd.isna(rsi_upper_bb) and rsi14 >= rsi_upper_bb
                    and bar_idx > bb2_short_cooldown_until
                    and open_short is None):
                if not bb_trend_filter or (not pd.isna(sma50) and price < sma50):
                    bb2_open_short = {
                        "direction": "bb2_short",
                        "entry_date": str(date),
                        "entry_price": round(price, 2),
                        "entry_signal_color": "red",
                        "entry_signal_reason": "bb2_overbought",
                        "entry_indicators": _snapshot_indicators(row),
                        "entry_bar_index": bar_idx,
                    }
                    bb2_short_bars = 0

    # ── Mark-to-market open positions at end ──
    if len(df) > 0:
        last_date = df.index[-1]
        last_row = df.iloc[-1]
        last_price = last_row["close"]

        if open_long is not None:
            entry_price = open_long["entry_price"]
            pnl_pct = round(((last_price - entry_price) / entry_price) * 100, 2)
            pnl_usd = round(long_remaining_frac * pnl_pct / 100 * position_size, 2)
            trades.append({
                **open_long,
                "exit_date": str(last_date),
                "exit_price": round(last_price, 2),
                "pnl_pct": pnl_pct,
                "pnl_usd": pnl_usd,
                "remaining_pct": round(long_remaining_frac * 100, 1),
                "status": "open",
                "exit_indicators": None,
            })

        if open_short is not None:
            entry_price = open_short["entry_price"]
            pnl_pct = round(((entry_price - last_price) / entry_price) * 100, 2)
            pnl_usd = round(short_remaining_frac * pnl_pct / 100 * position_size, 2)
            trades.append({
                **open_short,
                "exit_date": str(last_date),
                "exit_price": round(last_price, 2),
                "pnl_pct": pnl_pct,
                "pnl_usd": pnl_usd,
                "remaining_pct": round(short_remaining_frac * 100, 1),
                "status": "open",
                "exit_indicators": None,
            })

        # Mark-to-market re-entry pieces
        for piece in reentry_pieces_long:
            piece_pnl_pct = round(((last_price - piece["entry_price"]) / piece["entry_price"]) * 100, 2)
            piece_pnl_usd = round(piece["frac"] * piece_pnl_pct / 100 * position_size, 2)
            trades.append({
                "direction": "reentry",
                "entry_date": piece["entry_date"],
                "entry_price": piece["entry_price"],
                "entry_signal_color": "green",
                "entry_signal_reason": "pullback_reentry",
                "entry_indicators": piece["entry_indicators"],
                "exit_date": str(last_date),
                "exit_price": round(last_price, 2),
                "pnl_pct": piece_pnl_pct,
                "pnl_usd": piece_pnl_usd,
                "status": "open",
                "exit_indicators": None,
            })
        for piece in reentry_pieces_short:
            piece_pnl_pct = round(((piece["entry_price"] - last_price) / piece["entry_price"]) * 100, 2)
            piece_pnl_usd = round(piece["frac"] * piece_pnl_pct / 100 * position_size, 2)
            trades.append({
                "direction": "reentry",
                "entry_date": piece["entry_date"],
                "entry_price": piece["entry_price"],
                "entry_signal_color": "red",
                "entry_signal_reason": "pullback_reentry",
                "entry_indicators": piece["entry_indicators"],
                "exit_date": str(last_date),
                "exit_price": round(last_price, 2),
                "pnl_pct": piece_pnl_pct,
                "pnl_usd": piece_pnl_usd,
                "status": "open",
                "exit_indicators": None,
            })

        # Mark-to-market BB2
        if bb2_open_long is not None:
            bb2_pnl_pct = round(((last_price - bb2_open_long["entry_price"]) / bb2_open_long["entry_price"]) * 100, 2)
            bb2_pnl_usd = round(bb2_position_mult * bb2_pnl_pct / 100 * position_size, 2)
            trades.append({
                **bb2_open_long,
                "exit_date": str(last_date),
                "exit_price": round(last_price, 2),
                "pnl_pct": bb2_pnl_pct,
                "pnl_usd": bb2_pnl_usd,
                "status": "open",
                "exit_indicators": None,
            })
        if bb2_open_short is not None:
            bb2_pnl_pct = round(((bb2_open_short["entry_price"] - last_price) / bb2_open_short["entry_price"]) * 100, 2)
            bb2_pnl_usd = round(bb2_position_mult * bb2_pnl_pct / 100 * position_size, 2)
            trades.append({
                **bb2_open_short,
                "exit_date": str(last_date),
                "exit_price": round(last_price, 2),
                "pnl_pct": bb2_pnl_pct,
                "pnl_usd": bb2_pnl_usd,
                "status": "open",
                "exit_indicators": None,
            })

    return trades


# ---------------------------------------------------------------------------
# Analysis helpers
# ---------------------------------------------------------------------------

def compute_metrics(trades: list[dict], asset: str) -> dict:
    """Compute summary metrics from a list of trades for one asset."""
    closed = [t for t in trades if t.get("status") == "closed" and t.get("direction") in ("long", "short")]
    all_closed = [t for t in trades if t.get("status") == "closed"]

    total_pnl = sum(t.get("pnl_usd", 0) for t in all_closed)
    trade_count = len(closed)
    wins = [t for t in closed if t.get("pnl_usd", 0) > 0]
    win_rate = (len(wins) / trade_count * 100) if trade_count > 0 else 0
    avg_pnl = (total_pnl / trade_count) if trade_count > 0 else 0

    # Average hold days (from closed main trades)
    hold_days_list = []
    for t in closed:
        try:
            entry = pd.Timestamp(t["entry_date"])
            exit_ = pd.Timestamp(t["exit_date"])
            hold_days_list.append((exit_ - entry).days)
        except Exception:
            pass
    avg_hold_days = (sum(hold_days_list) / len(hold_days_list)) if hold_days_list else 0

    # Max drawdown (peak-to-trough of cumulative P&L)
    cum_pnl = 0.0
    peak = 0.0
    max_dd = 0.0
    # Sort all closed trades by exit date for sequential P&L tracking
    sorted_trades = sorted(all_closed, key=lambda t: t.get("exit_date", ""))
    for t in sorted_trades:
        cum_pnl += t.get("pnl_usd", 0)
        if cum_pnl > peak:
            peak = cum_pnl
        dd = peak - cum_pnl
        if dd > max_dd:
            max_dd = dd

    # Longest losing streak (consecutive losing main trades)
    longest_streak = 0
    current_streak = 0
    for t in sorted(closed, key=lambda t: t.get("exit_date", "")):
        if t.get("pnl_usd", 0) <= 0:
            current_streak += 1
            longest_streak = max(longest_streak, current_streak)
        else:
            current_streak = 0

    return {
        "asset": asset,
        "total_pnl": round(total_pnl, 2),
        "trade_count": trade_count,
        "win_rate": round(win_rate, 1),
        "avg_pnl": round(avg_pnl, 2),
        "avg_hold_days": round(avg_hold_days, 1),
        "max_drawdown": round(max_dd, 2),
        "longest_losing_streak": longest_streak,
    }


def print_comparison_table(results: dict[str, dict[str, dict]]) -> None:
    """Print a formatted comparison table across all configs."""
    configs = list(results.keys())
    assets = ASSETS + ["TOTAL"]

    # Header
    print("\n" + "=" * 120)
    print("TRAILING STOP VARIANTS BACKTEST RESULTS")
    print(f"Period: {DAYS} days | Position size: ${POSITION_SIZE} | Assets: {', '.join(ASSETS_HL[a] for a in ASSETS)}")
    print("=" * 120)

    # ── Summary table (totals across all assets) ──
    print("\n--- AGGREGATE SUMMARY ---")
    header = f"{'Config':<35} {'P&L':>8} {'Trades':>7} {'Win%':>6} {'Avg P&L':>8} {'AvgHold':>8} {'MaxDD':>8} {'LoseStrk':>9}"
    print(header)
    print("-" * len(header))
    for cfg_name in configs:
        totals = results[cfg_name]["TOTAL"]
        print(
            f"{cfg_name:<35} "
            f"${totals['total_pnl']:>7.0f} "
            f"{totals['trade_count']:>7} "
            f"{totals['win_rate']:>5.1f}% "
            f"${totals['avg_pnl']:>7.2f} "
            f"{totals['avg_hold_days']:>7.1f}d "
            f"${totals['max_drawdown']:>7.0f} "
            f"{totals['longest_losing_streak']:>9}"
        )

    # ── Per-asset breakdowns ──
    for asset in ASSETS:
        symbol = ASSETS_HL[asset]
        print(f"\n--- {symbol} ---")
        header = f"{'Config':<35} {'P&L':>8} {'Trades':>7} {'Win%':>6} {'Avg P&L':>8} {'AvgHold':>8} {'MaxDD':>8} {'LoseStrk':>9}"
        print(header)
        print("-" * len(header))
        for cfg_name in configs:
            m = results[cfg_name][asset]
            print(
                f"{cfg_name:<35} "
                f"${m['total_pnl']:>7.0f} "
                f"{m['trade_count']:>7} "
                f"{m['win_rate']:>5.1f}% "
                f"${m['avg_pnl']:>7.2f} "
                f"{m['avg_hold_days']:>7.1f}d "
                f"${m['max_drawdown']:>7.0f} "
                f"{m['longest_losing_streak']:>9}"
            )

    # ── Delta from baseline ──
    baseline_name = configs[0]
    print("\n--- DELTA FROM BASELINE (P&L) ---")
    header = f"{'Config':<35} " + "".join(f"{ASSETS_HL[a]:>8}" for a in ASSETS) + f"{'TOTAL':>8}"
    print(header)
    print("-" * len(header))
    for cfg_name in configs[1:]:
        deltas = []
        for asset in ASSETS:
            delta = results[cfg_name][asset]["total_pnl"] - results[baseline_name][asset]["total_pnl"]
            deltas.append(f"${delta:>+7.0f}")
        total_delta = results[cfg_name]["TOTAL"]["total_pnl"] - results[baseline_name]["TOTAL"]["total_pnl"]
        deltas.append(f"${total_delta:>+7.0f}")
        print(f"{cfg_name:<35} " + "".join(deltas))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print(f"Trailing Stop Variants Backtest")
    print(f"Period: {DAYS} days | Assets: {list(ASSETS_HL.values())}")
    print(f"Configs: {len(ALL_CONFIGS)}")
    print()

    # 1. Fetch data for all assets
    asset_data: dict[str, pd.DataFrame] = {}
    btc_df: pd.DataFrame | None = None

    for asset in ASSETS:
        symbol = ASSETS_HL[asset]
        print(f"Fetching {symbol} ({DAYS}d)...")
        raw = fetch_ohlc(asset, days=DAYS)
        if raw.empty:
            print(f"  WARNING: No data for {symbol}, skipping")
            continue
        # Use baseline config for indicator calculation (all configs share the same indicators)
        df = calculate_indicators(raw, config=BASELINE)
        df = generate_signals(df, config=BASELINE)
        asset_data[asset] = df
        print(f"  Got {len(df)} bars for {symbol}")

        if asset == "bitcoin":
            btc_df = df.copy()

        time.sleep(2)  # Rate limit between API calls

    if not asset_data:
        sys.exit("ERROR: No data fetched for any asset")

    # 2. Run all configs across all assets
    results: dict[str, dict[str, dict]] = {}

    for config in ALL_CONFIGS:
        cfg_name = config["name"]
        print(f"\nRunning: {cfg_name}")
        per_asset: dict[str, dict] = {}

        for asset in ASSETS:
            if asset not in asset_data:
                continue
            symbol = ASSETS_HL[asset]
            df = asset_data[asset]
            is_btc = (asset == "bitcoin")

            # Re-generate signals with this config (some configs change signal behavior)
            df_cfg = generate_signals(calculate_indicators(df.copy(), config=config), config=config)

            trades = simulate_trades_v11(
                df_cfg,
                position_size=POSITION_SIZE,
                config=config,
                btc_df=btc_df,
                is_btc=is_btc,
            )
            metrics = compute_metrics(trades, asset)
            per_asset[asset] = metrics
            print(f"  {symbol}: {metrics['trade_count']} trades, P&L ${metrics['total_pnl']:.0f}")

        # Aggregate totals
        total_pnl = sum(m["total_pnl"] for m in per_asset.values())
        total_trades = sum(m["trade_count"] for m in per_asset.values())
        total_wins = sum(
            int(m["win_rate"] / 100 * m["trade_count"])
            for m in per_asset.values()
        )
        total_win_rate = (total_wins / total_trades * 100) if total_trades > 0 else 0
        avg_pnl = (total_pnl / total_trades) if total_trades > 0 else 0
        avg_hold = (
            sum(m["avg_hold_days"] * m["trade_count"] for m in per_asset.values()) / total_trades
            if total_trades > 0 else 0
        )
        max_dd = max((m["max_drawdown"] for m in per_asset.values()), default=0)
        longest_streak = max((m["longest_losing_streak"] for m in per_asset.values()), default=0)

        per_asset["TOTAL"] = {
            "asset": "TOTAL",
            "total_pnl": round(total_pnl, 2),
            "trade_count": total_trades,
            "win_rate": round(total_win_rate, 1),
            "avg_pnl": round(avg_pnl, 2),
            "avg_hold_days": round(avg_hold, 1),
            "max_drawdown": round(max_dd, 2),
            "longest_losing_streak": longest_streak,
        }

        results[cfg_name] = per_asset

    # 3. Print comparison tables
    print_comparison_table(results)


if __name__ == "__main__":
    main()
