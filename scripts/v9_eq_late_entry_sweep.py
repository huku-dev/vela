#!/usr/bin/env python3
"""
Late entry sweep for v9_equities against HIP-3 builder perps (equities + commodities).
Uses 4H candles from Hyperliquid — same resolution as the live signal engine.

Compares v9_equities baseline (no late entry) against 6-bar (24H) late entry.
"""
import sys
import os
import time
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))

from backtest import (
    NAMED_CONFIGS,
    calculate_indicators,
    generate_signals,
    simulate_trades,
    extract_metrics,
    group_into_positions,
    POSITION_SIZE_USD,
)
from multi_asset_backtest import (
    BUILDER_PERPS,
    fetch_4h_candles,
)

# ── Configs ──
V9_EQ = NAMED_CONFIGS["v9_equities"]

V9_EQ_BASELINE = {
    **V9_EQ,
    "name": "V9-EQ: Baseline (no late entry)",
    "late_entry_max_bars": 0,
}

V9_EQ_LATE_6BAR = {
    **V9_EQ,
    "name": "V9-EQ: Late entry 6 bars (24H)",
    "late_entry_max_bars": 6,
}

CONFIGS = [V9_EQ_BASELINE, V9_EQ_LATE_6BAR]


def backtest_from_df(raw_df, config):
    """Run backtest on a pre-fetched DataFrame. No BTC crash filter for equities."""
    df = raw_df.copy()
    df = calculate_indicators(df, config=config)
    if df.empty:
        return []
    df = generate_signals(df, config=config)
    trades = simulate_trades(df, config=config, btc_df=None, is_btc=False)
    return trades


