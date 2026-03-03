#!/usr/bin/env python3
"""
Multi-Asset Class Backtest — Commodities & Equities on Hyperliquid HIP-3
=========================================================================
Tests Vela's signal model against Hyperliquid's builder-deployed perpetuals
for equities and commodities.

These are onchain representations of traditional assets deployed by HIP-3
builders (xyz/Trade.xyz, km/Kinetiq, cash/Dreamcash, flx/Felix, vntl/Ventuals).

Uses 4H candles (matching the live signal engine's resolution).

Usage:
    python scripts/multi_asset_backtest.py                     # all assets, V6d config
    python scripts/multi_asset_backtest.py --sector stocks      # equities only
    python scripts/multi_asset_backtest.py --sector commodities
    python scripts/multi_asset_backtest.py --asset TSLA         # single asset
    python scripts/multi_asset_backtest.py --min-days 60        # minimum data threshold
    python scripts/multi_asset_backtest.py --config adopted     # different config

    # Comparison mode — run multiple configs against baseline:
    python scripts/multi_asset_backtest.py --compare            # all eq_* experiments vs V6d
    python scripts/multi_asset_backtest.py --compare --sector stocks

Requires:
    pip install -r scripts/requirements-backtest.txt
"""

import argparse
import sys
import time
from datetime import datetime, timezone
from collections import defaultdict

import pandas as pd
import requests

# Import the backtest engine components
from backtest import (
    SIGNAL_CONFIG,
    NAMED_CONFIGS,
    calculate_indicators,
    simulate_trades,
    generate_signals,
    print_summary,
    extract_metrics,
    POSITION_SIZE_USD,
    HYPERLIQUID_INFO_URL,
    HL_SLEEP_SECONDS,
)

# ---------------------------------------------------------------------------
# HIP-3 Builder-Deployed Perps — Asset Registry
# ---------------------------------------------------------------------------
# Discovered via HL API: perpDexs, allPerpMetas, perpCategories
# Deduplicated across deployers, preferring xyz (highest volume) > cash > km > flx
#
# Format: { underlying_symbol: (hl_coin, sector, deployer) }
# hl_coin is what gets passed to candleSnapshot API

BUILDER_PERPS = {
    # === EQUITIES (stocks) ===
    "AAPL":     ("xyz:AAPL",     "stocks",      "xyz"),
    "AMD":      ("xyz:AMD",      "stocks",      "xyz"),
    "AMZN":     ("xyz:AMZN",     "stocks",      "xyz"),
    "BABA":     ("xyz:BABA",     "stocks",      "xyz"),
    "COIN":     ("xyz:COIN",     "stocks",      "xyz"),
    "CRCL":     ("xyz:CRCL",     "stocks",      "xyz"),
    "CRWV":     ("xyz:CRWV",     "stocks",      "xyz"),
    "GOOGL":    ("xyz:GOOGL",    "stocks",      "xyz"),
    "HOOD":     ("xyz:HOOD",     "stocks",      "xyz"),
    "HYUNDAI":  ("xyz:HYUNDAI",  "stocks",      "xyz"),
    "INTC":     ("xyz:INTC",     "stocks",      "xyz"),
    "META":     ("xyz:META",     "stocks",      "xyz"),
    "MSFT":     ("xyz:MSFT",     "stocks",      "xyz"),
    "MSTR":     ("xyz:MSTR",     "stocks",      "xyz"),
    "MU":       ("xyz:MU",       "stocks",      "xyz"),
    "NFLX":     ("xyz:NFLX",     "stocks",      "xyz"),
    "NVDA":     ("xyz:NVDA",     "stocks",      "xyz"),
    "ORCL":     ("xyz:ORCL",     "stocks",      "xyz"),
    "PLTR":     ("xyz:PLTR",     "stocks",      "xyz"),
    "RIVN":     ("xyz:RIVN",     "stocks",      "xyz"),
    "SKHX":     ("xyz:SKHX",     "stocks",      "xyz"),
    "SMSN":     ("xyz:SMSN",     "stocks",      "xyz"),
    "SNDK":     ("xyz:SNDK",     "stocks",      "xyz"),
    "TSLA":     ("xyz:TSLA",     "stocks",      "xyz"),
    "TSM":      ("xyz:TSM",      "stocks",      "xyz"),
    "URNM":     ("xyz:URNM",     "stocks",      "xyz"),
    "USAR":     ("xyz:USAR",     "stocks",      "xyz"),
    # === COMMODITIES ===
    "GOLD":     ("xyz:GOLD",     "commodities", "xyz"),
    "SILVER":   ("xyz:SILVER",   "commodities", "xyz"),
    "CL":       ("xyz:CL",       "commodities", "xyz"),  # Crude oil
    "COPPER":   ("xyz:COPPER",   "commodities", "xyz"),
    "NATGAS":   ("xyz:NATGAS",   "commodities", "xyz"),
    "PLATINUM": ("xyz:PLATINUM", "commodities", "xyz"),
    "ALUMINIUM":("xyz:ALUMINIUM","commodities", "xyz"),
    "PALLADIUM":("xyz:PALLADIUM","commodities", "xyz"),
    "USOIL":    ("km:USOIL",    "commodities", "km"),   # Kinetiq oil (different oracle)
}

