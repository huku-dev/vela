#!/usr/bin/env python3
"""
Weekly Simulation — V9 Strategy Backtester for Equities & Commodities
=====================================================================
Runs the V9 equities/commodities strategy on HIP-3 builder-deployed
perpetuals for a recent period, then inserts simulated trade results
into Supabase for the signal review to pick up.

This answers the question: "If we had been trading equities and
commodities with V9, how would they have performed this week?"

The signal review function then includes these alongside real V6d
crypto trades in the weekly report.

Usage:
    # Default: simulate last 7 days, insert into Supabase
    python scripts/weekly_simulation.py

    # Custom period
    python scripts/weekly_simulation.py --days 14

    # Dry run: show results without inserting
    python scripts/weekly_simulation.py --dry-run

    # Use specific Supabase environment
    python scripts/weekly_simulation.py --env staging
    python scripts/weekly_simulation.py --env production

    # Filter by sector
    python scripts/weekly_simulation.py --sector stocks
    python scripts/weekly_simulation.py --sector commodities

Requires:
    pip install -r scripts/requirements-backtest.txt

Environment:
    SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set
    (or use --env to load from .env files)
"""

import argparse
import os
import sys
import uuid
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pandas as pd

# Import from the backtest engine and multi-asset module
from backtest import (
    NAMED_CONFIGS,
    calculate_indicators,
    generate_signals,
    simulate_trades,
    extract_metrics,
    POSITION_SIZE_USD,
)
from multi_asset_backtest import (
    BUILDER_PERPS,
    fetch_4h_candles,
    backtest_asset_from_df,
)

# Strategy config for non-crypto assets
V9_CONFIG = NAMED_CONFIGS["v9_equities"]

# Map sector names to asset_class DB values
SECTOR_TO_CLASS = {
    "stocks": "equities",
    "commodities": "commodities",
}


# ---------------------------------------------------------------------------
# Supabase client
# ---------------------------------------------------------------------------

def get_supabase_client(env: str = "staging"):
    """
    Create a Supabase client using service_role key.
    Checks environment variables first, then .env files.
    """
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        # Try loading from .env files
        env_file = Path(__file__).parent.parent / "crypto-agent" / ".env"
        if env == "staging":
            env_file = Path(__file__).parent.parent.parent / "crypto-agent" / ".env"
        elif env == "production":
            env_file = Path(__file__).parent.parent.parent / "crypto-agent" / ".env.production"

        # Also try the backend repo's .env
        for candidate in [
            Path(__file__).parent.parent.parent / "crypto-agent" / ".env",
            Path(__file__).parent.parent.parent / "crypto-agent" / ".env.local",
            Path.home() / ".env.vela",
        ]:
            if candidate.exists():
                _load_env(candidate)
                url = os.environ.get("SUPABASE_URL")
                key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
                if url and key:
                    break

    if not url or not key:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
        print("  Set them as environment variables or create ~/.env.vela")
        sys.exit(1)

    try:
        from supabase import create_client
        return create_client(url, key)
    except ImportError:
        print("ERROR: supabase-py not installed. Run: pip install supabase>=2.0")
        sys.exit(1)


def _load_env(path: Path):
    """Simple .env file loader."""
    if not path.exists():
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key not in os.environ:  # Don't override existing env vars
                os.environ[key] = val


# ---------------------------------------------------------------------------
# Simulation runner
# ---------------------------------------------------------------------------

