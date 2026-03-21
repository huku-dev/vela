#!/usr/bin/env python3
"""
Audit trim P&L accounting and hold time distribution in backtest.py.

Part 1: Verify trim P&L math — no double-counting, correct fractional accounting.
Part 2: Investigate 47.7-day average hold time — histogram + category breakdown.
"""

import sys
import os
from datetime import datetime

# Ensure scripts dir is on path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backtest import (
    PROD_ACTUAL,
    fetch_ohlc,
    calculate_indicators,
    generate_signals,
    simulate_trades,
    group_into_positions,
    POSITION_SIZE_USD,
)

ALL_ASSETS = ["bitcoin", "ethereum", "hyperliquid", "solana"]
DAYS = 730
POSITION_SIZE = POSITION_SIZE_USD  # $1000 default


def part1_trim_pnl_audit(trades: list[dict]) -> None:
    """Audit every trimmed position for P&L correctness."""
    print("=" * 80)
    print("PART 1: TRIM P&L ACCOUNTING AUDIT")
    print("=" * 80)

    positions = group_into_positions(trades, POSITION_SIZE)
    trimmed_positions = [p for p in positions if p["trims"]]

    print(f"\nTotal positions: {len(positions)}")
    print(f"Positions with trims: {len(trimmed_positions)}")

    errors = []
    total_discrepancy = 0.0

    for i, pos in enumerate(trimmed_positions):
        close = pos["close"]
        trims = pos["trims"]
        direction = pos["direction"]
        entry_price = close["entry_price"]

        print(f"\n{'─' * 70}")
        print(f"Position #{i+1}: {direction.upper()} entered {close['entry_date']} @ ${entry_price:,.2f}")

        # Track cumulative trim fraction
        cumulative_trim_frac = 0.0

        for j, trim in enumerate(trims):
            trim_pct = trim.get("trim_pct", 0) / 100.0
            trim_exit_price = trim["exit_price"]
            trim_pnl_usd = trim.get("pnl_usd", 0)
            trim_pnl_pct = trim.get("pnl_pct", 0)

            # Expected P&L: trim_fraction * position_size * price_change_pct / 100
            if direction == "long":
                expected_pnl_pct = ((trim_exit_price - entry_price) / entry_price) * 100
            else:
                expected_pnl_pct = ((entry_price - trim_exit_price) / entry_price) * 100

            expected_pnl_usd = round(trim_pct * POSITION_SIZE * expected_pnl_pct / 100, 2)

            cumulative_trim_frac += trim_pct

            print(f"  Trim {j+1}: {trim['exit_date']} @ ${trim_exit_price:,.2f}")
            print(f"    Fraction of original: {trim_pct*100:.1f}%")
            print(f"    Price change: {expected_pnl_pct:+.2f}%")
            print(f"    Recorded P&L: ${trim_pnl_usd:+,.2f}  (pnl_pct in record: {trim_pnl_pct:+.2f}%)")
            print(f"    Expected P&L: ${expected_pnl_usd:+,.2f}")

            diff = abs(trim_pnl_usd - expected_pnl_usd)
            if diff > 0.05:
                print(f"    *** DISCREPANCY: ${diff:.2f} ***")
                errors.append(f"Pos #{i+1} Trim {j+1}: recorded ${trim_pnl_usd:.2f} vs expected ${expected_pnl_usd:.2f}")
                total_discrepancy += diff

        # Now check the close
        remaining_frac = close.get("remaining_pct", 100) / 100.0
        close_exit_price = close["exit_price"]
        close_pnl_usd = close.get("pnl_usd", 0)
        close_pnl_pct = close.get("pnl_pct", 0)

        if direction == "long":
            expected_close_pnl_pct = ((close_exit_price - entry_price) / entry_price) * 100
        else:
            expected_close_pnl_pct = ((entry_price - close_exit_price) / entry_price) * 100

        expected_close_pnl_usd = round(remaining_frac * POSITION_SIZE * expected_close_pnl_pct / 100, 2)

        print(f"  Close: {close['exit_date']} @ ${close_exit_price:,.2f}")
        print(f"    Remaining fraction: {remaining_frac*100:.1f}% (cumulative trimmed: {cumulative_trim_frac*100:.1f}%)")
        print(f"    Price change: {expected_close_pnl_pct:+.2f}%")
        print(f"    Recorded P&L: ${close_pnl_usd:+,.2f}  (pnl_pct in record: {close_pnl_pct:+.2f}%)")
        print(f"    Expected P&L: ${expected_close_pnl_usd:+,.2f}")

        diff = abs(close_pnl_usd - expected_close_pnl_usd)
        if diff > 0.05:
            print(f"    *** DISCREPANCY: ${diff:.2f} ***")
            errors.append(f"Pos #{i+1} Close: recorded ${close_pnl_usd:.2f} vs expected ${expected_close_pnl_usd:.2f}")
            total_discrepancy += diff

        # Verify remaining_frac consistency
        expected_remaining = 1.0 - cumulative_trim_frac
        if abs(remaining_frac - expected_remaining) > 0.01:
            print(f"    *** REMAINING FRAC MISMATCH: close says {remaining_frac:.3f}, trims sum to {expected_remaining:.3f} ***")
            errors.append(f"Pos #{i+1}: remaining_frac mismatch {remaining_frac:.3f} vs {expected_remaining:.3f}")

        # Total position P&L
        total_trim_pnl = sum(t.get("pnl_usd", 0) for t in trims)
        total_position_pnl = total_trim_pnl + close_pnl_usd

        # What would a simple hold give? (full $1000, entry to close)
        simple_hold_pnl = round(POSITION_SIZE * expected_close_pnl_pct / 100, 2)

        print(f"  TOTAL P&L: ${total_position_pnl:+,.2f} (trims: ${total_trim_pnl:+,.2f} + close: ${close_pnl_usd:+,.2f})")
        print(f"  Simple hold equivalent (no trims): ${simple_hold_pnl:+,.2f}")

        # Double-counting check: total should NOT exceed simple hold when trims are
        # at higher profit than close (trims lock in gains), and should NOT be less
        # when trims are at lower profit (trims reduce remaining exposure)
        # The key invariant: total = sum of (fraction_i * pnl_pct_i) * position_size
        expected_total = total_trim_pnl + expected_close_pnl_usd
        if abs(total_position_pnl - expected_total) > 0.10:
            print(f"    *** TOTAL P&L MISMATCH: ${total_position_pnl:.2f} vs expected ${expected_total:.2f} ***")

    print(f"\n{'=' * 70}")
    print(f"SUMMARY:")
    print(f"  Positions audited: {len(trimmed_positions)}")
    print(f"  Errors found: {len(errors)}")
    print(f"  Total discrepancy: ${total_discrepancy:.2f}")
    if errors:
        print(f"\n  ERRORS:")
        for e in errors:
            print(f"    - {e}")
    else:
        print(f"  All trim P&L calculations are correct.")
    print()


