#!/usr/bin/env python3
"""
Foregone Move Analysis
======================
For every closed position in production, fetches Hyperliquid 1h candles
for the 48h window after close and measures how much additional profit
was available in the trade's direction.

This quantifies the opportunity cost of the current exit logic (trailing stop,
stop-loss, etc.) and answers: "How much are we leaving on the table?"

Key metrics per position:
  - foregone_Xh:  Best additional profit (direction-adjusted) within X hours.
      SHORT: (close_price - window_low) / close_price * 100
      LONG:  (window_high - close_price) / close_price * 100
  - end_pct_Xh:   P&L if held to end of window (vs best-case).
  - continued_24h: True if price moved >2% in trade direction within 24h.
  - signal_still_active: True if position closed within 24h of opening
      (trailing stop fired before the 24h signal window expired).

Usage:
    python3 scripts/foregone_move_analysis.py
    python3 scripts/foregone_move_analysis.py --close-reason trailing_stop
    python3 scripts/foregone_move_analysis.py --asset zec
    python3 scripts/foregone_move_analysis.py --output my_results.csv

Output:
    - CSV file with per-position metrics (default: foregone_move_analysis.csv)
    - Console summary tables

Requires: pip install requests pandas tabulate
"""

import argparse
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import pandas as pd
import requests

# ── Environment ───────────────────────────────────────────────────────────────

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"


def _load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


_env = _load_env()
SUPABASE_URL = _env.get("VITE_SUPABASE_URL", "")
SUPABASE_KEY = _env.get("SUPABASE_SERVICE_ROLE_KEY", "") or _env.get("VITE_SUPABASE_ANON_KEY", "")
HL_API_URL = "https://api.hyperliquid.xyz/info"

# ── Asset mapping ─────────────────────────────────────────────────────────────

# DB asset_id (lowercase) → Hyperliquid perpetual symbol
ASSET_TO_HL: dict[str, str] = {
    "btc":    "BTC",
    "eth":    "ETH",
    "sol":    "SOL",
    "hype":   "HYPE",
    "zec":    "ZEC",
    "aapl":   "AAPL",
    "nvda":   "NVDA",
    "msft":   "MSFT",
    "gold":   "GOLD",
    "oil":    "OIL",
    "amzn":   "AMZN",
    "meta":   "META",
    "tsla":   "TSLA",
    "spx":    "SPX500",
    "googl":  "GOOGL",
    "intc":   "INTC",
    "sndk":   "SNDK",
    "skhx":   "SKHX",
    "natgas": "NATGAS",
    "copper": "COPPER",
    "silver": "SILVER",
    "spcx":   "SPCX",
}

WINDOWS_HOURS = [1, 4, 12, 24, 48]
CONTINUED_THRESHOLD_PCT = 2.0  # min % move to count as "continued in direction"

# ── Supabase ──────────────────────────────────────────────────────────────────