# Experiment configs to compare (keys into NAMED_CONFIGS)
COMPARE_CONFIGS = [
    "v6d_trailing_both",    # baseline
    "eq_tight_trail",       # EQ-1: Tight trailing stop (3%/1.5%)
    "eq_tight_atr",         # EQ-2: Tight ATR stop-loss (1.3×)
    "eq_tight_both",        # EQ-3: Tight trail + tight ATR combined
    "eq_agg_trim",          # EQ-4: Aggressive trims (earlier RSI, tighter ladder)
    "eq_atr_trail",         # EQ-5: ATR-scaled trailing stop (adaptive per-asset)
    "eq_tight_trail_trim",  # EQ-6: EQ-1 + EQ-4 combined
    "eq_tight_trail_atr",   # EQ-7: EQ-1 + EQ-5 combined
]


# ---------------------------------------------------------------------------
# Data fetching — 4H candles from Hyperliquid
# ---------------------------------------------------------------------------

def fetch_4h_candles(hl_coin: str, max_days: int = 365) -> pd.DataFrame:
    """
    Fetch 4H OHLCV candles for a HIP-3 builder perp from Hyperliquid.
    Uses the same API as native perps, just with dex:COIN format.
    """
    end_ms = int(time.time() * 1000)
    start_ms = end_ms - (max_days * 24 * 60 * 60 * 1000)

    all_candles = []
    current_start = start_ms

    while current_start < end_ms:
        payload = {
            "type": "candleSnapshot",
            "req": {
                "coin": hl_coin,
                "interval": "4h",
                "startTime": current_start,
                "endTime": end_ms,
            },
        }

        for attempt in range(3):
            try:
                resp = requests.post(HYPERLIQUID_INFO_URL, json=payload, timeout=30)
                if resp.status_code == 429:
                    wait = 10 * (attempt + 1)
                    print(f"    Rate limited. Waiting {wait}s ({attempt + 1}/3)...")
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                break
            except requests.exceptions.RequestException as e:
                if attempt == 2:
                    raise RuntimeError(f"HL API failed after 3 retries for {hl_coin}: {e}")
                time.sleep(5)
        else:
            raise RuntimeError(f"Rate limit exceeded for {hl_coin}")

        candles = resp.json()
        if not candles:
            break

        all_candles.extend(candles)

        if len(candles) < 5000:
            break

        last_close_ms = candles[-1].get("T", candles[-1].get("t", 0))
        if last_close_ms <= current_start:
            break
        current_start = last_close_ms + 1
        time.sleep(HL_SLEEP_SECONDS)

    if not all_candles:
        return pd.DataFrame()

    rows = []
    for c in all_candles:
        rows.append({
            "timestamp_ms": c["t"],
            "open": float(c["o"]),
            "high": float(c["h"]),
            "low": float(c["l"]),
            "close": float(c["c"]),
            "volume": float(c["v"]),
        })

    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["timestamp_ms"], unit="ms", utc=True)
    df = df.drop_duplicates(subset="date", keep="last")
    df = df.set_index("date").sort_index()
    df = df.drop(columns=["timestamp_ms"])

    return df