def run_simulation(
    days: int = 7,
    sector_filter: str | None = None,
    min_data_days: int = 30,
) -> tuple[str, list[dict]]:
    """
    Run V9 backtest on HIP-3 equities/commodities for the trailing `days` period.

    Returns (simulation_run_id, list of simulated trade dicts ready for DB insert).
    """
    run_id = str(uuid.uuid4())
    review_end = datetime.now(timezone.utc)
    review_start = review_end - timedelta(days=days)

    # Filter assets by sector
    if sector_filter and sector_filter != "all":
        assets = {k: v for k, v in BUILDER_PERPS.items() if v[1] == sector_filter}
    else:
        assets = BUILDER_PERPS

    print(f"\n{'='*80}")
    print(f"  VELA WEEKLY SIMULATION — V9 Strategy")
    print(f"  Period: {review_start.strftime('%Y-%m-%d')} → {review_end.strftime('%Y-%m-%d')} ({days} days)")
    print(f"  Assets: {len(assets)} ({sum(1 for _, (_, s, _) in assets.items() if s == 'stocks')} stocks, "
          f"{sum(1 for _, (_, s, _) in assets.items() if s == 'commodities')} commodities)")
    print(f"  Strategy: {V9_CONFIG.get('name', 'v9_equities')}")
    print(f"  Position size: ${POSITION_SIZE_USD:,}")
    print(f"  Run ID: {run_id}")
    print(f"{'='*80}")

    all_simulated_trades: list[dict] = []
    skipped = []
    assets_processed = 0

    for underlying, (hl_coin, sector, deployer) in sorted(assets.items()):
        asset_class = SECTOR_TO_CLASS.get(sector, sector)

        print(f"\n  [{underlying}] Fetching {hl_coin}...", end=" ", flush=True)
        try:
            raw_df = fetch_4h_candles(hl_coin)
        except Exception as e:
            print(f"ERROR: {e}")
            skipped.append(underlying)
            continue

        if raw_df.empty or len(raw_df) < 60:
            print(f"SKIP ({len(raw_df)} candles)")
            skipped.append(underlying)
            continue

        total_days = (raw_df.index[-1] - raw_df.index[0]).days
        if total_days < min_data_days:
            print(f"FILTER ({total_days}d < {min_data_days}d)")
            continue

        # Run V9 backtest on full history (need indicator warmup)
        trades = backtest_asset_from_df(raw_df, V9_CONFIG)

        # Filter to trades that CLOSED within the review period
        period_trades = []
        for t in trades:
            if t.get("status") != "closed":
                continue
            # Only include "full" trades (long/short), not trims/BB/etc.
            direction = t.get("direction", "")
            if direction not in ("long", "short"):
                continue

            exit_date_str = t.get("exit_date", "")
            if not exit_date_str:
                continue

            try:
                exit_date = pd.Timestamp(exit_date_str)
                if exit_date.tzinfo is None:
                    exit_date = exit_date.tz_localize("UTC")
            except Exception:
                continue

            if review_start <= exit_date.to_pydatetime() <= review_end:
                period_trades.append(t)

        # Convert to DB insert format
        for t in period_trades:
            entry_ind = t.get("entry_indicators", {})
            exit_ind = t.get("exit_indicators", {})

            # Map exit_signal_reason to close_reason
            exit_reason = t.get("exit_signal_reason", "unknown")
            close_reason = _map_close_reason(exit_reason)

            # Compute hold duration
            hold_hours = None
            try:
                entry_dt = pd.Timestamp(t["entry_date"])
                exit_dt = pd.Timestamp(t["exit_date"])
                hold_hours = round((exit_dt - entry_dt).total_seconds() / 3600, 2)
            except Exception:
                pass

            all_simulated_trades.append({
                "simulation_run_id": run_id,
                "asset_id": underlying.lower(),
                "asset_class": asset_class,
                "strategy_config": "v9_equities",
                "side": t.get("direction", "unknown"),
                "entry_price": float(t.get("entry_price", 0)),
                "exit_price": float(t.get("exit_price", 0)),
                "closed_pnl": round(float(t.get("pnl_usd", 0)), 2),
                "closed_pnl_pct": round(float(t.get("pnl_pct", 0)), 2),
                "close_reason": close_reason,
                "hold_duration_hours": hold_hours,
                "size_usd": POSITION_SIZE_USD,
                "entry_ema9": entry_ind.get("ema_9"),
                "entry_ema21": entry_ind.get("ema_21"),
                "entry_rsi14": entry_ind.get("rsi_14"),
                "entry_adx4h": entry_ind.get("adx_4h") or entry_ind.get("adx"),
                "exit_ema9": exit_ind.get("ema_9"),
                "exit_ema21": exit_ind.get("ema_21"),
                "exit_rsi14": exit_ind.get("rsi_14"),
                "exit_adx4h": exit_ind.get("adx_4h") or exit_ind.get("adx"),
                "entry_date": t.get("entry_date"),
                "exit_date": t.get("exit_date"),
            })

        # Summary line
        wins = sum(1 for t in period_trades if t.get("pnl_pct", 0) >= 0)
        losses = len(period_trades) - wins
        pnl = sum(t.get("pnl_usd", 0) for t in period_trades)
        print(f"OK ({len(raw_df)} candles, {total_days}d) → "
              f"{len(period_trades)} trades in period ({wins}W/{losses}L, ${pnl:+,.0f})")

        assets_processed += 1
        time.sleep(0.5)  # Rate limiting

    if skipped:
        print(f"\n  Skipped {len(skipped)}: {', '.join(skipped)}")

    # Print summary
    total_wins = sum(1 for t in all_simulated_trades if t["closed_pnl"] >= 0)
    total_losses = len(all_simulated_trades) - total_wins
    total_pnl = sum(t["closed_pnl"] for t in all_simulated_trades)
    win_rate = (total_wins / len(all_simulated_trades) * 100) if all_simulated_trades else 0

    # By asset class
    by_class: dict[str, list[dict]] = {}
    for t in all_simulated_trades:
        by_class.setdefault(t["asset_class"], []).append(t)

    print(f"\n  {'='*60}")
    print(f"  SIMULATION SUMMARY")
    print(f"  {'='*60}")
    print(f"  Period: {review_start.strftime('%Y-%m-%d')} → {review_end.strftime('%Y-%m-%d')}")
    print(f"  Assets processed: {assets_processed}")
    print(f"  Trades in period: {len(all_simulated_trades)}")
    print(f"  Win rate: {win_rate:.0f}% ({total_wins}W / {total_losses}L)")
    print(f"  Total P&L: ${total_pnl:+,.2f}")

    for cls, cls_trades in sorted(by_class.items()):
        cls_wins = sum(1 for t in cls_trades if t["closed_pnl"] >= 0)
        cls_pnl = sum(t["closed_pnl"] for t in cls_trades)
        cls_wr = (cls_wins / len(cls_trades) * 100) if cls_trades else 0
        print(f"    {cls}: {len(cls_trades)} trades · {cls_wr:.0f}% WR · ${cls_pnl:+,.2f}")

    return run_id, all_simulated_trades