def fetch_positions(
    close_reason_filter: Optional[str] = None,
    asset_filter: Optional[str] = None,
) -> list[dict]:
    """Fetch closed positions from Supabase via PostgREST."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        sys.exit("ERROR: Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env")

    params: dict[str, str] = {
        "status": "eq.closed",
        "select": (
            "id,asset_id,side,close_reason,"
            "entry_price,current_price,closed_pnl_pct,"
            "trailing_stop_peak_pnl_pct,size_usd,"
            "created_at,closed_at"
        ),
        "order": "closed_at.desc",
        "limit": "1000",
    }
    if close_reason_filter:
        params["close_reason"] = f"eq.{close_reason_filter}"
    if asset_filter:
        params["asset_id"] = f"eq.{asset_filter.lower()}"

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }

    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/positions",
        params=params,
        headers=headers,
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


# ── Hyperliquid ───────────────────────────────────────────────────────────────


def fetch_hl_candles(coin: str, start_ms: int, end_ms: int) -> list[dict]:
    """
    Fetch 1h candles from Hyperliquid candleSnapshot API.
    Candle fields: t (open time ms), T (close time ms), o, h, l, c, v, n.
    Returns empty list on failure — caller handles gracefully.
    """
    payload = {
        "type": "candleSnapshot",
        "req": {
            "coin": coin,
            "interval": "1h",
            "startTime": start_ms,
            "endTime": end_ms,
        },
    }

    for attempt in range(4):
        try:
            resp = requests.post(HL_API_URL, json=payload, timeout=20)
            if resp.status_code == 429:
                wait = 10 * (attempt + 1)
                print(f"\n    ⚠️  Rate limited on {coin}. Waiting {wait}s...", flush=True)
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.json()
        except requests.exceptions.RequestException as e:
            if attempt == 3:
                print(f"\n    ✗ HL API failed for {coin}: {e}", flush=True)
                return []
            time.sleep(3 * (attempt + 1))

    return []


# ── Analysis ──────────────────────────────────────────────────────────────────


def _parse_ts(ts_str: str) -> int:
    """Parse Supabase timestamp string to milliseconds epoch."""
    # Normalise "+00" → "+00:00" for fromisoformat compatibility
    ts_str = ts_str.rstrip("Z")
    if ts_str.endswith("+00"):
        ts_str += ":00"
    elif "+" not in ts_str and ts_str[-6] not in ("+", "-"):
        ts_str += "+00:00"
    return int(datetime.fromisoformat(ts_str).timestamp() * 1000)


def compute_foregone(position: dict) -> dict:
    """
    Compute foregone move metrics for a single closed position.
    Returns a dict of metric columns, or {"error": "..."} on failure.
    """
    asset_id = position["asset_id"]
    coin = ASSET_TO_HL.get(asset_id)
    if coin is None:
        return {"error": f"No HL symbol mapping for {asset_id!r}"}

    closed_at_str = position.get("closed_at", "")
    if not closed_at_str:
        return {"error": "No closed_at timestamp"}

    try:
        close_ms = _parse_ts(closed_at_str)
    except (ValueError, TypeError) as e:
        return {"error": f"Cannot parse closed_at: {e}"}

    now_ms = int(time.time() * 1000)
    window_end_ms = min(close_ms + 48 * 3600 * 1000, now_ms)

    # Skip positions closed very recently (< 1h ago) — no window to analyse
    if window_end_ms - close_ms < 3600 * 1000:
        return {"error": "Position too recent — no 1h window yet"}

    candles = fetch_hl_candles(coin, close_ms, window_end_ms)
    if not candles:
        return {"error": f"No candles returned for {coin}"}

    try:
        bars = [
            {"t": int(c["t"]), "h": float(c["h"]), "l": float(c["l"]), "c": float(c["c"])}
            for c in candles
        ]
    except (KeyError, TypeError, ValueError) as e:
        return {"error": f"Malformed candle data for {coin}: {e}"}

    if not bars:
        return {"error": "Empty candle list after parsing"}

    # position-monitor sets current_price to the mark price at close time.
    # Confirmed correct: entry_price * (1 ± closed_pnl_pct/100) == current_price on real rows.
    close_price = float(position["current_price"] or 0)
    if close_price <= 0:
        return {"error": "Invalid close_price"}

    side = position["side"]
    result: dict = {}

    for window_h in WINDOWS_HOURS:
        cutoff_ms = close_ms + window_h * 3600 * 1000
        window_bars = [b for b in bars if b["t"] <= cutoff_ms]

        if not window_bars:
            result[f"foregone_{window_h}h"] = None
            result[f"end_pct_{window_h}h"] = None
            continue

        if side == "short":
            best_price = min(b["l"] for b in window_bars)
            foregone = (close_price - best_price) / close_price * 100
        else:
            best_price = max(b["h"] for b in window_bars)
            foregone = (best_price - close_price) / close_price * 100

        end_price = window_bars[-1]["c"]
        if side == "short":
            end_pct = (close_price - end_price) / close_price * 100
        else:
            end_pct = (end_price - close_price) / close_price * 100

        # Clamp foregone to 0 — negative means price moved against us (correct exit)
        result[f"foregone_{window_h}h"] = round(max(foregone, 0.0), 3)
        result[f"end_pct_{window_h}h"] = round(end_pct, 3)

    # continued_24h: did price continue >2% in trade direction within 24h?
    bars_24h = [b for b in bars if b["t"] <= close_ms + 24 * 3600 * 1000]
    if bars_24h:
        if side == "short":
            max_move = (close_price - min(b["l"] for b in bars_24h)) / close_price * 100
        else:
            max_move = (max(b["h"] for b in bars_24h) - close_price) / close_price * 100
        result["continued_24h"] = max_move >= CONTINUED_THRESHOLD_PCT
        result["max_additional_24h"] = round(max_move, 3)
    else:
        result["continued_24h"] = None
        result["max_additional_24h"] = None

    return result


def _signal_still_active(pos: dict) -> bool:
    """True if position was closed within 24h of opening."""
    try:
        open_ms = _parse_ts(pos["created_at"])
        close_ms = _parse_ts(pos["closed_at"])
        return (close_ms - open_ms) < 24 * 3600 * 1000
    except Exception:
        return False


# ── Summary printing ──────────────────────────────────────────────────────────


def _fmt_table(rows: list, headers: list) -> None:
    try:
        from tabulate import tabulate
        print(tabulate(rows, headers=headers, tablefmt="rounded_outline", floatfmt=".2f"))
    except ImportError:
        # Fallback: plain text
        col_widths = [max(len(str(h)), max((len(str(r[i])) for r in rows), default=0)) for i, h in enumerate(headers)]
        fmt = "  ".join(f"{{:<{w}}}" for w in col_widths)
        print(fmt.format(*headers))
        print("  ".join("-" * w for w in col_widths))
        for row in rows:
            print(fmt.format(*[str(x) for x in row]))


def print_summary(df: pd.DataFrame) -> None:
    total = len(df)
    error_count = df["error"].notna().sum() if "error" in df.columns else 0

    print(f"\n{'='*68}")
    print(f"  FOREGONE MOVE ANALYSIS  —  {total} positions  ({error_count} fetch errors)")
    print(f"{'='*68}")

    # ── Summary by close reason ──────────────────────────────────────────────
    print("\n── By close reason ─────────────────────────────────────────────────")
    reason_rows = []
    for reason, grp in df.groupby("close_reason"):
        fg = grp["foregone_24h"].dropna()
        cont = grp["continued_24h"].dropna()
        reason_rows.append([
            reason,
            len(grp),
            f"{fg.mean():.1f}%" if len(fg) else "—",
            f"{fg.median():.1f}%" if len(fg) else "—",
            f"{fg.quantile(0.9):.1f}%" if len(fg) >= 5 else "—",
            f"{cont.mean()*100:.0f}%" if len(cont) else "—",
        ])
    _fmt_table(reason_rows, ["Close reason", "N", "Avg foregone 24h", "Median", "P90", "% continued >2%"])

    # ── Trailing stops by asset ───────────────────────────────────────────────
    trail_df = df[df["close_reason"] == "trailing_stop"].copy()
    if not trail_df.empty:
        print("\n── Trailing stop exits: foregone move by asset ─────────────────────")
        asset_rows = []
        for asset, grp in trail_df.groupby("asset_id"):
            fg_24 = grp["foregone_24h"].dropna()
            fg_48 = grp["foregone_48h"].dropna()
            cont = grp["continued_24h"].dropna()
            asset_rows.append([
                asset.upper(),
                len(grp),
                f"{fg_24.mean():.1f}%" if len(fg_24) else "—",
                f"{fg_48.mean():.1f}%" if len(fg_48) else "—",
                f"{cont.mean()*100:.0f}%" if len(cont) else "—",
            ])
        asset_rows.sort(key=lambda r: r[0])
        _fmt_table(asset_rows, ["Asset", "N", "Avg foregone 24h", "Avg foregone 48h", "% continued >2%"])

    # ── Signal still active at trailing stop close ────────────────────────────
    if not trail_df.empty:
        active = trail_df[trail_df["signal_still_active"] == True]
        print(f"\n── Trailing stops where signal was still active (<24h after entry): {len(active)} trades ──")
        if not active.empty:
            fg = active["foregone_24h"].dropna()
            cont = active["continued_24h"].dropna()
            print(f"   Avg foregone 24h:        {fg.mean():.2f}%")
            print(f"   Median foregone 24h:     {fg.median():.2f}%")
            print(f"   % that continued >2%:    {cont.mean()*100:.0f}%  ({cont.sum():.0f}/{len(cont)} trades)")
            print(f"   → Re-entry profit if caught: avg {fg[cont].mean():.2f}% additional on those {cont.sum():.0f} trades")
        else:
            print("   None found.")

    # ── Distribution of foregone 24h (trailing stops) ────────────────────────
    if not trail_df.empty:
        fg = trail_df["foregone_24h"].dropna()
        print(f"\n── Trailing stop foregone 24h distribution  (n={len(fg)}) ─────────────")
        buckets = [
            ("  0–1%   minimal / correct exit",   fg[fg < 1].count()),
            ("  1–3%   small continued move",      fg[(fg >= 1)  & (fg < 3)].count()),
            ("  3–5%   moderate missed move",      fg[(fg >= 3)  & (fg < 5)].count()),
            ("  5–10%  significant missed move",   fg[(fg >= 5)  & (fg < 10)].count()),
            (" 10–20%  large missed move",         fg[(fg >= 10) & (fg < 20)].count()),
            (" 20%+    major missed move",         fg[fg >= 20].count()),
        ]
        for label, count in buckets:
            pct = count / len(fg) * 100 if len(fg) else 0
            bar = "█" * int(pct / 2)
            print(f"   {label:<38}  {count:3d}  {pct:4.0f}%  {bar}")

    # ── Top 10 missed opportunities ───────────────────────────────────────────
    print("\n── Top 10 biggest missed opportunities ─────────────────────────────")
    top = (
        df.nlargest(10, "foregone_24h")[
            ["asset_id", "side", "close_reason", "closed_pnl_pct",
             "trailing_stop_peak_pnl_pct", "foregone_24h", "foregone_48h",
             "signal_still_active", "closed_at"]
        ]
        .copy()
    )
    top["closed_at"] = pd.to_datetime(top["closed_at"]).dt.strftime("%Y-%m-%d")
    top["asset_id"] = top["asset_id"].str.upper()
    _fmt_table(
        top.values.tolist(),
        ["Asset", "Side", "Reason", "Locked%", "Peak%", "Foregone 24h", "Foregone 48h", "Sig active", "Date"],
    )


# ── Main ──────────────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(description="Foregone move analysis on closed positions")
    parser.add_argument("--close-reason", metavar="REASON", help="Filter: trailing_stop | stop_loss | bb2_expiry")
    parser.add_argument("--asset", metavar="ASSET", help="Filter by asset_id, e.g. zec")
    parser.add_argument("--output", default="foregone_move_analysis.csv", help="CSV output path (default: foregone_move_analysis.csv)")
    args = parser.parse_args()

    print("Fetching closed positions from Supabase...")
    positions = fetch_positions(args.close_reason, args.asset)
    print(f"  → {len(positions)} positions to analyse")

    if not positions:
        print("No positions matched. Nothing to do.")
        return

    print(f"\nFetching Hyperliquid candles for each position (48h window, 1h bars)...")
    print(f"  Estimated time: ~{len(positions) * 0.3 / 60:.0f}–{len(positions) * 0.5 / 60:.0f} min with rate limiting\n")

    results: list[dict] = []
    errors = 0

    for i, pos in enumerate(positions):
        asset_id = pos["asset_id"].upper()
        closed_date = (pos.get("closed_at") or "")[:10]
        progress = (i + 1) / len(positions) * 100
        print(f"  [{i+1:3d}/{len(positions)}] {progress:4.0f}%  {asset_id:8s} {pos['side']:5s}  {closed_date}", end="\r", flush=True)

        row: dict = {
            "id":                        pos["id"],
            "asset_id":                  pos["asset_id"],
            "side":                      pos["side"],
            "close_reason":              pos.get("close_reason") or "",
            "entry_price":               pos.get("entry_price"),
            "close_price":               pos.get("current_price"),
            "closed_pnl_pct":            pos.get("closed_pnl_pct"),
            "trailing_stop_peak_pnl_pct": pos.get("trailing_stop_peak_pnl_pct"),
            "size_usd":                  pos.get("size_usd"),
            "created_at":                pos.get("created_at"),
            "closed_at":                 pos.get("closed_at"),
            "signal_still_active":       _signal_still_active(pos),
            "error":                     None,
        }

        foregone = compute_foregone(pos)
        if "error" in foregone:
            row["error"] = foregone["error"]
            errors += 1
        else:
            row.update(foregone)

        results.append(row)
        time.sleep(0.3)  # ~3 req/s — stay well within HL rate limits

    print(f"\n\n  Processed: {len(results)}   Errors: {errors}")

    df = pd.DataFrame(results)
    output_path = Path(args.output)
    df.to_csv(output_path, index=False)
    print(f"  Full results saved → {output_path}")

    print_summary(df)


if __name__ == "__main__":
    main()