# ---------------------------------------------------------------------------
# Backtest runner — returns raw trades for full reporting
# ---------------------------------------------------------------------------

def backtest_asset(
    underlying: str,
    hl_coin: str,
    sector: str,
    config: dict | None = None,
) -> tuple[list[dict], int] | None:
    """
    Run full backtest for a single HIP-3 asset.
    Returns (trades_list, days_of_data) or None on failure.
    """
    if config is None:
        config = NAMED_CONFIGS["v6d_trailing_both"]

    try:
        df = fetch_4h_candles(hl_coin)
    except Exception as e:
        print(f"    ERROR fetching {underlying}: {e}")
        return None

    if df.empty or len(df) < 60:
        print(f"    SKIP {underlying}: only {len(df)} candles (need >= 60)")
        return None

    days_of_data = (df.index[-1] - df.index[0]).days

    # Calculate indicators
    df = calculate_indicators(df, config=config)
    if df.empty:
        return None

    # Generate signals
    df = generate_signals(df, config=config)

    # Simulate trades (no BTC crash filter for non-crypto assets)
    trades = simulate_trades(df, config=config, btc_df=None, is_btc=False)

    return (trades, days_of_data)


def backtest_asset_from_df(
    raw_df: pd.DataFrame,
    config: dict,
) -> list[dict]:
    """
    Run backtest using a pre-fetched DataFrame (avoids re-fetching from API).
    Returns trades list. Used by comparison mode.
    """
    df = raw_df.copy()
    df = calculate_indicators(df, config=config)
    if df.empty:
        return []
    df = generate_signals(df, config=config)
    trades = simulate_trades(df, config=config, btc_df=None, is_btc=False)
    return trades


# ---------------------------------------------------------------------------
# Sector summary table (single config mode)
# ---------------------------------------------------------------------------

def print_sector_table(sector_data: list[dict], sector: str):
    """Print compact summary table for a sector using extracted metrics."""
    if not sector_data:
        return None

    # Sort by P&L descending
    sector_data.sort(key=lambda d: d["metrics"]["total_pnl_usd"], reverse=True)

    print(f"\n  {'='*90}")
    print(f"  {sector.upper()} — {len(sector_data)} assets")
    print(f"  {'='*90}")
    print(f"  {'Asset':<10s} {'Days':>5s} {'Trades':>7s} {'L/S':>7s} {'Trims':>6s} "
          f"{'Win%':>6s} {'Trail':>6s} {'P&L':>10s} {'Avg Dur':>8s} {'Max L%':>7s}")
    print(f"  {'-'*10} {'-'*5} {'-'*7} {'-'*7} {'-'*6} {'-'*6} {'-'*6} {'-'*10} {'-'*8} {'-'*7}")

    total_trades = 0
    total_pnl = 0.0
    total_wins = 0
    total_full = 0

    for d in sector_data:
        m = d["metrics"]
        ls = f"{m['longs']}/{m['shorts']}"
        pnl_str = f"${m['total_pnl_usd']:+,.0f}"
        dur_str = f"{m['avg_duration_days']:.0f}d" if m['avg_duration_days'] > 0 else "—"
        print(f"  {d['underlying']:<10s} {d['days']:>5d} {m['full_trades']:>7d} {ls:>7s} {m['trims']:>6d} "
              f"{m['win_rate']:>5.0f}% {m['trailing_stop_closes']:>6d} "
              f"{pnl_str:>10s} {dur_str:>8s} {m['max_single_loss_pct']:>+6.1f}%")

        total_trades += m["full_trades"]
        total_pnl += m["total_pnl_usd"]
        total_wins += m["long_wins"] + m["short_wins"]
        total_full += m["full_trades"]

    overall_wr = (total_wins / total_full * 100) if total_full > 0 else 0
    print(f"  {'-'*10} {'-'*5} {'-'*7} {'-'*7} {'-'*6} {'-'*6} {'-'*6} {'-'*10} {'-'*8} {'-'*7}")
    print(f"  {'TOTAL':<10s} {'':>5s} {total_trades:>7d} {'':>7s} {'':>6s} "
          f"{overall_wr:>5.0f}% {'':>6s} "
          f"{'${:+,.0f}'.format(total_pnl):>10s}")

    return {
        "sector": sector,
        "assets": len(sector_data),
        "total_trades": total_trades,
        "total_pnl": total_pnl,
        "win_rate": overall_wr,
    }


