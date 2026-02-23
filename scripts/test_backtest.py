#!/usr/bin/env python3
"""
Vela Backtest Engine — V6a Trailing Stop Test Suite
====================================================
Validates V6a trailing stop adoption as the new baseline strategy.

Test categories:
  1. Long Trade Isolation (TRUST CRITICAL) — V6a never changes long behavior
  2. Trailing Stop Mechanics — fires correctly, boundary conditions
  3. State Management — peak profit resets, ratcheting
  4. Interaction / Priority — ATR stop, EMA cross, ladder trims
  5. Adversarial Tests (TRAIL-ADV:) — per CLAUDE.md security standards
  6. Real Data Regression — expected metric ranges on actual data

Run:
    pytest scripts/test_backtest.py -v
    pytest scripts/test_backtest.py -k "ADV" -v       # adversarial only
    pytest scripts/test_backtest.py -m "not slow" -v   # skip network tests
"""

import pytest
import pandas as pd
from datetime import date, timedelta

# Import from backtest.py (same directory)
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from backtest import (
    simulate_trades,
    extract_metrics,
    V5F_FULL_SUITE,
    V6A_TRAILING_STOP,
    V6_ADOPTED,
)


# ---------------------------------------------------------------------------
# Synthetic data helpers
# ---------------------------------------------------------------------------

def make_bar(
    price,
    ema_crossed_down=False,
    ema_crossed_up=False,
    adx=25,
    rsi=50,
    sma_50=None,
    atr_pct=2.0,
    **overrides,
):
    """
    Create a single bar with all indicator columns at neutral defaults.

    Neutral = no crossover, no extreme RSI, ADX at 25 (trending), price at SMA50.
    Override any column via kwargs.
    """
    sma_50 = sma_50 if sma_50 is not None else price
    bar = {
        "close": price,
        "open": price,
        "high": price * 1.005,
        "low": price * 0.995,
        "volume": 1000,
        "ema_9": price,
        "ema_21": price,
        "rsi_14": rsi,
        "sma_50": sma_50,
        "adx": adx,
        "atr_14": price * (atr_pct / 100),
        "atr_pct": atr_pct,
        "volume_ratio": 1.5,  # above 1.0 to pass volume confirmation
        "vma_20": 1000,
        "daily_return_pct": 0.0,
        "rsi_bb_upper": 70,
        "rsi_bb_lower": 30,
        "rsi_below_bb": False,
        "rsi_above_bb": False,
        "rsi_bb2_upper": 65,
        "rsi_bb2_lower": 35,
        "rsi_below_bb2": False,
        "rsi_above_bb2": False,
        "rsi_delta": 0.0,
        "ema_crossed_up": ema_crossed_up,
        "ema_crossed_down": ema_crossed_down,
        "recent_bearish_cross": False,
        "recent_bullish_cross": False,
        "days_below_sma50": 0 if price >= sma_50 else 5,
    }
    bar.update(overrides)
    return bar


def make_red_bar(price, **overrides):
    """Bar that triggers a RED signal → opens SHORT, closes LONG."""
    return make_bar(
        price,
        ema_crossed_down=True,
        adx=25,
        rsi=45,
        sma_50=price + 1,  # price < SMA50 for bearish
        **overrides,
    )


def make_green_bar(price, **overrides):
    """Bar that triggers a GREEN signal → opens LONG, closes SHORT."""
    return make_bar(
        price,
        ema_crossed_up=True,
        adx=25,
        rsi=55,
        sma_50=price - 1,  # price > SMA50 for bullish
        **overrides,
    )


def make_grey_bar(price, **overrides):
    """Neutral bar — no signal change."""
    return make_bar(price, **overrides)


def bars_to_df(bars, start_date=None):
    """Convert list of bar dicts to a DatetimeIndex DataFrame."""
    if start_date is None:
        start_date = date(2025, 1, 1)
    dates = [start_date + timedelta(days=i) for i in range(len(bars))]
    df = pd.DataFrame(bars, index=pd.DatetimeIndex(dates))
    return df


# ---------------------------------------------------------------------------
# Test configs — disable noise-producing features for clean isolation
# ---------------------------------------------------------------------------