def part2_hold_time_investigation(trades: list[dict]) -> None:
    """Investigate the 47.7-day average hold time."""
    print("=" * 80)
    print("PART 2: HOLD TIME INVESTIGATION")
    print("=" * 80)

    closed = [t for t in trades if t["status"] == "closed"]

    # Categorize all closed trades
    trims = [t for t in closed if t.get("direction") == "trim"]
    bb_trades = [t for t in closed if t.get("direction", "").startswith("bb_")]
    bb2_trades = [t for t in closed if t.get("direction", "").startswith("bb2_")]
    reentry_trades = [t for t in closed if t.get("direction") == "reentry"]
    main_trades = [t for t in closed if t.get("direction") in ("long", "short")]

    print(f"\nTrade breakdown:")
    print(f"  Main (long/short closes): {len(main_trades)}")
    print(f"  Trims:                    {len(trims)}")
    print(f"  BB trades:                {len(bb_trades)}")
    print(f"  BB2 trades:               {len(bb2_trades)}")
    print(f"  Re-entry trades:          {len(reentry_trades)}")
    print(f"  TOTAL closed:             {len(closed)}")

    def calc_hold_days(trade: dict) -> float | None:
        try:
            d_in = datetime.strptime(trade["entry_date"], "%Y-%m-%d")
            d_out = datetime.strptime(trade["exit_date"], "%Y-%m-%d")
            return (d_out - d_in).days
        except (ValueError, TypeError, KeyError):
            return None

    def print_hold_stats(label: str, trade_list: list[dict]) -> list[float]:
        durations = [d for t in trade_list if (d := calc_hold_days(t)) is not None]
        if not durations:
            print(f"\n  {label}: no trades")
            return []
        avg = sum(durations) / len(durations)
        med = sorted(durations)[len(durations) // 2]
        print(f"\n  {label} ({len(durations)} trades):")
        print(f"    Average hold: {avg:.1f} days")
        print(f"    Median hold:  {med:.1f} days")
        print(f"    Min: {min(durations):.0f}d, Max: {max(durations):.0f}d")
        return durations

    # Hold stats by category
    print(f"\n{'─' * 60}")
    print("HOLD TIME BY CATEGORY:")
    main_durations = print_hold_stats("Main trades (long/short)", main_trades)
    trim_durations = print_hold_stats("Trims", trims)
    bb_durations = print_hold_stats("BB trades", bb_trades)
    bb2_durations = print_hold_stats("BB2 trades", bb2_trades)
    reentry_durations = print_hold_stats("Re-entry trades", reentry_trades)

    # What the metrics function actually computes (positions via group_into_positions)
    positions = group_into_positions(trades, POSITION_SIZE)
    position_durations = []
    for pos in positions:
        close = pos["close"]
        d = calc_hold_days(close)
        if d is not None:
            position_durations.append(d)

    if position_durations:
        avg_pos = sum(position_durations) / len(position_durations)
        med_pos = sorted(position_durations)[len(position_durations) // 2]
        print(f"\n  Positions (group_into_positions, what metrics reports) ({len(position_durations)} positions):")
        print(f"    Average hold: {avg_pos:.1f} days")
        print(f"    Median hold:  {med_pos:.1f} days")
        print(f"    Min: {min(position_durations):.0f}d, Max: {max(position_durations):.0f}d")

    # Now: what if we naively averaged ALL closed trades (including trims)?
    all_durations = [d for t in closed if (d := calc_hold_days(t)) is not None]
    if all_durations:
        avg_all = sum(all_durations) / len(all_durations)
        print(f"\n  ALL closed trades naively ({len(all_durations)} trades):")
        print(f"    Average hold: {avg_all:.1f} days")

    # Histogram of position hold times
    print(f"\n{'─' * 60}")
    print("HISTOGRAM OF POSITION HOLD TIMES:")
    buckets = [
        ("0-1d", 0, 1),
        ("2-3d", 2, 3),
        ("4-7d", 4, 7),
        ("8-14d", 8, 14),
        ("15-30d", 15, 30),
        ("31-60d", 31, 60),
        ("61-90d", 61, 90),
        ("91-120d", 91, 120),
        ("121-180d", 121, 180),
        ("181+d", 181, 9999),
    ]

    for label, lo, hi in buckets:
        count = sum(1 for d in position_durations if lo <= d <= hi)
        bar = "#" * count
        pct = count / len(position_durations) * 100 if position_durations else 0
        print(f"  {label:>10s}: {count:3d} ({pct:5.1f}%) {bar}")

    # List the longest positions to see what's going on
    print(f"\n{'─' * 60}")
    print("LONGEST 15 POSITIONS:")
    pos_with_dur = [(pos, calc_hold_days(pos["close"])) for pos in positions]
    pos_with_dur = [(p, d) for p, d in pos_with_dur if d is not None]
    pos_with_dur.sort(key=lambda x: x[1], reverse=True)

    for pos, dur in pos_with_dur[:15]:
        close = pos["close"]
        n_trims = len(pos["trims"])
        print(
            f"  {dur:4.0f}d  {close['direction']:5s}  "
            f"{close['entry_date']} -> {close['exit_date']}  "
            f"${pos['total_pnl_usd']:+,.0f}  "
            f"(trims: {n_trims}, remaining: {pos['cost_basis_pct']:.0f}%)"
        )

    # Also show BB2 hold time distribution (should be very short)
    if bb2_durations:
        print(f"\n{'─' * 60}")
        print("BB2 HOLD TIME HISTOGRAM:")
        bb2_buckets = [
            ("0d", 0, 0),
            ("1d", 1, 1),
            ("2d", 2, 2),
            ("3d", 3, 3),
            ("4-7d", 4, 7),
            ("8+d", 8, 9999),
        ]
        for label, lo, hi in bb2_buckets:
            count = sum(1 for d in bb2_durations if lo <= d <= hi)
            bar = "#" * count
            print(f"  {label:>5s}: {count:3d}  {bar}")


def main():
    all_trades: list[dict] = []

    for asset in ALL_ASSETS:
        print(f"\nFetching {DAYS} days of {asset} data...")
        df = fetch_ohlc(asset, days=DAYS)
        print(f"  Got {len(df)} candles")

        print(f"  Calculating indicators...")
        df = calculate_indicators(df, PROD_ACTUAL)

        print(f"  Generating signals...")
        df = generate_signals(df, PROD_ACTUAL)

        print(f"  Simulating trades...")
        is_btc = (asset == "bitcoin")
        trades = simulate_trades(df, config=PROD_ACTUAL, is_btc=is_btc)

        closed = [t for t in trades if t["status"] == "closed"]
        print(f"  {asset}: {len(closed)} closed trades")
        all_trades.extend(trades)

    total_closed = [t for t in all_trades if t["status"] == "closed"]
    print(f"\nTOTAL closed trades across all assets: {len(total_closed)}")

    part1_trim_pnl_audit(all_trades)
    part2_hold_time_investigation(all_trades)


if __name__ == "__main__":
    main()