def main():
    print("\n" + "=" * 100)
    print("  V9 EQUITIES/COMMODITIES — LATE ENTRY SWEEP")
    print(f"  Configs: Baseline (no late entry) vs 6-bar (24H)")
    print(f"  Assets: {len(BUILDER_PERPS)} HIP-3 builder perps")
    print(f"  Resolution: 4H candles · Position size: ${POSITION_SIZE_USD:,}")
    print("=" * 100)

    # ── Phase 1: Fetch data ──
    print(f"\n  Phase 1: Fetching 4H candle data...")
    raw_data = {}  # underlying → (df, sector, days)
    skipped = []

    for underlying, (hl_coin, sector, deployer) in sorted(BUILDER_PERPS.items()):
        print(f"    {underlying} ({hl_coin})...", end=" ", flush=True)
        try:
            df = fetch_4h_candles(hl_coin)
        except Exception as e:
            print(f"ERROR: {e}")
            skipped.append(underlying)
            continue

        if df.empty or len(df) < 60:
            print(f"SKIP ({len(df)} candles)")
            skipped.append(underlying)
            continue

        days = (df.index[-1] - df.index[0]).days
        raw_data[underlying] = (df, sector, days)
        print(f"OK ({len(df)} candles, {days}d)")
        time.sleep(0.5)

    if skipped:
        print(f"\n  Skipped {len(skipped)}: {', '.join(skipped)}")

    if not raw_data:
        print("\n  No assets with sufficient data.")
        return

    print(f"\n  {len(raw_data)} assets ready.")

    # ── Phase 2: Run both configs across all assets ──
    # config_name → underlying → trades
    config_results = {cfg["name"]: {} for cfg in CONFIGS}

    for cfg in CONFIGS:
        print(f"\n  Phase 2: Running {cfg['name']}...")
        for underlying, (raw_df, sector, days) in sorted(raw_data.items()):
            trades = backtest_from_df(raw_df, cfg)
            config_results[cfg["name"]][underlying] = trades

    # ── Phase 3: Per-asset comparison ──
    baseline_name = CONFIGS[0]["name"]
    late_name = CONFIGS[1]["name"]

    for sector_name in ["stocks", "commodities"]:
        sector_assets = {
            u: (df, s, d) for u, (df, s, d) in raw_data.items() if s == sector_name
        }
        if not sector_assets:
            continue

        print(f"\n\n{'=' * 100}")
        print(f"  {sector_name.upper()} — PER-ASSET COMPARISON")
        print(f"{'=' * 100}")
        print(f"  {'Asset':<12s} {'Days':>5s}  "
              f"{'Base Pos':>8s} {'Base WR':>8s} {'Base P&L':>10s}  "
              f"{'Late Pos':>8s} {'Late WR':>8s} {'Late P&L':>10s}  "
              f"{'ΔP&L':>8s} {'ΔPos':>5s}")
        print(f"  {'─' * 12} {'─' * 5}  "
              f"{'─' * 8} {'─' * 8} {'─' * 10}  "
              f"{'─' * 8} {'─' * 8} {'─' * 10}  "
              f"{'─' * 8} {'─' * 5}")

        sector_totals = {"base": [], "late": []}

        for underlying in sorted(sector_assets.keys()):
            _, sector, days = raw_data[underlying]
            base_trades = config_results[baseline_name][underlying]
            late_trades = config_results[late_name][underlying]

            bm = extract_metrics(base_trades)
            lm = extract_metrics(late_trades)

            delta_pnl = lm["total_pnl_usd"] - bm["total_pnl_usd"]
            delta_pos = lm["positions"] - bm["positions"]
            marker = " ✓" if delta_pnl > 0.5 else " ✗" if delta_pnl < -0.5 else ""

            print(
                f"  {underlying:<12s} {days:>5d}  "
                f"{bm['positions']:>8d} {bm['win_rate']:>7.0f}% ${bm['total_pnl_usd']:>+8,.0f}  "
                f"{lm['positions']:>8d} {lm['win_rate']:>7.0f}% ${lm['total_pnl_usd']:>+8,.0f}  "
                f"${delta_pnl:>+7,.0f} {delta_pos:>+5d}{marker}"
            )

            sector_totals["base"].append(bm)
            sector_totals["late"].append(lm)

        # Sector subtotals
        for label, metrics_list in sector_totals.items():
            total_pos = sum(m["positions"] for m in metrics_list)
            total_wins = sum(m["long_wins"] + m["short_wins"] for m in metrics_list)
            total_wr = (total_wins / total_pos * 100) if total_pos > 0 else 0
            total_pnl = sum(m["total_pnl_usd"] for m in metrics_list)

            if label == "base":
                base_total_pnl = total_pnl
                base_total_pos = total_pos
                print(f"  {'─' * 12} {'─' * 5}  "
                      f"{'─' * 8} {'─' * 8} {'─' * 10}  "
                      f"{'─' * 8} {'─' * 8} {'─' * 10}  "
                      f"{'─' * 8} {'─' * 5}")
                print(
                    f"  {sector_name.upper() + ' TOTAL':<12s} {'':>5s}  "
                    f"{total_pos:>8d} {total_wr:>7.0f}% ${total_pnl:>+8,.0f}  ",
                    end=""
                )
            else:
                delta = total_pnl - base_total_pnl
                delta_p = total_pos - base_total_pos
                print(
                    f"{total_pos:>8d} {total_wr:>7.0f}% ${total_pnl:>+8,.0f}  "
                    f"${delta:>+7,.0f} {delta_p:>+5d}"
                )

    # ── Phase 4: Aggregate comparison ──
    print(f"\n\n{'=' * 100}")
    print(f"  AGGREGATE COMPARISON (all equities + commodities)")
    print(f"  Position-level P&L: win = total position P&L ≥ 0, including trims")
    print(f"{'=' * 100}")

    print(f"\n  {'Config':<40s} {'Pos':>5s} {'Win%':>6s} {'P&L':>10s} {'Trim P&L':>10s} {'Close P&L':>10s} {'Late#':>6s} {'LateWin%':>9s} {'LateP&L':>10s}")
    print(f"  {'─' * 98}")

    for cfg in CONFIGS:
        all_trades = []
        for underlying in raw_data:
            all_trades.extend(config_results[cfg["name"]][underlying])

        m = extract_metrics(all_trades)

        # Late-entry positions
        positions = group_into_positions(all_trades)
        late_positions = [
            p for p in positions
            if p["close"].get("entry_signal_reason") == "late_entry"
        ]
        late_wins = [p for p in late_positions if p["total_pnl_usd"] >= 0]
        late_count = len(late_positions)
        late_wr = len(late_wins) / late_count * 100 if late_count > 0 else 0
        late_pnl = sum(p["total_pnl_usd"] for p in late_positions)

        bars = cfg.get("late_entry_max_bars", 0)
        label = cfg["name"]

        if bars == 0:
            print(
                f"  {label:<40s} {m['positions']:>5d} {m['win_rate']:>5.0f}%"
                f" ${m['total_pnl_usd']:>+8,.0f} ${m['trim_pnl_usd']:>+8,.0f} ${m['close_pnl_usd']:>+8,.0f}"
                f" {'n/a':>6s} {'n/a':>9s} {'n/a':>10s}"
            )
        else:
            print(
                f"  {label:<40s} {m['positions']:>5d} {m['win_rate']:>5.0f}%"
                f" ${m['total_pnl_usd']:>+8,.0f} ${m['trim_pnl_usd']:>+8,.0f} ${m['close_pnl_usd']:>+8,.0f}"
                f" {late_count:>6d} {late_wr:>8.0f}%"
                f" ${late_pnl:>+8,.0f}"
            )

    # ── Phase 5: Per-sector aggregate ──
    for sector_name in ["stocks", "commodities"]:
        sector_underlyings = [u for u, (_, s, _) in raw_data.items() if s == sector_name]
        if not sector_underlyings:
            continue

        print(f"\n  {sector_name.upper()} ONLY:")
        print(f"  {'Config':<40s} {'Pos':>5s} {'Win%':>6s} {'P&L':>10s} {'Late#':>6s} {'LateP&L':>10s}")
        print(f"  {'─' * 80}")

        for cfg in CONFIGS:
            all_trades = []
            for underlying in sector_underlyings:
                all_trades.extend(config_results[cfg["name"]][underlying])

            m = extract_metrics(all_trades)

            positions = group_into_positions(all_trades)
            late_positions = [
                p for p in positions
                if p["close"].get("entry_signal_reason") == "late_entry"
            ]
            late_count = len(late_positions)
            late_pnl = sum(p["total_pnl_usd"] for p in late_positions)

            bars = cfg.get("late_entry_max_bars", 0)
            if bars == 0:
                print(
                    f"  {cfg['name']:<40s} {m['positions']:>5d} {m['win_rate']:>5.0f}%"
                    f" ${m['total_pnl_usd']:>+8,.0f} {'n/a':>6s} {'n/a':>10s}"
                )
            else:
                print(
                    f"  {cfg['name']:<40s} {m['positions']:>5d} {m['win_rate']:>5.0f}%"
                    f" ${m['total_pnl_usd']:>+8,.0f} {late_count:>6d} ${late_pnl:>+8,.0f}"
                )

    print(f"\n  Sweep complete. {len(raw_data)} assets × {len(CONFIGS)} configs.\n")


if __name__ == "__main__":
    main()
