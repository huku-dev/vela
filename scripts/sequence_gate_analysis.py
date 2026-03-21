#!/usr/bin/env python3
"""
Sequence Gate Analysis
======================
Determines how many historical trades have a viable window for position adds
BEFORE any trim occurs. The key question: does the sequence gate ("adds only
before first trim") make the feature viable or eliminate most opportunities?

For each trade from simulate_trades() with V9_ATR_2_0X:
  - Identifies entry date/price and first trim date (if any)
  - Measures the "add window" (days between entry and first trim)
  - Checks whether a pullback >= 3% that recovered >= 50% occurred in that window
  - Checks whether RSI dropped >= 15 points then recovered >= 5 in that window
  - Correlates viable add windows with trade P&L outcomes

Uses the full backtest infrastructure from backtest.py.
"""

import sys
import time
from collections import defaultdict
from datetime import date as date_type
from pathlib import Path

import pandas as pd

# Import everything from the backtest engine
sys.path.insert(0, str(Path(__file__).resolve().parent))
from backtest import (
    V9_ATR_2_0X,
    ASSETS_HL,
    fetch_ohlc,
    calculate_indicators,
    generate_signals,
    simulate_trades,
)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

ASSETS = ["bitcoin", "ethereum", "hyperliquid", "solana"]
DAYS = 730
POSITION_SIZE = 1000
PULLBACK_PCT = 3.0        # Minimum pullback from peak to qualify
RECOVERY_PCT = 50.0       # Pullback must recover this % of its depth
RSI_DROP_THRESHOLD = 15   # RSI must drop at least this many points
RSI_RECOVERY_THRESHOLD = 5  # RSI must recover at least this many points after drop

# ---------------------------------------------------------------------------
# Analysis functions
# ---------------------------------------------------------------------------


def group_trades_by_position(trades: list[dict]) -> list[dict]:
    """
    Group flat trade list into position records.

    Each position has:
      - direction: "long" or "short"
      - entry_date, entry_price
      - exit_date, exit_price (from the final close)
      - first_trim_date (if any trim occurred)
      - trim_count
      - final_pnl_pct, final_pnl_usd
      - trims: list of trim dicts
    """
    # Separate main trades (open/close) from trims
    # Main trades have direction in ("long", "short") and status == "closed"
    # Trims have direction == "trim"
    # Also skip bb_long, bb_short, reentry, dca_entry — they're separate systems

    positions = []
    # Track open positions by entry_date + direction type
    # A "long" close references the same entry_date as its trims
    # A "short" close references the same entry_date as its trims

    # Build a map: (entry_date, signal_color) -> list of trims
    trim_map: dict[tuple[str, str], list[dict]] = defaultdict(list)
    main_closes: list[dict] = []

    for t in trades:
        d = t.get("direction", "")
        status = t.get("status", "")

        if d == "trim":
            key = (t["entry_date"], t["entry_signal_color"])
            trim_map[key].append(t)
        elif d in ("long", "short") and status == "closed":
            main_closes.append(t)
        # Skip reentry, dca_entry, bb_long, bb_short — separate systems

    for close in main_closes:
        entry_date = close["entry_date"]
        direction = close["direction"]
        signal_color = close.get("entry_signal_color", "")
        key = (entry_date, signal_color)

        trims = sorted(trim_map.get(key, []), key=lambda x: x.get("exit_date", ""))

        first_trim_date = trims[0]["exit_date"] if trims else None

        positions.append({
            "direction": direction,
            "entry_date": entry_date,
            "entry_price": close["entry_price"],
            "exit_date": close.get("exit_date"),
            "exit_price": close.get("exit_price"),
            "exit_reason": close.get("exit_signal_reason", ""),
            "final_pnl_pct": close.get("pnl_pct", 0),
            "final_pnl_usd": close.get("pnl_usd", 0),
            "remaining_pct": close.get("remaining_pct", 100),
            "trim_count": len(trims),
            "first_trim_date": first_trim_date,
            "trims": trims,
        })

    return positions