# ---------------------------------------------------------------------------
# Comparison mode — run multiple configs, output comparison tables
# ---------------------------------------------------------------------------

def aggregate_metrics(per_asset_metrics: list[dict]) -> dict:
    """Aggregate per-asset metrics into totals."""
    if not per_asset_metrics:
        return {
            "full_trades": 0, "trims": 0, "trailing_stop_closes": 0,
            "total_pnl_usd": 0.0, "trim_pnl_usd": 0.0, "close_pnl_usd": 0.0,
            "win_rate": 0.0, "long_wins": 0, "short_wins": 0,
            "longs": 0, "shorts": 0, "max_single_loss_pct": 0.0,
            "avg_duration_days": 0.0,
        }

    total_trades = sum(m["full_trades"] for m in per_asset_metrics)
    total_wins = sum(m["long_wins"] + m["short_wins"] for m in per_asset_metrics)
    win_rate = (total_wins / total_trades * 100) if total_trades > 0 else 0

    durations = [m["avg_duration_days"] for m in per_asset_metrics if m["avg_duration_days"] > 0]
    avg_dur = sum(durations) / len(durations) if durations else 0

    return {
        "full_trades": total_trades,
        "trims": sum(m["trims"] for m in per_asset_metrics),
        "trailing_stop_closes": sum(m["trailing_stop_closes"] for m in per_asset_metrics),
        "total_pnl_usd": sum(m["total_pnl_usd"] for m in per_asset_metrics),
        "trim_pnl_usd": sum(m["trim_pnl_usd"] for m in per_asset_metrics),
        "close_pnl_usd": sum(m["close_pnl_usd"] for m in per_asset_metrics),
        "win_rate": win_rate,
        "long_wins": total_wins,
        "short_wins": 0,  # folded into long_wins for aggregate
        "longs": sum(m["longs"] for m in per_asset_metrics),
        "shorts": sum(m["shorts"] for m in per_asset_metrics),
        "max_single_loss_pct": min(m["max_single_loss_pct"] for m in per_asset_metrics),
        "avg_duration_days": avg_dur,
    }


def _delta_str(val: float, base: float, fmt: str = "+,.0f", pct: bool = False) -> str:
    """Format a delta value with arrow indicator."""
    diff = val - base
    if abs(diff) < 0.01:
        return "—"
    if pct:
        return f"{diff:+.0f}pp"
    return f"${diff:{fmt}}"