def _map_close_reason(exit_signal_reason: str) -> str:
    """Map backtest exit_signal_reason to postmortem close_reason format."""
    mapping = {
        "trailing_stop": "trailing_stop",
        "stop_loss": "stop_loss",
        "sl_": "stop_loss",
        "ema_cross_down": "signal_red",
        "ema_cross_up": "signal_red",
        "btc_crash": "btc_crash",
    }
    for key, value in mapping.items():
        if key in exit_signal_reason:
            return value
    return exit_signal_reason


# ---------------------------------------------------------------------------
# Insert into Supabase
# ---------------------------------------------------------------------------

def insert_results(supabase, run_id: str, trades: list[dict]) -> int:
    """
    Insert simulated trade results into Supabase.
    Returns the number of rows inserted.
    """
    if not trades:
        print("  No trades to insert.")
        return 0

    # Insert in batches of 50
    batch_size = 50
    inserted = 0

    for i in range(0, len(trades), batch_size):
        batch = trades[i : i + batch_size]
        result = supabase.table("simulated_trade_results").insert(batch).execute()
        inserted += len(batch)
        print(f"  Inserted batch {i // batch_size + 1}: {len(batch)} rows")

    return inserted


# ---------------------------------------------------------------------------
# Cleanup old unreviewed simulations
# ---------------------------------------------------------------------------

def cleanup_old_runs(supabase, keep_latest: int = 2):
    """
    Remove old unreviewed simulation runs, keeping only the latest N.
    Reviewed results (review_period IS NOT NULL) are always kept.
    """
    # Get distinct run IDs ordered by created_at desc
    result = (
        supabase.table("simulated_trade_results")
        .select("simulation_run_id, created_at")
        .is_("review_period", "null")
        .order("created_at", desc=True)
        .execute()
    )

    if not result.data:
        return

    # Get unique run IDs in order
    seen = set()
    run_ids_ordered = []
    for row in result.data:
        rid = row["simulation_run_id"]
        if rid not in seen:
            seen.add(rid)
            run_ids_ordered.append(rid)

    # Keep the latest N, delete the rest
    to_delete = run_ids_ordered[keep_latest:]
    if not to_delete:
        return

    for rid in to_delete:
        supabase.table("simulated_trade_results").delete().eq(
            "simulation_run_id", rid
        ).is_("review_period", "null").execute()

    print(f"  Cleaned up {len(to_delete)} old simulation run(s)")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Run V9 strategy simulation on equities/commodities for signal review"
    )
    parser.add_argument(
        "--days", type=int, default=7,
        help="Number of days to simulate (default: 7, matching review interval)"
    )
    parser.add_argument(
        "--sector", choices=["stocks", "commodities", "all"], default="all",
        help="Asset sector to simulate (default: all)"
    )
    parser.add_argument(
        "--min-days", type=int, default=30,
        help="Minimum days of historical data required (default: 30)"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Show results without inserting into Supabase"
    )
    parser.add_argument(
        "--env", choices=["staging", "production"], default="staging",
        help="Supabase environment to use (default: staging)"
    )
    args = parser.parse_args()

    # Run simulation
    run_id, trades = run_simulation(
        days=args.days,
        sector_filter=args.sector if args.sector != "all" else None,
        min_data_days=args.min_days,
    )

    if not trades:
        print("\n  No trades generated in the review period. Nothing to insert.")
        return

    if args.dry_run:
        print(f"\n  DRY RUN: Would insert {len(trades)} simulated trades.")
        print(f"  Run without --dry-run to insert into Supabase ({args.env}).")
        return

    # Connect to Supabase and insert
    print(f"\n  Connecting to Supabase ({args.env})...")
    supabase = get_supabase_client(args.env)

    # Cleanup old unreviewed runs
    cleanup_old_runs(supabase, keep_latest=2)

    # Insert new results
    print(f"\n  Inserting {len(trades)} simulated trades (run: {run_id[:8]}...)...")
    inserted = insert_results(supabase, run_id, trades)

    print(f"\n  ✅ Done. {inserted} simulated trade results inserted.")
    print(f"  Run ID: {run_id}")
    print(f"  These will be included in the next signal review.\n")


if __name__ == "__main__":
    main()