def check_pullback_opportunity(
    df: pd.DataFrame,
    entry_date: str,
    window_end_date: str | None,
    entry_price: float,
    direction: str,
) -> bool:
    """
    Check if a pullback >= PULLBACK_PCT occurred that then recovered >= RECOVERY_PCT
    within the add window (entry to first trim or exit).

    For longs: price rises, then pulls back >= 3% from peak, then recovers >= 50% of drop.
    For shorts: price drops, then bounces >= 3% from trough, then drops again >= 50% of bounce.
    """
    entry_d = _parse_date(entry_date)
    end_d = _parse_date(window_end_date) if window_end_date else df.index[-1]

    window = df[(df.index >= entry_d) & (df.index <= end_d)]
    if len(window) < 3:
        return False

    prices = window["close"].values

    if direction == "long":
        # Track peak, look for pullback from peak, then recovery
        peak = prices[0]
        for i in range(1, len(prices)):
            if prices[i] > peak:
                peak = prices[i]
            pullback_pct = ((peak - prices[i]) / peak) * 100
            if pullback_pct >= PULLBACK_PCT:
                # Found pullback. Check if it recovers from here.
                trough = prices[i]
                for j in range(i + 1, len(prices)):
                    recovery = prices[j] - trough
                    drop = peak - trough
                    if drop > 0 and (recovery / drop) * 100 >= RECOVERY_PCT:
                        return True
                    if prices[j] < trough:
                        trough = prices[j]
                break  # Only check first significant pullback
    else:
        # Short: track trough (best for short), look for bounce, then recovery
        trough = prices[0]
        for i in range(1, len(prices)):
            if prices[i] < trough:
                trough = prices[i]
            bounce_pct = ((prices[i] - trough) / trough) * 100 if trough > 0 else 0
            if bounce_pct >= PULLBACK_PCT:
                # Found bounce. Check if price drops again.
                bounce_peak = prices[i]
                for j in range(i + 1, len(prices)):
                    recovery = bounce_peak - prices[j]
                    rise = bounce_peak - trough
                    if rise > 0 and (recovery / rise) * 100 >= RECOVERY_PCT:
                        return True
                    if prices[j] > bounce_peak:
                        bounce_peak = prices[j]
                break
    return False


def check_rsi_add_opportunity(
    df: pd.DataFrame,
    entry_date: str,
    window_end_date: str | None,
    direction: str,
) -> bool:
    """
    Check if RSI dropped >= RSI_DROP_THRESHOLD then recovered >= RSI_RECOVERY_THRESHOLD
    within the add window.

    For longs: RSI drops (pullback in momentum), then recovers (momentum resumes).
    For shorts: RSI rises (bounce in momentum), then drops again (bearish momentum resumes).
    """
    entry_d = _parse_date(entry_date)
    end_d = _parse_date(window_end_date) if window_end_date else df.index[-1]

    window = df[(df.index >= entry_d) & (df.index <= end_d)]
    if len(window) < 3:
        return False

    rsi_values = window["rsi_14"].values

    if direction == "long":
        # RSI drops from peak, then recovers
        rsi_peak = rsi_values[0]
        for i in range(1, len(rsi_values)):
            if pd.isna(rsi_values[i]):
                continue
            if rsi_values[i] > rsi_peak:
                rsi_peak = rsi_values[i]
            drop = rsi_peak - rsi_values[i]
            if drop >= RSI_DROP_THRESHOLD:
                rsi_trough = rsi_values[i]
                for j in range(i + 1, len(rsi_values)):
                    if pd.isna(rsi_values[j]):
                        continue
                    recovery = rsi_values[j] - rsi_trough
                    if recovery >= RSI_RECOVERY_THRESHOLD:
                        return True
                    if rsi_values[j] < rsi_trough:
                        rsi_trough = rsi_values[j]
                break
    else:
        # Short: RSI rises (bearish losing steam), then drops again
        rsi_trough = rsi_values[0]
        for i in range(1, len(rsi_values)):
            if pd.isna(rsi_values[i]):
                continue
            if rsi_values[i] < rsi_trough:
                rsi_trough = rsi_values[i]
            rise = rsi_values[i] - rsi_trough
            if rise >= RSI_DROP_THRESHOLD:
                rsi_peak = rsi_values[i]
                for j in range(i + 1, len(rsi_values)):
                    if pd.isna(rsi_values[j]):
                        continue
                    drop = rsi_peak - rsi_values[j]
                    if drop >= RSI_RECOVERY_THRESHOLD:
                        return True
                    if rsi_values[j] > rsi_peak:
                        rsi_peak = rsi_values[j]
                break
    return False