def print_comparison_table(
    config_results: dict[str, dict],
    baseline_key: str = "v6d_trailing_both",
    title: str = "OVERALL",
):
    """
    Print comparison table across all configs.
    config_results: { config_key: aggregate_metrics_dict }
    """
    baseline = config_results.get(baseline_key)
    if baseline is None:
        print("  ERROR: baseline config not found in results")
        return

    print(f"\n  {'='*120}")
    print(f"  {title} COMPARISON")
    print(f"  {'='*120}")

    # Header
    print(f"  {'Config':<28s} {'Trades':>7s} {'Win%':>6s} {'Δ WR':>6s} "
          f"{'Total P&L':>10s} {'vs Base':>10s} {'Trim P&L':>10s} {'EMA P&L':>10s} "
          f"{'Trails':>7s} {'Avg Dur':>8s} {'Worst%':>7s}")
    print(f"  {'-'*28} {'-'*7} {'-'*6} {'-'*6} "
          f"{'-'*10} {'-'*10} {'-'*10} {'-'*10} "
          f"{'-'*7} {'-'*8} {'-'*7}")

    for config_key in COMPARE_CONFIGS:
        if config_key not in config_results:
            continue
        m = config_results[config_key]
        cfg = NAMED_CONFIGS[config_key]
        name = cfg.get("name", config_key)

        # Truncate long names
        if len(name) > 27:
            name = name[:24] + "..."

        is_baseline = (config_key == baseline_key)

        pnl_str = f"${m['total_pnl_usd']:+,.0f}"
        trim_str = f"${m['trim_pnl_usd']:+,.0f}"
        close_str = f"${m['close_pnl_usd']:+,.0f}"
        dur_str = f"{m['avg_duration_days']:.0f}d" if m['avg_duration_days'] > 0 else "—"

        if is_baseline:
            delta_pnl = "baseline"
            delta_wr = "—"
        else:
            diff_pnl = m["total_pnl_usd"] - baseline["total_pnl_usd"]
            delta_pnl = f"${diff_pnl:+,.0f}"
            diff_wr = m["win_rate"] - baseline["win_rate"]
            delta_wr = f"{diff_wr:+.0f}pp" if abs(diff_wr) >= 0.5 else "—"

        marker = " ◀" if is_baseline else ""
        print(f"  {name:<28s} {m['full_trades']:>7d} {m['win_rate']:>5.0f}% {delta_wr:>6s} "
              f"{pnl_str:>10s} {delta_pnl:>10s} {trim_str:>10s} {close_str:>10s} "
              f"{m['trailing_stop_closes']:>7d} {dur_str:>8s} {m['max_single_loss_pct']:>+6.1f}%{marker}")

    print(f"  {'-'*28} {'-'*7} {'-'*6} {'-'*6} "
          f"{'-'*10} {'-'*10} {'-'*10} {'-'*10} "
          f"{'-'*7} {'-'*8} {'-'*7}")