V6A_TEST = {
    **V6A_TRAILING_STOP,
    "bb_improved": False,
    "dca_enabled": False,
    "rsi_bb_complementary": False,
    "volume_confirm": False,  # don't gate on volume in synthetic tests
}

V5F_TEST = {
    **V5F_FULL_SUITE,
    "bb_improved": False,
    "dca_enabled": False,
    "rsi_bb_complementary": False,
    "volume_confirm": False,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def filter_shorts(trades, status="closed"):
    """Extract closed short trades."""
    return [
        t for t in trades
        if t.get("direction") == "short" and t.get("status") == status
    ]


def filter_longs(trades, status=None):
    """Extract long trades (and long-related trims)."""
    results = []
    for t in trades:
        d = t.get("direction", "")
        if d == "long":
            if status is None or t.get("status") == status:
                results.append(t)
    return results


def run_v6a(bars, **config_overrides):
    """Run simulate_trades with V6A test config on synthetic bars."""
    config = {**V6A_TEST, **config_overrides}
    df = bars_to_df(bars)
    return simulate_trades(df, config=config, is_btc=True)


def run_v5f(bars, **config_overrides):
    """Run simulate_trades with V5F test config on synthetic bars."""
    config = {**V5F_TEST, **config_overrides}
    df = bars_to_df(bars)
    return simulate_trades(df, config=config, is_btc=True)


# ===========================================================================
# Category 1: Long Trade Isolation — TRUST CRITICAL
# ===========================================================================

class TestLongTradeIsolation:
    """
    TRUST CRITICAL: V6a only changes short exit behavior.
    Long trades must be IDENTICAL to V5f on the same data.
    """

    def test_long_simple_cycle_identical(self):
        """LONG-ISO: Simple long open → hold → close produces identical results."""
        bars = [
            make_green_bar(100),     # open long
            make_grey_bar(105),      # hold
            make_grey_bar(110),      # hold
            make_red_bar(108),       # close long
            make_grey_bar(106),      # quiet
        ]
        longs_v5f = filter_longs(run_v5f(bars))
        longs_v6a = filter_longs(run_v6a(bars))

        assert len(longs_v5f) == len(longs_v6a), \
            f"Long trade count differs: V5f={len(longs_v5f)}, V6a={len(longs_v6a)}"
        for t5, t6 in zip(longs_v5f, longs_v6a):
            assert t5["entry_price"] == t6["entry_price"]
            assert t5["exit_price"] == t6["exit_price"]
            assert t5["pnl_pct"] == t6["pnl_pct"]
            assert t5["pnl_usd"] == t6["pnl_usd"]

    def test_long_stop_loss_identical(self):
        """LONG-ISO: Long stop-loss fires identically on both configs."""
        bars = [
            make_green_bar(100),                 # open long
            make_grey_bar(85, atr_pct=3.0),      # ~15% drawdown, 2*3%=6% ATR stop fires
        ]
        longs_v5f = filter_longs(run_v5f(bars))
        longs_v6a = filter_longs(run_v6a(bars))

        assert len(longs_v5f) == len(longs_v6a)
        for t5, t6 in zip(longs_v5f, longs_v6a):
            assert t5.get("exit_signal_reason") == t6.get("exit_signal_reason")
            assert t5["pnl_pct"] == t6["pnl_pct"]

    def test_long_metrics_identical(self):
        """LONG-ISO: Long win rate and count identical across multiple cycles."""
        bars = [
            make_green_bar(100),     # long 1 open
            make_grey_bar(110),      # profit
            make_red_bar(108),       # long 1 close (+8%)
            make_grey_bar(105),      # quiet
            make_green_bar(107),     # long 2 open
            make_grey_bar(103),      # loss
            make_red_bar(100),       # long 2 close (-6.5%)
        ]
        m5f = extract_metrics(run_v5f(bars))
        m6a = extract_metrics(run_v6a(bars))

        assert m5f["long_win_rate"] == m6a["long_win_rate"]
        assert m5f["longs"] == m6a["longs"]
        assert m5f["long_wins"] == m6a["long_wins"]

    def test_long_with_yellow_trim_identical(self):
        """LONG-ISO: Long with RSI yellow trim produces same trim P&L."""
        bars = [
            make_green_bar(100),             # open long
            make_grey_bar(120, rsi=80),      # RSI >= 78 → yellow trim
            make_red_bar(115),               # close long
        ]
        trades_v5f = run_v5f(bars)
        trades_v6a = run_v6a(bars)

        # Compare all non-short trades
        non_short_v5f = [t for t in trades_v5f if t.get("direction") != "short"]
        non_short_v6a = [t for t in trades_v6a if t.get("direction") != "short"]

        assert len(non_short_v5f) == len(non_short_v6a)
        for t5, t6 in zip(non_short_v5f, non_short_v6a):
            assert t5["pnl_pct"] == t6["pnl_pct"]
            assert t5["pnl_usd"] == t6["pnl_usd"]

    def test_long_never_has_trailing_stop_reason(self):
        """LONG-ISO: No long trade ever shows trailing_stop as exit reason."""
        bars = [
            make_green_bar(100),
            make_grey_bar(107),      # profitable long
            make_grey_bar(104),      # "retrace" pattern (but it's a long)
            make_red_bar(103),       # close long
        ]
        trades = run_v6a(bars)
        longs = filter_longs(trades)
        for t in longs:
            assert t.get("exit_signal_reason") != "trailing_stop", \
                f"Long trade should never have trailing_stop reason: {t}"


# ===========================================================================
# Category 2: Trailing Stop Mechanics
# ===========================================================================

class TestTrailingStopMechanics:
    """Trailing stop fires and does not fire under correct conditions."""

    def test_fires_when_activation_and_retrace_met(self):
        """TRAIL-1: Fires at 7% profit, 3% retrace (exceeds 5%/2.5% thresholds)."""
        bars = [
            make_red_bar(100),       # open short at 100
            make_grey_bar(93),       # profit = 7%, peak = 7% → activated (≥5%)
            make_grey_bar(96),       # profit = 4%, retrace = 3% (≥2.5%) → FIRE
        ]
        trades = run_v6a(bars)
        closed = filter_shorts(trades)

        assert len(closed) == 1, f"Expected 1 closed short, got {len(closed)}"
        assert closed[0]["exit_signal_reason"] == "trailing_stop"
        assert closed[0]["exit_price"] == 96

    def test_does_not_fire_below_activation(self):
        """TRAIL-2: Does NOT fire if peak profit < 5% activation threshold."""
        bars = [
            make_red_bar(100),       # open short
            make_grey_bar(96),       # profit = 4% (< 5% activation)
            make_grey_bar(99),       # retrace = 3% but never activated
            make_green_bar(101),     # close on green signal
        ]
        trades = run_v6a(bars)
        closed = filter_shorts(trades)

        assert len(closed) == 1
        assert closed[0]["exit_signal_reason"] != "trailing_stop"

    def test_does_not_fire_when_retrace_too_small(self):
        """TRAIL-3: Does NOT fire if retrace < 2.5% from peak."""
        bars = [
            make_red_bar(100),       # open short
            make_grey_bar(93),       # profit = 7%, peak = 7% → activated
            make_grey_bar(94),       # profit = 6%, retrace = 1% (< 2.5%)
            make_grey_bar(93.5),     # profit = 6.5%, retrace = 0.5%
            make_green_bar(95),      # close on green (retrace ~2%, still < 2.5%)
        ]
        trades = run_v6a(bars)
        closed = filter_shorts(trades)

        assert len(closed) == 1
        assert closed[0]["exit_signal_reason"] != "trailing_stop"

    def test_does_not_fire_with_no_open_short(self):
        """TRAIL-4: Does NOT fire when no short position is open."""
        bars = [
            make_green_bar(100),     # open long (not short)
            make_grey_bar(93),       # price drops
            make_grey_bar(96),       # "retrace" pattern
            make_red_bar(95),        # close long
        ]
        trades = run_v6a(bars)
        for t in trades:
            assert t.get("exit_signal_reason") != "trailing_stop"

    def test_fires_at_exact_boundary(self):
        """TRAIL-5: Fires at exactly 5.0% activation and 2.5% retrace."""
        # Entry at 100, price at 95 = exactly 5.0% profit
        # Then price at 97.5 = profit 2.5%, retrace from peak = 5.0 - 2.5 = 2.5% exactly
        bars = [
            make_red_bar(100),       # open short
            make_grey_bar(95.0),     # profit = 5.0% exactly → activates
            make_grey_bar(97.5),     # profit = 2.5%, retrace = 2.5% exactly → fires
        ]
        trades = run_v6a(bars)
        closed = filter_shorts(trades)

        assert len(closed) == 1
        assert closed[0]["exit_signal_reason"] == "trailing_stop"

    def test_deep_profit_large_retrace(self):
        """TRAIL-6: Deep in-the-money short fires on large retrace. P&L = 25%."""
        bars = [
            make_red_bar(100),       # open short
            make_grey_bar(70),       # profit = 30%, peak = 30%
            make_grey_bar(75),       # profit = 25%, retrace = 5% → FIRE
        ]
        trades = run_v6a(bars)
        closed = filter_shorts(trades)

        assert len(closed) == 1
        assert closed[0]["exit_signal_reason"] == "trailing_stop"
        assert closed[0]["pnl_pct"] == 25.0

    def test_pnl_uses_close_price_not_peak(self):
        """TRAIL-7: P&L calculated at trailing stop close price, not peak."""
        bars = [
            make_red_bar(100),       # open short
            make_grey_bar(90),       # peak profit = 10%
            make_grey_bar(93),       # retrace 3% from peak → fires
        ]
        trades = run_v6a(bars)
        closed = filter_shorts(trades)

        assert len(closed) == 1
        t = closed[0]
        expected_pnl = round(((100 - 93) / 100) * 100, 2)
        assert t["pnl_pct"] == expected_pnl, \
            f"Expected P&L {expected_pnl}%, got {t['pnl_pct']}%"


# ===========================================================================
# Category 3: State Management
# ===========================================================================

class TestTrailingStopState:
    """Peak profit resets correctly and doesn't leak between trades."""

    def test_peak_resets_after_trailing_close(self):
        """STATE-1: After trailing stop close, new short starts with fresh peak."""
        bars = [
            make_red_bar(100),       # short 1: open
            make_grey_bar(93),       # short 1: peak = 7%
            make_grey_bar(96),       # short 1: retrace 3% → close
            make_red_bar(96),        # short 2: open at 96
            make_grey_bar(95),       # short 2: profit = ~1% (NOT using old peak)
            make_green_bar(97),      # short 2: close on green
        ]
        trades = run_v6a(bars)
        closed = filter_shorts(trades)

        assert len(closed) == 2
        assert closed[0]["exit_signal_reason"] == "trailing_stop"
        # Short 2: peak was only ~1%, never activated → should NOT be trailing_stop
        assert closed[1]["exit_signal_reason"] != "trailing_stop"

    def test_peak_resets_after_green_close(self):
        """STATE-2: After green signal close, new short starts with fresh peak."""
        bars = [
            make_red_bar(100),       # short 1: open
            make_grey_bar(90),       # short 1: peak = 10%
            make_green_bar(92),      # short 1: close on green (not trailing)
            make_red_bar(92),        # short 2: open at 92
            make_grey_bar(90),       # short 2: profit = ~2.2% (< 5% activation)
            make_green_bar(91),      # short 2: close on green
        ]
        trades = run_v6a(bars)
        closed = filter_shorts(trades)

        assert len(closed) == 2
        # Short 2 should NOT trigger trailing (peak only ~2.2%, not old 10%)
        assert closed[1]["exit_signal_reason"] != "trailing_stop"

    def test_peak_only_ratchets_upward(self):
        """STATE-3: Peak tracks highest profit, not most recent."""
        # Key: first peak is 6%, retrace to 5% is only 1% (< 2.5% trail) → no fire.
        # Then new peak at 9%, retrace to 6% is 3% (≥ 2.5%) → fires.
        bars = [
            make_red_bar(100),       # open short
            make_grey_bar(94),       # profit = 6%, peak = 6%
            make_grey_bar(95),       # profit = 5%, retrace = 1% from 6% (< 2.5%) → no fire
            make_grey_bar(91),       # profit = 9%, new peak = 9%
            make_grey_bar(94),       # profit = 6%, retrace = 3% from 9% → FIRE
        ]
        trades = run_v6a(bars)
        closed = filter_shorts(trades)

        assert len(closed) == 1
        assert closed[0]["exit_signal_reason"] == "trailing_stop"
        # Closed at 94 (retrace from 9% peak), not at the earlier bar at 95
        assert closed[0]["exit_price"] == 94

    def test_consecutive_trailing_stops_independent(self):
        """STATE-4: Two consecutive trailing stop closes have independent peaks."""
        bars = [
            make_red_bar(100),       # short 1: open at 100
            make_grey_bar(80),       # short 1: peak = 20%
            make_grey_bar(83),       # short 1: retrace 3% → close at 83
            make_red_bar(83),        # short 2: open at 83
            make_grey_bar(78),       # short 2: profit = ~6%, peak = ~6%
            make_grey_bar(81),       # short 2: retrace ~3.6% from ~6% peak → close
        ]
        trades = run_v6a(bars)
        closed = filter_shorts(trades)

        assert len(closed) == 2
        assert all(t["exit_signal_reason"] == "trailing_stop" for t in closed)
        # Entry prices are different (independent trades)
        assert closed[0]["entry_price"] == 100
        assert closed[1]["entry_price"] == 83


# ===========================================================================
# Category 4: Interaction / Priority
# ===========================================================================

class TestTrailingStopInteractions:
    """Priority ordering and interaction with other exit strategies."""

    def test_atr_stop_takes_priority(self):
        """PRIORITY-1: ATR stop fires before trailing stop is checked."""
        # Need 6+ bars to pass grace_period_days=5 from IMPROVED_CONFIG.
        # Keep price flat at 91 (no retrace) then spike above entry for ATR stop.
        bars = [
            make_red_bar(100),                   # bar 0: open short at 100
            make_grey_bar(91),                   # bar 1: profit 9%, peak 9%
            make_grey_bar(91),                   # bar 2: hold
            make_grey_bar(91),                   # bar 3: hold
            make_grey_bar(91),                   # bar 4: hold
            make_grey_bar(91),                   # bar 5: hold (past grace period)
            make_grey_bar(108, atr_pct=3.0),     # bar 6: ATR stop (8% > 2*3%=6%)
        ]
        trades = run_v6a(bars)
        closed = filter_shorts(trades)

        assert len(closed) == 1
        # ATR stop checked before trailing stop in code
        assert closed[0]["exit_signal_reason"] in ("atr_stop_loss", "stop_loss")

    def test_green_ema_cross_takes_priority(self):
        """PRIORITY-2: Green EMA cross closes short before trailing stop check."""
        bars = [
            make_red_bar(100),
            make_grey_bar(93),       # peak = 7%
            make_green_bar(96),      # green cross AND retrace = 4% → green wins
        ]
        trades = run_v6a(bars)
        closed = filter_shorts(trades)

        assert len(closed) == 1
        # Guard `color != "green"` skips trailing stop when green signal fires
        assert closed[0]["exit_signal_reason"] == "ema_cross_up"

    def test_trailing_reason_and_color_correct(self):
        """PRIORITY-3: Trailing stop sets reason='trailing_stop', color='green'."""
        bars = [
            make_red_bar(100),
            make_grey_bar(93),
            make_grey_bar(96),       # trailing fires
        ]
        trades = run_v6a(bars)
        closed = filter_shorts(trades)

        assert len(closed) == 1
        assert closed[0]["exit_signal_reason"] == "trailing_stop"
        assert closed[0]["exit_signal_color"] == "green"

    def test_ladder_trims_then_trailing_stop(self):
        """PRIORITY-4: Ladder trims can happen before trailing stop fires."""
        config = {
            "profit_ladder_enabled": True,
            "profit_ladder_levels": [5, 10],
            "profit_ladder_fractions": [0.10, 0.10],
        }
        bars = [
            make_red_bar(100),
            make_grey_bar(90),       # profit = 10% → ladder at 5% and 10%
            make_grey_bar(93),       # retrace 3% from 10% peak → trailing fires
        ]
        trades = run_v6a(bars, **config)

        trims = [t for t in trades if t.get("direction") == "trim"]
        closed = filter_shorts(trades)

        # Trims should have happened at the 10% bar
        assert len(trims) >= 1, f"Expected at least 1 trim, got {len(trims)}"
        # Trailing stop still fires on the remaining position
        assert len(closed) == 1
        assert closed[0]["exit_signal_reason"] == "trailing_stop"

    def test_metrics_count_trailing_stops(self):
        """PRIORITY-5: extract_metrics correctly counts trailing_stop_closes."""
        bars = [
            make_red_bar(100),
            make_grey_bar(93),
            make_grey_bar(96),       # trailing fires
        ]
        trades = run_v6a(bars)
        metrics = extract_metrics(trades)

        assert metrics["trailing_stop_closes"] == 1


# ===========================================================================
# Category 5: Adversarial Tests (TRAIL-ADV:)
# ===========================================================================

class TestTrailingStopAdversarial:
    """
    Adversarial tests per CLAUDE.md security standards.
    Prefix: TRAIL-ADV:
    """

    def test_ADV_never_fires_on_long(self):
        """TRAIL-ADV-1: Trailing stop NEVER fires on long positions."""
        bars = [
            make_green_bar(100),     # open long
            make_grey_bar(107),      # profit = 7% (would activate if it were a short)
            make_grey_bar(104),      # "retrace" 3%
            make_red_bar(103),       # close long
        ]
        trades = run_v6a(bars)
        for t in trades:
            assert t.get("exit_signal_reason") != "trailing_stop", \
                f"Trailing stop must NEVER fire on long: {t}"

    def test_ADV_disabled_config_never_triggers(self):
        """TRAIL-ADV-2: trailing_stop_short=False NEVER triggers trailing stop."""
        bars = [
            make_red_bar(100),
            make_grey_bar(80),       # huge 20% profit → would easily activate
            make_grey_bar(90),       # huge 10% retrace → would easily fire
            make_green_bar(95),      # close on green
        ]
        trades = run_v6a(bars, trailing_stop_short=False)
        for t in trades:
            assert t.get("exit_signal_reason") != "trailing_stop", \
                f"trailing_stop_short=False must prevent ALL trailing stops: {t}"

    def test_ADV_reentry_gate_blocks_short_reentry(self):
        """TRAIL-ADV-3: pullback_reentry_short=False blocks short re-entries."""
        bars = [
            make_red_bar(100),
            make_grey_bar(93),
            make_grey_bar(96),       # trailing fires → short closed
            make_grey_bar(95),       # quiet bar
            make_grey_bar(94),       # could be re-entry territory
            make_green_bar(97),      # end
        ]
        trades = run_v6a(bars, pullback_reentry=True, pullback_reentry_short=False)
        short_reentries = [
            t for t in trades
            if t.get("direction") == "reentry"
            and "short" in str(t.get("entry_signal_reason", ""))
        ]
        assert len(short_reentries) == 0, \
            "Short re-entries must be blocked when pullback_reentry_short=False"

    def test_ADV_zero_profit_does_not_activate(self):
        """TRAIL-ADV-4: 0% profit does not activate trailing stop."""
        bars = [
            make_red_bar(100),
            make_grey_bar(100),      # profit = 0%
            make_grey_bar(103),      # price moves against
            make_green_bar(102),     # close on green
        ]
        trades = run_v6a(bars)
        for t in trades:
            assert t.get("exit_signal_reason") != "trailing_stop"

    def test_ADV_negative_profit_does_not_activate(self):
        """TRAIL-ADV-5: Losing short (negative profit) does not activate."""
        bars = [
            make_red_bar(100),
            make_grey_bar(105),      # profit = -5%
            make_grey_bar(103),      # still losing
            make_green_bar(102),     # close on green
        ]
        trades = run_v6a(bars)
        for t in trades:
            assert t.get("exit_signal_reason") != "trailing_stop"

    def test_ADV_extreme_large_price(self):
        """TRAIL-ADV-6: Extreme prices (50000 → 25000) don't cause errors."""
        bars = [
            make_red_bar(50000),
            make_grey_bar(25000),    # 50% profit
            make_grey_bar(30000),    # retrace 10% from peak → fires
        ]
        trades = run_v6a(bars)
        closed = filter_shorts(trades)

        assert len(closed) == 1
        assert closed[0]["exit_signal_reason"] == "trailing_stop"

    def test_ADV_extreme_small_price(self):
        """TRAIL-ADV-7: Tiny sub-cent prices don't cause division errors."""
        bars = [
            make_red_bar(0.01),
            make_grey_bar(0.005),    # 50% profit
            make_grey_bar(0.006),    # retrace
        ]
        # Should not raise any errors
        trades = run_v6a(bars)
        assert isinstance(trades, list)

    def test_ADV_custom_params_respected(self):
        """TRAIL-ADV-8: Custom activation/trail params are not hardcoded."""
        bars = [
            make_red_bar(100),
            make_grey_bar(93),       # profit = 7% (< 10% custom activation)
            make_grey_bar(96),       # retrace = 4% (< 5% custom trail)
            make_green_bar(97),      # close on green
        ]
        # Custom higher thresholds: 10% activation, 5% trail
        trades = run_v6a(bars,
                         trailing_stop_activation_pct=10.0,
                         trailing_stop_trail_pct=5.0)
        closed = filter_shorts(trades)

        assert len(closed) == 1
        # Should NOT be trailing_stop because 7% < 10% activation
        assert closed[0]["exit_signal_reason"] != "trailing_stop"

    def test_ADV_v6_adopted_matches_v6a(self):
        """TRAIL-ADV-9: V6_ADOPTED config produces identical results to V6A."""
        bars = [
            make_red_bar(100),
            make_grey_bar(93),
            make_grey_bar(96),
        ]
        df = bars_to_df(bars)
        adopted_config = {
            **V6_ADOPTED,
            "bb_improved": False,
            "dca_enabled": False,
            "rsi_bb_complementary": False,
            "volume_confirm": False,
        }
        trades_v6a = simulate_trades(df, config=V6A_TEST, is_btc=True)
        trades_adopted = simulate_trades(df, config=adopted_config, is_btc=True)

        # Same number of trades
        assert len(trades_v6a) == len(trades_adopted)
        # Same trade details
        for ta, tb in zip(trades_v6a, trades_adopted):
            assert ta["pnl_pct"] == tb["pnl_pct"]
            assert ta.get("exit_signal_reason") == tb.get("exit_signal_reason")


# ===========================================================================
# Category 6: Real Data Regression
# ===========================================================================

@pytest.mark.slow
class TestRealDataRegression:
    """
    Run backtest with real Hyperliquid data and verify metrics
    are within expected ranges based on known V6a results.

    Known V6a results (1000 days, Hyperliquid):
    - BTC Total P&L: ~$+336
    - Trailing stop closes: > 0
    - Short win rate: ~58%
    """

    @pytest.fixture(scope="class")
    def btc_trades(self):
        """Fetch real BTC data and run V6a backtest."""
        from backtest import fetch_historical_ohlc_hyperliquid, calculate_indicators

        raw = fetch_historical_ohlc_hyperliquid("bitcoin", days=1000)
        df = calculate_indicators(raw, config=V6A_TRAILING_STOP)
        trades = simulate_trades(df, config=V6A_TRAILING_STOP, is_btc=True)
        return trades

    def test_total_pnl_positive(self, btc_trades):
        """REG-1: V6a BTC total P&L is positive."""
        metrics = extract_metrics(btc_trades)
        total = metrics["total_pnl_usd"] + metrics.get("open_pnl_usd", 0)
        assert total > 0, f"Expected positive P&L, got ${total}"

    def test_trailing_stop_count_nonzero(self, btc_trades):
        """REG-2: V6a produces at least some trailing stop closes."""
        metrics = extract_metrics(btc_trades)
        assert metrics["trailing_stop_closes"] > 0, \
            "Expected at least 1 trailing stop close on real data"

    def test_short_win_rate_improved(self, btc_trades):
        """REG-3: V6a short win rate above V5f baseline (~13%)."""
        metrics = extract_metrics(btc_trades)
        if metrics.get("shorts", 0) > 0:
            assert metrics["short_win_rate"] > 25, \
                f"Short win rate {metrics['short_win_rate']}% should be > 25%"

    def test_win_rate_in_expected_range(self, btc_trades):
        """REG-4: Overall win rate in reasonable range."""
        metrics = extract_metrics(btc_trades)
        assert 15 < metrics["win_rate"] < 80, \
            f"Win rate {metrics['win_rate']}% outside expected range 15-80%"