def _parse_date(date_str: str) -> date_type:
    """Parse date string to date object."""
    if isinstance(date_str, date_type):
        return date_str
    return date_type.fromisoformat(str(date_str)[:10])


def compute_add_window_days(entry_date: str, first_trim_date: str | None, exit_date: str | None) -> float | None:
    """Days between entry and first trim (or exit if no trim)."""
    entry_d = _parse_date(entry_date)
    if first_trim_date:
        end_d = _parse_date(first_trim_date)
    elif exit_date:
        end_d = _parse_date(exit_date)
    else:
        return None
    return (end_d - entry_d).days


def bucket_days(days: float | None) -> str:
    """Categorize window duration into histogram buckets."""
    if days is None:
        return "unknown"
    if days <= 1:
        return "0-1d"
    elif days <= 3:
        return "1-3d"
    elif days <= 7:
        return "3-7d"
    elif days <= 14:
        return "7-14d"
    else:
        return "14+d"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 70)
    print("SEQUENCE GATE ANALYSIS")
    print("Can position adds happen before first trim?")
    print("=" * 70)
    print(f"\nConfig: V9_ATR_2_0X (production baseline)")
    print(f"Assets: {', '.join(ASSETS)}")
    print(f"Period: {DAYS} days")
    print(f"Position size: ${POSITION_SIZE}")
    print(f"Pullback threshold: {PULLBACK_PCT}% with {RECOVERY_PCT}% recovery")
    print(f"RSI drop threshold: {RSI_DROP_THRESHOLD} pts with {RSI_RECOVERY_THRESHOLD} pt recovery")
    print()

    # ── Step 1: Fetch data ──
    asset_data: dict[str, pd.DataFrame] = {}
    btc_df: pd.DataFrame | None = None

    for asset in ASSETS:
        print(f"\n--- Fetching {asset} ---")
        df = fetch_ohlc(asset, days=DAYS)
        df = calculate_indicators(df, config=V9_ATR_2_0X)
        df = generate_signals(df, config=V9_ATR_2_0X)
        asset_data[asset] = df
        if asset == "bitcoin":
            btc_df = df.copy()
        time.sleep(2)

    # ── Step 2: Run simulate_trades ──
    all_positions: list[dict] = []  # positions enriched with asset name

    for asset in ASSETS:
        print(f"\n--- Simulating trades for {asset} ---")
        df = asset_data[asset]
        is_btc = asset == "bitcoin"
        trades = simulate_trades(
            df,
            position_size=POSITION_SIZE,
            config=V9_ATR_2_0X,
            btc_df=btc_df,
            is_btc=is_btc,
        )
        positions = group_trades_by_position(trades)
        print(f"  {len(trades)} raw trade events -> {len(positions)} positions")

        # ── Step 3: Analyze each position ──
        for pos in positions:
            entry_date = pos["entry_date"]
            first_trim_date = pos["first_trim_date"]
            exit_date = pos["exit_date"]
            direction = pos["direction"]
            entry_price = pos["entry_price"]

            # Window end = first trim date (if trimmed), else exit date
            window_end = first_trim_date if first_trim_date else exit_date

            add_window_days = compute_add_window_days(entry_date, first_trim_date, exit_date)

            pullback_viable = check_pullback_opportunity(
                df, entry_date, window_end, entry_price, direction
            )
            rsi_viable = check_rsi_add_opportunity(
                df, entry_date, window_end, direction
            )

            pos["asset"] = asset
            pos["add_window_days"] = add_window_days
            pos["pullback_viable"] = pullback_viable
            pos["rsi_viable"] = rsi_viable
            pos["is_winner"] = pos["final_pnl_pct"] > 0

            all_positions.append(pos)

    # ── Step 4: Report ──
    print("\n")
    print("=" * 70)
    print("RESULTS")
    print("=" * 70)

    total = len(all_positions)
    no_trims = [p for p in all_positions if p["trim_count"] == 0]
    with_trims = [p for p in all_positions if p["trim_count"] > 0]

    print(f"\nTotal positions analyzed: {total}")
    print(f"  Longs:  {sum(1 for p in all_positions if p['direction'] == 'long')}")
    print(f"  Shorts: {sum(1 for p in all_positions if p['direction'] == 'short')}")

    # ── No-trim trades (unlimited add window) ──
    print(f"\n--- Trades with NO trims (unlimited add window) ---")
    print(f"  Count: {len(no_trims)} / {total} ({len(no_trims)/total*100:.1f}%)")
    if no_trims:
        no_trim_winners = sum(1 for p in no_trims if p["is_winner"])
        avg_hold = sum(
            (compute_add_window_days(p["entry_date"], None, p["exit_date"]) or 0)
            for p in no_trims
        ) / len(no_trims)
        avg_pnl = sum(p["final_pnl_pct"] for p in no_trims) / len(no_trims)
        print(f"  Win rate: {no_trim_winners}/{len(no_trims)} ({no_trim_winners/len(no_trims)*100:.1f}%)")
        print(f"  Avg hold duration: {avg_hold:.1f} days")
        print(f"  Avg P&L: {avg_pnl:+.2f}%")

    # ── Trimmed trades ──
    print(f"\n--- Trades WITH trims ---")
    print(f"  Count: {len(with_trims)} / {total} ({len(with_trims)/total*100:.1f}%)")
    if with_trims:
        trim_windows = [p["add_window_days"] for p in with_trims if p["add_window_days"] is not None]
        if trim_windows:
            avg_window = sum(trim_windows) / len(trim_windows)
            median_window = sorted(trim_windows)[len(trim_windows) // 2]
            print(f"  Avg days until first trim: {avg_window:.1f}")
            print(f"  Median days until first trim: {median_window:.1f}")
            print(f"  Min: {min(trim_windows):.0f}d, Max: {max(trim_windows):.0f}d")

    # ── Pullback viability ──
    pullback_viable = [p for p in all_positions if p["pullback_viable"]]
    rsi_viable = [p for p in all_positions if p["rsi_viable"]]
    either_viable = [p for p in all_positions if p["pullback_viable"] or p["rsi_viable"]]

    print(f"\n--- Add viability (before first trim / during hold) ---")
    print(f"  Pullback add viable: {len(pullback_viable)} / {total} ({len(pullback_viable)/total*100:.1f}%)")
    print(f"  RSI add viable:     {len(rsi_viable)} / {total} ({len(rsi_viable)/total*100:.1f}%)")
    print(f"  Either viable:      {len(either_viable)} / {total} ({len(either_viable)/total*100:.1f}%)")

    # ── Breakdown: viable adds vs P&L ──
    print(f"\n--- P&L breakdown: trades with viable add windows ---")
    if either_viable:
        viable_winners = sum(1 for p in either_viable if p["is_winner"])
        viable_losers = len(either_viable) - viable_winners
        viable_avg_pnl = sum(p["final_pnl_pct"] for p in either_viable) / len(either_viable)
        print(f"  Winners: {viable_winners} ({viable_winners/len(either_viable)*100:.1f}%)")
        print(f"  Losers:  {viable_losers} ({viable_losers/len(either_viable)*100:.1f}%)")
        print(f"  Avg P&L: {viable_avg_pnl:+.2f}%")

    not_viable = [p for p in all_positions if not p["pullback_viable"] and not p["rsi_viable"]]
    if not_viable:
        nv_winners = sum(1 for p in not_viable if p["is_winner"])
        nv_avg_pnl = sum(p["final_pnl_pct"] for p in not_viable) / len(not_viable)
        print(f"\n  (Comparison) Trades WITHOUT viable add window:")
        print(f"  Winners: {nv_winners} / {len(not_viable)} ({nv_winners/len(not_viable)*100:.1f}%)")
        print(f"  Avg P&L: {nv_avg_pnl:+.2f}%")

    # ── Window duration distribution ──
    print(f"\n--- Add window duration distribution ---")
    # For ALL trades (untrimmed use hold duration, trimmed use time-to-first-trim)
    buckets = defaultdict(int)
    for p in all_positions:
        days = p["add_window_days"]
        buckets[bucket_days(days)] += 1

    bucket_order = ["0-1d", "1-3d", "3-7d", "7-14d", "14+d", "unknown"]
    for b in bucket_order:
        count = buckets.get(b, 0)
        bar = "#" * count
        pct = count / total * 100 if total > 0 else 0
        print(f"  {b:>6s}: {count:3d} ({pct:5.1f}%) {bar}")

    # ── Trimmed-only window distribution ──
    if with_trims:
        print(f"\n--- Window distribution (trimmed trades only) ---")
        trim_buckets = defaultdict(int)
        for p in with_trims:
            days = p["add_window_days"]
            trim_buckets[bucket_days(days)] += 1

        for b in bucket_order:
            count = trim_buckets.get(b, 0)
            bar = "#" * count
            pct = count / len(with_trims) * 100 if with_trims else 0
            print(f"  {b:>6s}: {count:3d} ({pct:5.1f}%) {bar}")

    # ── Per-asset breakdown ──
    print(f"\n--- Per-asset breakdown ---")
    for asset in ASSETS:
        asset_pos = [p for p in all_positions if p["asset"] == asset]
        if not asset_pos:
            continue
        n = len(asset_pos)
        trimmed = sum(1 for p in asset_pos if p["trim_count"] > 0)
        pb_viable = sum(1 for p in asset_pos if p["pullback_viable"])
        rsi_v = sum(1 for p in asset_pos if p["rsi_viable"])
        either = sum(1 for p in asset_pos if p["pullback_viable"] or p["rsi_viable"])
        winners = sum(1 for p in asset_pos if p["is_winner"])
        avg_pnl = sum(p["final_pnl_pct"] for p in asset_pos) / n

        print(f"\n  {asset.upper()}: {n} trades, {trimmed} trimmed, {winners} winners ({winners/n*100:.0f}%)")
        print(f"    Pullback viable: {pb_viable} | RSI viable: {rsi_v} | Either: {either}")
        print(f"    Avg P&L: {avg_pnl:+.2f}%")

        # Show individual trades with viable windows
        viable_trades = [p for p in asset_pos if p["pullback_viable"] or p["rsi_viable"]]
        if viable_trades:
            print(f"    Viable add trades:")
            for p in viable_trades:
                flags = []
                if p["pullback_viable"]:
                    flags.append("pullback")
                if p["rsi_viable"]:
                    flags.append("RSI")
                trim_info = f"first trim @ {p['first_trim_date']}" if p["first_trim_date"] else "no trims"
                print(f"      {p['direction']:>5s} {p['entry_date']} -> {p['exit_date']}  "
                      f"window={p['add_window_days']:.0f}d  P&L={p['final_pnl_pct']:+.1f}%  "
                      f"[{', '.join(flags)}] ({trim_info})")

    # ── Bottom line ──
    print(f"\n{'=' * 70}")
    print("BOTTOM LINE")
    print(f"{'=' * 70}")
    viable_pct = len(either_viable) / total * 100 if total > 0 else 0
    trimmed_with_viable = [p for p in with_trims if p["pullback_viable"] or p["rsi_viable"]]
    trimmed_viable_pct = len(trimmed_with_viable) / len(with_trims) * 100 if with_trims else 0

    print(f"\n  {len(either_viable)}/{total} trades ({viable_pct:.0f}%) have a viable add opportunity")
    print(f"  {len(no_trims)}/{total} trades ({len(no_trims)/total*100:.0f}%) have unlimited add window (no trims)")
    if with_trims:
        print(f"  {len(trimmed_with_viable)}/{len(with_trims)} trimmed trades ({trimmed_viable_pct:.0f}%) "
              f"still have viable add window before first trim")

    if viable_pct >= 40:
        print(f"\n  VERDICT: Sequence gate is VIABLE -- {viable_pct:.0f}% of trades have add opportunities")
    elif viable_pct >= 20:
        print(f"\n  VERDICT: Sequence gate is MARGINAL -- only {viable_pct:.0f}% of trades have add opportunities")
    else:
        print(f"\n  VERDICT: Sequence gate ELIMINATES most opportunities -- only {viable_pct:.0f}% viable")


if __name__ == "__main__":
    main()