def run_comparison(assets: dict, min_days: int):
    """
    Comparison mode: fetch data once per asset, run all configs, output comparison tables.
    """
    config_keys = COMPARE_CONFIGS
    configs = {k: NAMED_CONFIGS[k] for k in config_keys}

    print(f"\n{'='*120}")
    print(f"  VELA MULTI-ASSET EXPERIMENT COMPARISON")
    print(f"  Configs: {len(config_keys)} ({', '.join(config_keys)})")
    print(f"  Assets:  {len(assets)} ({sum(1 for _, (_, s, _) in assets.items() if s == 'stocks')} stocks, "
          f"{sum(1 for _, (_, s, _) in assets.items() if s == 'commodities')} commodities)")
    print(f"  Resolution: 4H candles · Position size: ${POSITION_SIZE_USD:,}")
    print(f"  Min data: {min_days} days")
    print(f"{'='*120}")

    # ── Phase 1: Fetch candle data for all assets (one API call each) ──
    print(f"\n  Phase 1: Fetching candle data...")
    raw_data: dict[str, tuple[pd.DataFrame, str, int]] = {}  # underlying → (df, sector, days)
    skipped = []

    for underlying, (hl_coin, sector, deployer) in sorted(assets.items()):
        print(f"    Fetching {underlying} ({hl_coin})...", end=" ", flush=True)
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
        if days < min_days:
            print(f"FILTER ({days}d < {min_days}d)")
            continue

        raw_data[underlying] = (df, sector, days)
        print(f"OK ({len(df)} candles, {days}d)")
        time.sleep(0.5)

    if skipped:
        print(f"\n  Skipped {len(skipped)}: {', '.join(skipped)}")

    if not raw_data:
        print("\n  No assets with sufficient data.")
        return

    print(f"\n  {len(raw_data)} assets ready for backtesting.")

    # ── Phase 2: Run each config across all assets ──
    # Structure: config_key → { "overall": [metrics], "stocks": [metrics], "commodities": [metrics] }
    results: dict[str, dict[str, list[dict]]] = {}

    for config_key in config_keys:
        cfg = configs[config_key]
        config_name = cfg.get("name", config_key)
        print(f"\n  Phase 2: Running {config_name}...")

        results[config_key] = {"overall": [], "stocks": [], "commodities": []}

        for underlying, (raw_df, sector, days) in sorted(raw_data.items()):
            trades = backtest_asset_from_df(raw_df, cfg)
            metrics = extract_metrics(trades)

            results[config_key]["overall"].append(metrics)
            results[config_key][sector].append(metrics)

        # Summary line
        agg = aggregate_metrics(results[config_key]["overall"])
        print(f"    → {agg['full_trades']} trades · {agg['win_rate']:.0f}% WR · ${agg['total_pnl_usd']:+,.0f} P&L")

    # ── Phase 3: Print comparison tables ──
    print(f"\n\n{'#'*120}")
    print(f"#{'RESULTS':^118s}#")
    print(f"{'#'*120}")

    # Overall comparison
    overall_aggs = {k: aggregate_metrics(results[k]["overall"]) for k in config_keys}
    print_comparison_table(overall_aggs, title="OVERALL")

    # Per-sector comparisons
    for sector in ["commodities", "stocks"]:
        sector_aggs = {k: aggregate_metrics(results[k][sector]) for k in config_keys}
        # Only print if there's data
        if sector_aggs.get(config_keys[0], {}).get("full_trades", 0) > 0:
            print_comparison_table(sector_aggs, title=sector.upper())

    # ── Phase 4: Per-asset breakdown for best config ──
    # Find best non-baseline config by P&L delta
    baseline_pnl = overall_aggs["v6d_trailing_both"]["total_pnl_usd"]
    best_key = None
    best_delta = 0.0
    for k in config_keys:
        if k == "v6d_trailing_both":
            continue
        delta = overall_aggs[k]["total_pnl_usd"] - baseline_pnl
        if delta > best_delta:
            best_delta = delta
            best_key = k

    if best_key:
        best_name = NAMED_CONFIGS[best_key].get("name", best_key)
        print(f"\n  {'='*100}")
        print(f"  BEST EXPERIMENT: {best_name} (${best_delta:+,.0f} vs baseline)")
        print(f"  {'='*100}")
        print(f"  Per-asset breakdown (baseline → experiment):")
        print(f"  {'Asset':<10s} {'Sector':<13s} "
              f"{'Base P&L':>10s} {'Exp P&L':>10s} {'Delta':>10s} "
              f"{'Base WR%':>8s} {'Exp WR%':>8s}")
        print(f"  {'-'*10} {'-'*13} {'-'*10} {'-'*10} {'-'*10} {'-'*8} {'-'*8}")

        # Rebuild per-asset metrics for baseline vs best
        for underlying, (raw_df, sector, days) in sorted(raw_data.items()):
            base_trades = backtest_asset_from_df(raw_df, NAMED_CONFIGS["v6d_trailing_both"])
            exp_trades = backtest_asset_from_df(raw_df, NAMED_CONFIGS[best_key])
            bm = extract_metrics(base_trades)
            em = extract_metrics(exp_trades)
            diff = em["total_pnl_usd"] - bm["total_pnl_usd"]
            marker = " ✓" if diff > 0 else " ✗" if diff < -0.5 else ""
            print(f"  {underlying:<10s} {sector:<13s} "
                  f"${bm['total_pnl_usd']:>+8,.0f} ${em['total_pnl_usd']:>+8,.0f} ${diff:>+8,.0f} "
                  f"{bm['win_rate']:>7.0f}% {em['win_rate']:>7.0f}%{marker}")

    # ── Summary verdict ──
    print(f"\n  {'='*100}")
    print(f"  VERDICT SUMMARY")
    print(f"  {'='*100}")
    for k in config_keys:
        if k == "v6d_trailing_both":
            continue
        cfg_name = NAMED_CONFIGS[k].get("name", k)
        m = overall_aggs[k]
        b = overall_aggs["v6d_trailing_both"]
        pnl_diff = m["total_pnl_usd"] - b["total_pnl_usd"]
        wr_diff = m["win_rate"] - b["win_rate"]
        close_diff = m["close_pnl_usd"] - b["close_pnl_usd"]
        trim_diff = m["trim_pnl_usd"] - b["trim_pnl_usd"]

        if pnl_diff > 50:
            verdict = "✅ PROMISING"
        elif pnl_diff > 0:
            verdict = "🟡 MARGINAL"
        elif pnl_diff > -50:
            verdict = "🟡 NEUTRAL"
        else:
            verdict = "❌ WORSE"

        print(f"  {verdict}  {cfg_name}")
        print(f"          P&L: ${pnl_diff:+,.0f} · WR: {wr_diff:+.0f}pp · "
              f"EMA exits: ${close_diff:+,.0f} · Trims: ${trim_diff:+,.0f}")

    print(f"\n  Comparison complete. {len(raw_data)} assets × {len(config_keys)} configs.\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Multi-asset class backtest for HIP-3 perps")
    parser.add_argument("--sector", choices=["stocks", "commodities", "all"], default="all",
                        help="Asset sector to backtest (default: all)")
    parser.add_argument("--asset", type=str, help="Single underlying to backtest (e.g. TSLA)")
    parser.add_argument("--min-days", type=int, default=30,
                        help="Minimum days of data required (default: 30)")
    parser.add_argument("--config", type=str, default="v6d_trailing_both",
                        help=f"Named config from backtest.py (default: v6d_trailing_both). Options: {', '.join(NAMED_CONFIGS.keys())}")
    parser.add_argument("--compare", action="store_true",
                        help="Run all experiment configs vs V6d baseline and print comparison tables")
    parser.add_argument("--list", action="store_true", help="List available assets and exit")
    args = parser.parse_args()

    # List mode
    if args.list:
        print("\n  Available HIP-3 Builder Perps:")
        print(f"  {'Underlying':<12s} {'HL Coin':<20s} {'Sector':<15s} {'Deployer':<8s}")
        print(f"  {'-'*12} {'-'*20} {'-'*15} {'-'*8}")
        for underlying, (hl_coin, sector, deployer) in sorted(BUILDER_PERPS.items()):
            print(f"  {underlying:<12s} {hl_coin:<20s} {sector:<15s} {deployer:<8s}")
        print(f"\n  Total: {len(BUILDER_PERPS)} assets")
        return

    # Filter assets
    if args.asset:
        key = args.asset.upper()
        if key not in BUILDER_PERPS:
            sys.exit(f"Unknown asset '{key}'. Run with --list to see available assets.")
        assets = {key: BUILDER_PERPS[key]}
    elif args.sector == "all":
        assets = BUILDER_PERPS
    else:
        assets = {k: v for k, v in BUILDER_PERPS.items() if v[1] == args.sector}

    if not assets:
        sys.exit("No assets match the filter criteria.")

    # ── Comparison mode ──
    if args.compare:
        run_comparison(assets, args.min_days)
        return

    # ── Single config mode (original behavior) ──
    if args.config not in NAMED_CONFIGS:
        sys.exit(f"Unknown config '{args.config}'. Options: {', '.join(NAMED_CONFIGS.keys())}")
    config = NAMED_CONFIGS[args.config]

    print(f"\n{'='*90}")
    print(f"  VELA MULTI-ASSET BACKTEST")
    print(f"  Config: {config.get('name', args.config)}")
    print(f"  Assets: {len(assets)} ({sum(1 for _, (_, s, _) in assets.items() if s == 'stocks')} stocks, "
          f"{sum(1 for _, (_, s, _) in assets.items() if s == 'commodities')} commodities)")
    print(f"  Resolution: 4H candles · Position size: ${POSITION_SIZE_USD:,}")
    print(f"  Min data: {args.min_days} days")
    print(f"{'='*90}")

    # Run backtests — collect raw trades per asset
    all_asset_data = []  # list of {underlying, sector, days, trades, metrics}
    skipped = []

    for underlying, (hl_coin, sector, deployer) in sorted(assets.items()):
        result = backtest_asset(underlying, hl_coin, sector, config=config)
        if result is None:
            skipped.append(underlying)
            continue

        trades, days = result

        if days < args.min_days:
            print(f"    FILTER {underlying}: only {days} days (need >= {args.min_days})")
            continue

        # Print full per-asset summary using backtest.py's print_summary
        print_summary(trades, underlying)

        # Extract metrics for sector tables
        metrics = extract_metrics(trades)

        all_asset_data.append({
            "underlying": underlying,
            "sector": sector,
            "days": days,
            "trades": trades,
            "metrics": metrics,
        })

        time.sleep(0.5)  # gentle rate limiting

    if skipped:
        print(f"\n  Skipped {len(skipped)} assets (fetch error/insufficient candles): {', '.join(skipped)}")

    if not all_asset_data:
        print("\n  No assets with sufficient data. Try --min-days 20")
        return

    # Print sector summary tables
    sector_summaries = []
    for sector in ["commodities", "stocks"]:
        sector_assets = [d for d in all_asset_data if d["sector"] == sector]
        ss = print_sector_table(sector_assets, sector)
        if ss:
            sector_summaries.append(ss)

    # Overall summary
    print(f"\n  {'='*90}")
    print(f"  OVERALL SUMMARY")
    print(f"  {'='*90}")

    total_trades = sum(d["metrics"]["full_trades"] for d in all_asset_data)
    total_trims = sum(d["metrics"]["trims"] for d in all_asset_data)
    total_trailing = sum(d["metrics"]["trailing_stop_closes"] for d in all_asset_data)
    total_pnl = sum(d["metrics"]["total_pnl_usd"] for d in all_asset_data)
    total_trim_pnl = sum(d["metrics"]["trim_pnl_usd"] for d in all_asset_data)
    total_close_pnl = sum(d["metrics"]["close_pnl_usd"] for d in all_asset_data)
    total_wins = sum(d["metrics"]["long_wins"] + d["metrics"]["short_wins"] for d in all_asset_data)
    overall_wr = (total_wins / total_trades * 100) if total_trades > 0 else 0

    print(f"\n  Assets analyzed:      {len(all_asset_data)}")
    print(f"  Full trades (EMA):    {total_trades}")
    print(f"  Trim trades:          {total_trims}")
    print(f"  Trailing stop closes: {total_trailing}")
    print(f"  Overall win rate:     {overall_wr:.0f}%")
    print(f"  {'─'*50}")
    print(f"  Total P&L:            ${total_pnl:+,.0f}")
    print(f"    from EMA closes:    ${total_close_pnl:+,.0f}")
    print(f"    from trims:         ${total_trim_pnl:+,.0f}")

    print(f"\n  Per-sector:")
    for ss in sector_summaries:
        print(f"    {ss['sector']:>14s}: {ss['assets']} assets · {ss['total_trades']} trades · "
              f"{ss['win_rate']:.0f}% WR · ${ss['total_pnl']:+,.0f} P&L")

    # Best and worst
    by_pnl = sorted(all_asset_data, key=lambda d: d["metrics"]["total_pnl_usd"], reverse=True)
    print(f"\n  Best:  {by_pnl[0]['underlying']} (${by_pnl[0]['metrics']['total_pnl_usd']:+,.0f}, "
          f"{by_pnl[0]['metrics']['win_rate']:.0f}% WR)")
    print(f"  Worst: {by_pnl[-1]['underlying']} (${by_pnl[-1]['metrics']['total_pnl_usd']:+,.0f}, "
          f"{by_pnl[-1]['metrics']['win_rate']:.0f}% WR)")

    print(f"\n  Backtest complete. {len(all_asset_data)} assets analyzed.\n")


if __name__ == "__main__":
    main()
