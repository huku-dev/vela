#!/usr/bin/env python3
"""
Vela Backtesting Engine
=======================
Fetches historical OHLC data from CoinGecko, calculates technical
indicators (EMA-9, EMA-21, RSI-14, SMA-50, ADX-14), applies Vela's
exact signal logic from the Supabase Edge Function, simulates
bidirectional paper trades, and writes results to Supabase.

Signal logic faithfully replicates `supabase/functions/_shared/signal-rules.ts`:
  - Core trigger: EMA 9/21 crossover (not price-above-EMA)
  - GREEN: bullish cross + ADX >= 20 + RSI 40-70 + price > SMA-50 + no recent bearish cross
  - RED:   bearish cross + ADX >= 20 + RSI 30-60 + price < SMA-50 + no recent bullish cross
  - Override: stop-loss (8%) and trend-break (price < SMA-50 while long)
  - GREY: everything else (chop, RSI out of range, trend disagree, anti-whipsaw, no cross)

Bidirectional trading:
  - Opens LONG on GREEN, closes LONG on RED (or stop-loss/trend-break)
  - Opens SHORT on RED, closes SHORT on GREEN
  This tests whether the model identifies good entry AND exit timing in both directions.

Usage:
    python scripts/backtest.py                       # backtest all enabled assets, 180 days
    python scripts/backtest.py --asset bitcoin       # single asset
    python scripts/backtest.py --days 365            # custom lookback
    python scripts/backtest.py --dry-run             # print trades without writing to Supabase

Requires:
    pip install -r scripts/requirements-backtest.txt
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Supabase connection — use the frontend's .env file
ENV_PATH = Path(__file__).resolve().parent.parent / ".env"


def load_env() -> dict[str, str]:
    """Parse KEY=VALUE pairs from .env (no shell expansion)."""
    env = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


_env = load_env()
SUPABASE_URL = _env.get("VITE_SUPABASE_URL", "")
SUPABASE_KEY = _env.get("VITE_SUPABASE_ANON_KEY", "")

def _require_supabase_keys() -> None:
    """Validate Supabase keys are present. Called in main(), not at import time."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        sys.exit("ERROR: Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env")

COINGECKO_BASE = "https://api.coingecko.com/api/v3"

# CoinGecko free-tier rate limit: ~10-30 calls/min. We add a generous sleep.
CG_SLEEP_SECONDS = 6

# Hyperliquid API (primary data source — real OHLCV, no 365-day cap)
HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info"
HL_SLEEP_SECONDS = 2  # generous rate limit (1,200 weight/min)

# Symbol mapping: CoinGecko ID → Hyperliquid perpetual symbol
ASSETS_HL = {
    "bitcoin": "BTC",
    "ethereum": "ETH",
    "hyperliquid": "HYPE",
}

# Default position size for P&L calculations (matches frontend DEFAULT_POSITION_SIZE)
POSITION_SIZE_USD = 1000

# ---------------------------------------------------------------------------
# Signal configuration — mirrors DEFAULT_CONFIG from signal-rules.ts
# ---------------------------------------------------------------------------

SIGNAL_CONFIG = {
    "name": "Current (Live)",
    "rsi_long_entry_min": 40,
    "rsi_long_entry_max": 70,
    "rsi_short_entry_min": 30,
    "rsi_short_entry_max": 60,
    "adx_threshold": 20,
    "stop_loss_pct": 8,
    "anti_whipsaw_window": 3,  # bars to look back for recent opposing cross
    # Yellow event thresholds (from checkYellowEvents in signal-rules.ts)
    "rsi_yellow_threshold": 78,   # take_profit: suggest trimming 25-30%
    "rsi_orange_threshold": 85,   # strong_take_profit: suggest trimming 50%+
    "trim_pct_yellow": 0.25,      # trim 25% of position on yellow
    "trim_pct_orange": 0.50,      # trim 50% of position on orange
    # v1 behavior: no grace period, instant trend-break, pct-of-remaining trims
    "grace_period_days": 0,           # overrides disabled for N days after entry
    "trend_break_confirm_days": 1,    # consecutive days below SMA-50 to trigger
    "trim_mode": "pct_of_remaining",  # "pct_of_remaining" or "pct_of_original"
    # Reverse yellow for shorts (disabled in v1)
    "rsi_short_yellow_threshold": 0,  # 0 = disabled
    "rsi_short_orange_threshold": 0,  # 0 = disabled
}

# ---------------------------------------------------------------------------
# Improved config — proposed A/B test variant
# ---------------------------------------------------------------------------

IMPROVED_CONFIG = {
    "name": "Enhanced v3",
    # Entry rules unchanged — RSI zone widening had zero impact
    "rsi_long_entry_min": 40,
    "rsi_long_entry_max": 70,
    "rsi_short_entry_min": 30,
    "rsi_short_entry_max": 60,
    "adx_threshold": 20,
    "stop_loss_pct": 8,  # fallback if ATR unavailable
    "anti_whipsaw_window": 3,
    "rsi_yellow_threshold": 78,
    "rsi_orange_threshold": 85,
    "trim_pct_yellow": 0.25,
    "trim_pct_orange": 0.50,
    # [KEEP] 5-day grace period — saved BTC June long (+$81 improvement)
    "grace_period_days": 5,
    # [REVERT] Keep 1-day trend-break — 2-day made ETH loss 4.5x worse
    "trend_break_confirm_days": 1,
    # [KEEP] Fixed trim sizing — +$123 more from HYPE trims
    "trim_mode": "pct_of_original",
    # [KEEP] Reverse yellow for shorts — new $74 revenue, no downside
    "rsi_short_yellow_threshold": 22,
    "rsi_short_orange_threshold": 15,
    # ── NEW: Volume confirmation on entries ──
    # Require volume_ratio > threshold on EMA cross day to confirm entry
    # Filters out low-conviction crosses that happen on thin volume
    # Note: 0.8 = allow slightly below-average volume; higher = stricter
    # Too strict (>1.0) blocked HYPE's best trade. 0.8 catches truly thin volume.
    "volume_confirm": True,
    "volume_entry_threshold": 0.8,  # reject only clearly thin volume (<80% of avg)
    # ── NEW: ATR-based dynamic stop-loss ──
    # Replace fixed 8% stop with 2× ATR(14) as percentage of price
    # Adapts to each asset's volatility (tight for BTC, wide for HYPE)
    "atr_stop_loss": True,
    "atr_stop_multiplier": 2.0,
    # ── NEW: BTC correlation / macro regime filter ──
    # If BTC drops > threshold in a single day, close altcoin longs defensively
    # Only applies to non-BTC assets
    "btc_crash_filter": True,
    "btc_crash_threshold": -5.0,  # BTC daily return < -5% triggers defensive close
    # ── NEW: Portfolio-level drawdown circuit breaker ──
    # If total unrealized P&L across all positions drops below threshold,
    # close everything. Applied in multi-asset mode only.
    "portfolio_circuit_breaker": True,
    "circuit_breaker_pct": -10.0,  # close all if portfolio drawdown > 10%
    # ── NEW: RSI Bollinger Band complementary signal ──
    # Mean-reversion signal for choppy/ranging markets
    # COMPLEMENTARY ONLY — does not override EMA cross signals
    # Generates additional short-duration trades when RSI touches BB extremes
    "rsi_bb_complementary": True,
    "rsi_bb_hold_days": 3,  # max days to hold (shorter = less exposure to trends)
    "rsi_bb_stop_pct": 5.0,  # max loss on BB trade before closing (limits damage)
    # ── NEW: BB trend filter ──
    # Only allow BB longs when price > SMA-50 (uptrend confirms dip-buying)
    # Only allow BB shorts when price < SMA-50 (downtrend confirms fade-selling)
    # Prevents mean-reversion trades from fighting the prevailing trend
    "rsi_bb_trend_filter": True,
    # ── NEW: BB cooldown after stop-out ──
    # After a BB stop-loss, wait N days before opening another BB in same direction
    # Prevents back-to-back losses during strong directional moves (e.g. ETH May 2025)
    "rsi_bb_cooldown_days": 3,
}

# ---------------------------------------------------------------------------
# V4 proposed configs — Signal Integrity Framework backtests
# Each isolates a single change for A/B comparison, plus a combined variant.
# ---------------------------------------------------------------------------

# Change 2: Confirmation-based entry gates
# Require 2 consecutive green/red signals before opening a NEW position.
# Filters out whipsaws — if a cross doesn't persist for 2 cycles, it's noise.
V4_CONFIRMATION_ONLY = {
    **IMPROVED_CONFIG,
    "name": "V4a: +Confirmation Gates",
    "confirmation_bars": 2,  # consecutive green/red signals required before entry
}

# Change 3: RSI velocity detection
# Detect rapid RSI moves (≥15 points in one cycle) as early warnings.
# Catches the MOVE toward extremes, not the extreme itself.
V4_RSI_VELOCITY_ONLY = {
    **IMPROVED_CONFIG,
    "name": "V4b: +RSI Velocity",
    "rsi_velocity_enabled": True,
    "rsi_velocity_threshold": 15,     # RSI change of ≥15 points in one bar
    "rsi_velocity_action": "warn",    # "warn" = yellow event, "close" = override
}

# Combined: both changes together (ATR protection already in Enhanced v3)
V4_COMBINED = {
    **IMPROVED_CONFIG,
    "name": "V4c: Combined",
    "confirmation_bars": 2,
    "rsi_velocity_enabled": True,
    "rsi_velocity_threshold": 15,
    "rsi_velocity_action": "warn",
}

# Conservative: stricter thresholds
V4_CONSERVATIVE = {
    **IMPROVED_CONFIG,
    "name": "V4d: Conservative",
    "confirmation_bars": 3,
    "rsi_velocity_enabled": True,
    "rsi_velocity_threshold": 10,
    "rsi_velocity_action": "close",   # force-close instead of just warning
}

# ---------------------------------------------------------------------------
# V5 trade velocity strategies — increase trade frequency with quality trades
# Each strategy is independently toggleable; combinations tested via named variants.
# ---------------------------------------------------------------------------

# V5 base: disables old BB (replaced by new strategies), all new strategies off by default
V5_BASE = {
    **IMPROVED_CONFIG,
    "name": "V5 Base",
    "rsi_bb_complementary": False,  # Disable old BB (replaced by improved strategies)

    # Strategy 1: Profit-Taking Ladder — trim at milestones (locks in gains progressively)
    "profit_ladder_enabled": False,
    "profit_ladder_levels": [15, 25, 35],          # % profit thresholds
    "profit_ladder_fractions": [0.10, 0.10, 0.10],  # fraction of original to trim at each level

    # Strategy 2: Pullback Re-entry — add to winners on dips to EMA support
    "pullback_reentry": False,
    "pullback_ema_buffer_pct": 0.5,   # price within 0.5% of EMA-9
    "pullback_min_profit_pct": 5.0,   # position must be +5% in profit
    "pullback_add_frac": 0.25,        # add 25% of original position size
    "pullback_max_adds": 2,           # max 2 pullback adds per position

    # Strategy 3: DCA Scaling — build positions gradually across multiple bars
    "dca_enabled": False,
    "dca_tranches": [0.25, 0.25, 0.25, 0.25],  # 4 tranches, 25% each
    "dca_interval_bars": 2,            # fill next tranche every 2 bars
    "dca_max_adverse_pct": 3.0,        # cancel if price moves >3% against

    # Strategy 4: Improved BB (BB2) — tighter bands, shorter hold, tighter stop
    "bb_improved": False,
    "bb_improved_lookback": 10,        # BB window (vs 20 for old BB)
    "bb_improved_std_mult": 1.5,       # tighter bands (vs 2.0) = more signals
    "bb_improved_hold_days": 2,        # shorter hold (vs 3) = less trend risk
    "bb_improved_stop_pct": 3.0,       # tighter stop (vs 5%) = cut losers faster
    "bb_improved_position_mult": 0.3,  # smaller position (vs 0.5×) = less drag when wrong
    "bb_improved_cooldown_days": 2,    # shorter cooldown (vs 3)
}

# V5a: Profit-Taking Ladder only
V5A_LADDER = {
    **V5_BASE,
    "name": "V5a: Profit Ladder",
    "profit_ladder_enabled": True,
}

# V5b: Pullback Re-entry only
V5B_PULLBACK = {
    **V5_BASE,
    "name": "V5b: Pullback Re-entry",
    "pullback_reentry": True,
}

# V5c: DCA Scaling only
V5C_DCA = {
    **V5_BASE,
    "name": "V5c: DCA Scaling",
    "dca_enabled": True,
}

# V5d: Improved BB only (BB2)
V5D_BB_IMPROVED = {
    **V5_BASE,
    "name": "V5d: Improved BB",
    "bb_improved": True,
}

# V5e: Ladder + Pullback (recommended combo — both act on winning positions)
V5E_LADDER_PULLBACK = {
    **V5_BASE,
    "name": "V5e: Ladder + Pullback",
    "profit_ladder_enabled": True,
    "pullback_reentry": True,
}

# V5f: Full suite — Ladder + Pullback + BB2
V5F_FULL_SUITE = {
    **V5_BASE,
    "name": "V5f: Full Suite",
    "profit_ladder_enabled": True,
    "pullback_reentry": True,
    "bb_improved": True,
}

# V5g: Ladder + DCA + Pullback (no BB)
V5G_NO_BB = {
    **V5_BASE,
    "name": "V5g: Ladder+DCA+Pullback",
    "profit_ladder_enabled": True,
    "pullback_reentry": True,
    "dca_enabled": True,
}

# V5h: Ladder + DCA (no pullback, no BB2) — data-driven winner combo
V5H_LADDER_DCA = {
    **V5_BASE,
    "name": "V5h: Ladder + DCA",
    "profit_ladder_enabled": True,
    "dca_enabled": True,
}

# ---------------------------------------------------------------------------
# V6: Short Profit Capture variants
# The signal engine correctly identifies short opportunities (8 of 15 went
# 6-48% in-the-money) but fails to capture profits. V6 tests three exit
# improvement strategies: trailing stop, aggressive ladder, and both combined.
# All three also disable short re-entries (-$305 aggregate, zero upside).
# ---------------------------------------------------------------------------

# V6a: Trailing stop for shorts — close if profit retraces from peak
V6A_TRAILING_STOP = {
    **V5F_FULL_SUITE,
    "name": "V6a: Trailing Stop",
    "trailing_stop_short": True,
    "trailing_stop_activation_pct": 5.0,  # Start trailing after 5% profit
    "trailing_stop_trail_pct": 2.5,       # Close if retraces 2.5% from peak
    "pullback_reentry_short": False,      # Disable short re-entries
}

# EXPERIMENTAL — not adopted, kept for reference only.
# V6b: Aggressive ladder for shorts — more levels, bigger trims, earlier start
V6B_AGGRESSIVE_LADDER = {
    **V5F_FULL_SUITE,
    "name": "V6b: Aggressive Ladder",
    "short_ladder_levels": [5, 10, 15, 20, 30],
    "short_ladder_fractions": [0.15, 0.15, 0.20, 0.15, 0.15],  # 80% trimmed by +30%
    "pullback_reentry_short": False,
}

# EXPERIMENTAL — not adopted, kept for reference only.
# V6c: Combined — trailing stop + aggressive ladder (belt and suspenders)
V6C_COMBINED = {
    **V5F_FULL_SUITE,
    "name": "V6c: Trailing + Aggressive Ladder",
    "trailing_stop_short": True,
    "trailing_stop_activation_pct": 5.0,
    "trailing_stop_trail_pct": 2.5,
    "short_ladder_levels": [5, 10, 15, 20, 30],
    "short_ladder_fractions": [0.15, 0.15, 0.20, 0.15, 0.15],
    "pullback_reentry_short": False,
}

# ---------------------------------------------------------------------------
# V6 ADOPTED BASELINE — V6a trailing stop is the production strategy.
# V6b (Aggressive Ladder) and V6c (Combined) remain experimental.
# ---------------------------------------------------------------------------
V6_ADOPTED = {**V6A_TRAILING_STOP, "name": "V6 Adopted (Trailing Stop)"}

# V6d: Trailing stop for BOTH directions — backtest experiment to determine
# whether longs also benefit from trailing stop (same 5%/2.5% thresholds).
V6D_TRAILING_BOTH = {
    **V6A_TRAILING_STOP,
    "name": "V6d: Trailing Stop (Both Directions)",
    "trailing_stop_long": True,
}

# Registry for CLI --config-a / --config-b selection
NAMED_CONFIGS = {
    "current": SIGNAL_CONFIG,
    "improved": IMPROVED_CONFIG,
    "v4a_confirmation": V4_CONFIRMATION_ONLY,
    "v4b_rsi_velocity": V4_RSI_VELOCITY_ONLY,
    "v4c_combined": V4_COMBINED,
    "v4d_conservative": V4_CONSERVATIVE,
    "v5a_ladder": V5A_LADDER,
    "v5b_pullback": V5B_PULLBACK,
    "v5c_dca": V5C_DCA,
    "v5d_bb_improved": V5D_BB_IMPROVED,
    "v5e_ladder_pullback": V5E_LADDER_PULLBACK,
    "v5f_full_suite": V5F_FULL_SUITE,
    "v5g_no_bb": V5G_NO_BB,
    "v5h_ladder_dca": V5H_LADDER_DCA,
    "v6a_trailing_stop": V6A_TRAILING_STOP,
    "v6b_aggressive_ladder": V6B_AGGRESSIVE_LADDER,
    "v6c_combined": V6C_COMBINED,
    "adopted": V6_ADOPTED,
    "v6d_trailing_both": V6D_TRAILING_BOTH,
}


# ---------------------------------------------------------------------------
# Confidence tier system for leverage decisions
# ---------------------------------------------------------------------------

# Leverage config for each scenario
LEVERAGE_CONFIGS = {
    "spot_only": {
        "name": "Spot Only (1x)",
        "tier_a_leverage": 1.0,
        "tier_b_leverage": 1.0,
        "tier_c_leverage": 1.0,
        "bb_leverage": 1.0,
    },
    "tiered": {
        "name": "Confidence-Tiered (1-3x)",
        "tier_a_leverage": 3.0,  # High conviction: 3x
        "tier_b_leverage": 1.0,  # Standard: spot
        "tier_c_leverage": 0.5,  # Weak: half size
        "bb_leverage": 0.5,      # BB trades always half size
        # Failsafes
        "max_portfolio_leverage": 3.0,
        "leveraged_stop_mult": 0.5,  # Tighter stop on leveraged trades (1× ATR instead of 2×)
    },
    "flat_2x": {
        "name": "Flat 2x Leverage",
        "tier_a_leverage": 2.0,
        "tier_b_leverage": 2.0,
        "tier_c_leverage": 2.0,
        "bb_leverage": 1.0,      # BB still half (2x * 0.5 = 1x)
    },
}


def compute_confidence_tier(
    row: pd.Series,
    direction: str,
    config: dict = IMPROVED_CONFIG,
) -> str:
    """
    Evaluate signal confidence based on indicator alignment at entry.

    Tier A (High Conviction): All filters pass strongly
      - ADX > 25 (strong trend, not just above threshold)
      - Volume ratio > 1.2 (above-average volume)
      - ATR below median (low volatility = tighter risk)
      - RSI in sweet spot (not near extremes of allowed range)

    Tier B (Standard): Normal signal, all filters pass
      - Standard GREEN/RED signal conditions met

    Tier C (Weak): Signal barely passes
      - ADX 20-22 (just above threshold)
      - OR volume ratio < 1.0 (below average)
      - OR RSI near boundary of allowed range

    Returns: 'A', 'B', or 'C'
    """
    adx = row.get("adx", 0)
    volume_ratio = row.get("volume_ratio", 1.0)
    atr_pct = row.get("atr_pct", float("nan"))
    rsi = row.get("rsi_14", 50)

    # Count "strong" indicators
    strong_signals = 0
    weak_signals = 0

    # ADX strength
    if adx >= 25:
        strong_signals += 1
    elif adx < 22:
        weak_signals += 1

    # Volume strength
    if not pd.isna(volume_ratio):
        if volume_ratio >= 1.2:
            strong_signals += 1
        elif volume_ratio < 1.0:
            weak_signals += 1

    # ATR (volatility) — low ATR is favorable for leverage
    if not pd.isna(atr_pct):
        if atr_pct < 3.0:  # Low volatility
            strong_signals += 1
        elif atr_pct > 5.0:  # High volatility
            weak_signals += 1

    # RSI position within allowed range
    if direction == "long":
        rsi_min, rsi_max = config["rsi_long_entry_min"], config["rsi_long_entry_max"]
        rsi_mid = (rsi_min + rsi_max) / 2
        if abs(rsi - rsi_mid) < 8:  # Near center of range
            strong_signals += 1
        elif rsi < rsi_min + 3 or rsi > rsi_max - 3:  # Near edges
            weak_signals += 1
    else:  # short
        rsi_min, rsi_max = config["rsi_short_entry_min"], config["rsi_short_entry_max"]
        rsi_mid = (rsi_min + rsi_max) / 2
        if abs(rsi - rsi_mid) < 8:
            strong_signals += 1
        elif rsi < rsi_min + 3 or rsi > rsi_max - 3:
            weak_signals += 1

    # Determine tier
    if strong_signals >= 3 and weak_signals == 0:
        return "A"
    elif weak_signals >= 2:
        return "C"
    else:
        return "B"


# ---------------------------------------------------------------------------
# 1. Fetch historical OHLC from CoinGecko
# ---------------------------------------------------------------------------


def fetch_historical_ohlc(coingecko_id: str, days: int = 180) -> pd.DataFrame:
    """
    Fetch daily OHLC data from CoinGecko's market_chart endpoint.

    Returns a DataFrame with columns: [timestamp, open, high, low, close]
    indexed by date.

    Note: CoinGecko free tier caps at 365 days. For longer periods, we
    automatically cap and warn.
    """
    actual_days = days
    if days > 365:
        print(f"  ⚠️  CoinGecko free tier caps at 365 days. Capping request (asked {days}).")
        actual_days = 365

    url = f"{COINGECKO_BASE}/coins/{coingecko_id}/market_chart"
    params = {"vs_currency": "usd", "days": actual_days, "interval": "daily"}

    print(f"  Fetching {actual_days} days of price data for '{coingecko_id}'...")
    for attempt in range(3):
        resp = requests.get(url, params=params, timeout=30)
        if resp.status_code == 429:
            wait = 30 * (attempt + 1)
            print(f"  ⚠️  Rate limited. Waiting {wait}s before retry ({attempt + 1}/3)...")
            time.sleep(wait)
            continue
        resp.raise_for_status()
        break
    else:
        raise RuntimeError(f"CoinGecko rate limit exceeded after 3 retries for {coingecko_id}")
    data = resp.json()

    prices = data.get("prices", [])
    volumes = data.get("total_volumes", [])
    if not prices:
        raise ValueError(f"No price data returned for {coingecko_id}")

    df = pd.DataFrame(prices, columns=["timestamp_ms", "close"])
    df["date"] = pd.to_datetime(df["timestamp_ms"], unit="ms", utc=True).dt.date
    df = df.drop_duplicates(subset="date", keep="last")
    df = df.set_index("date").sort_index()
    df = df.drop(columns=["timestamp_ms"])

    # Add volume data
    if volumes:
        vol_df = pd.DataFrame(volumes, columns=["timestamp_ms", "volume"])
        vol_df["date"] = pd.to_datetime(vol_df["timestamp_ms"], unit="ms", utc=True).dt.date
        vol_df = vol_df.drop_duplicates(subset="date", keep="last").set_index("date")
        df["volume"] = vol_df["volume"]
    else:
        df["volume"] = 0.0

    # market_chart only gives close prices. We approximate OHLC:
    # For our indicators (EMA, SMA, RSI) close is all we need.
    # ADX requires high/low — we approximate from close-based volatility.
    df["open"] = df["close"].shift(1).fillna(df["close"])
    df["high"] = df["close"] * 1.005  # ~0.5% band approximation
    df["low"] = df["close"] * 0.995

    print(f"  Got {len(df)} daily candles ({df.index[0]} to {df.index[-1]})")
    return df


def fetch_historical_ohlc_hyperliquid(coingecko_id: str, days: int = 365) -> pd.DataFrame:
    """
    Fetch daily OHLC data from Hyperliquid's candleSnapshot API.

    Primary data source for Vela backtests. Returns real OHLCV data (not
    approximated from close like CoinGecko), which improves ADX/ATR accuracy.

    Max 5,000 candles per request. For longer periods, paginates automatically.
    No authentication required.
    """
    symbol = ASSETS_HL.get(coingecko_id)
    if symbol is None:
        raise ValueError(
            f"No Hyperliquid symbol mapping for '{coingecko_id}'. "
            f"Known: {list(ASSETS_HL.keys())}"
        )

    end_ms = int(time.time() * 1000)
    start_ms = end_ms - (days * 24 * 60 * 60 * 1000)

    print(f"  Fetching {days} days of price data for '{symbol}' from Hyperliquid...")

    all_candles = []
    current_start = start_ms

    while current_start < end_ms:
        payload = {
            "type": "candleSnapshot",
            "req": {
                "coin": symbol,
                "interval": "1d",
                "startTime": current_start,
                "endTime": end_ms,
            },
        }

        for attempt in range(3):
            try:
                resp = requests.post(HYPERLIQUID_INFO_URL, json=payload, timeout=30)
                if resp.status_code == 429:
                    wait = 10 * (attempt + 1)
                    print(f"  ⚠️  Rate limited. Waiting {wait}s ({attempt + 1}/3)...")
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                break
            except requests.exceptions.RequestException as e:
                if attempt == 2:
                    raise RuntimeError(f"Hyperliquid API failed after 3 retries for {symbol}: {e}")
                time.sleep(5)
        else:
            raise RuntimeError(f"Hyperliquid rate limit exceeded for {symbol}")

        candles = resp.json()
        if not candles:
            break

        all_candles.extend(candles)

        # If we got fewer than 5000 candles, we've reached the end
        if len(candles) < 5000:
            break

        # Paginate: move start past the last candle we received
        last_close_ms = candles[-1].get("T", candles[-1].get("t", 0))
        if last_close_ms <= current_start:
            break  # prevent infinite loop
        current_start = last_close_ms + 1
        time.sleep(HL_SLEEP_SECONDS)

    if not all_candles:
        raise ValueError(f"No candle data returned from Hyperliquid for {symbol}")

    # Parse Hyperliquid response: {t, T, s, i, o, c, h, l, v, n}
    rows = []
    for c in all_candles:
        rows.append({
            "timestamp_ms": c["t"],  # open time in ms
            "open": float(c["o"]),
            "high": float(c["h"]),
            "low": float(c["l"]),
            "close": float(c["c"]),
            "volume": float(c["v"]),
        })

    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["timestamp_ms"], unit="ms", utc=True).dt.date
    df = df.drop_duplicates(subset="date", keep="last")
    df = df.set_index("date").sort_index()
    df = df.drop(columns=["timestamp_ms"])

    # Trim to requested date range
    from datetime import date as date_type
    cutoff = date_type.fromtimestamp(start_ms / 1000)
    df = df[df.index >= cutoff]

    print(f"  Got {len(df)} daily candles ({df.index[0]} to {df.index[-1]}) [Hyperliquid]")
    return df


def fetch_ohlc(coingecko_id: str, days: int = 365, source: str = "hyperliquid") -> pd.DataFrame:
    """
    Unified data fetcher. Hyperliquid is primary, CoinGecko is fallback.
    """
    if source == "hyperliquid":
        try:
            return fetch_historical_ohlc_hyperliquid(coingecko_id, days)
        except Exception as e:
            print(f"  ⚠️  Hyperliquid fetch failed: {e}")
            print(f"  Falling back to CoinGecko...")
            return fetch_historical_ohlc(coingecko_id, min(days, 365))
    else:
        return fetch_historical_ohlc(coingecko_id, days)


# ---------------------------------------------------------------------------
# 2. Calculate technical indicators
# ---------------------------------------------------------------------------


def calculate_ema(series: pd.Series, span: int) -> pd.Series:
    """Exponential Moving Average."""
    return series.ewm(span=span, adjust=False).mean()


def calculate_sma(series: pd.Series, window: int) -> pd.Series:
    """Simple Moving Average."""
    return series.rolling(window=window, min_periods=window).mean()


def calculate_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """Relative Strength Index (Wilder's smoothing)."""
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
    avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()

    rs = avg_gain / avg_loss.replace(0, float("nan"))
    rsi = 100 - (100 / (1 + rs))
    return rsi


def calculate_adx_atr(df: pd.DataFrame, period: int = 14) -> tuple[pd.Series, pd.Series]:
    """
    Average Directional Index and Average True Range.

    Returns (adx, atr) tuple.
    Uses high/low/close columns. Since we approximate H/L from close,
    this will be a rough estimate — but directionally useful.
    """
    high = df["high"]
    low = df["low"]
    close = df["close"]

    plus_dm = high.diff()
    minus_dm = -low.diff()

    plus_dm = plus_dm.where((plus_dm > minus_dm) & (plus_dm > 0), 0.0)
    minus_dm = minus_dm.where((minus_dm > plus_dm) & (minus_dm > 0), 0.0)

    tr = pd.concat(
        [high - low, (high - close.shift(1)).abs(), (low - close.shift(1)).abs()],
        axis=1,
    ).max(axis=1)

    atr = tr.ewm(span=period, adjust=False).mean()
    plus_di = 100 * (plus_dm.ewm(span=period, adjust=False).mean() / atr)
    minus_di = 100 * (minus_dm.ewm(span=period, adjust=False).mean() / atr)

    dx = (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, float("nan")) * 100
    adx = dx.ewm(span=period, adjust=False).mean()
    return adx, atr


def calculate_indicators(df: pd.DataFrame, config: dict = SIGNAL_CONFIG) -> pd.DataFrame:
    """Adds all Vela indicators to the DataFrame."""
    df = df.copy()
    df["ema_9"] = calculate_ema(df["close"], 9)
    df["ema_21"] = calculate_ema(df["close"], 21)
    df["rsi_14"] = calculate_rsi(df["close"], 14)
    df["sma_50"] = calculate_sma(df["close"], 50)
    adx, atr = calculate_adx_atr(df, 14)
    df["adx"] = adx
    df["atr_14"] = atr

    # --- ATR as percentage of price (for dynamic stop-loss) ---
    df["atr_pct"] = (df["atr_14"] / df["close"]) * 100

    # --- Volume indicators ---
    if "volume" in df.columns and df["volume"].sum() > 0:
        df["vma_20"] = calculate_sma(df["volume"], 20)
        df["volume_ratio"] = df["volume"] / df["vma_20"].replace(0, float("nan"))
    else:
        df["vma_20"] = float("nan")
        df["volume_ratio"] = 1.0  # neutral if no volume data

    # --- Daily return (for BTC correlation / crash detection) ---
    df["daily_return_pct"] = df["close"].pct_change() * 100

    # --- RSI Bollinger Bands (for complementary mean-reversion signal) ---
    rsi_sma = df["rsi_14"].rolling(window=20, min_periods=20).mean()
    rsi_std = df["rsi_14"].rolling(window=20, min_periods=20).std()
    df["rsi_bb_upper"] = rsi_sma + 2 * rsi_std
    df["rsi_bb_lower"] = rsi_sma - 2 * rsi_std
    df["rsi_below_bb"] = df["rsi_14"] < df["rsi_bb_lower"]
    df["rsi_above_bb"] = df["rsi_14"] > df["rsi_bb_upper"]

    # --- BB2: Improved RSI Bollinger Bands (tighter, for V5 strategy 4) ---
    bb2_lookback = config.get("bb_improved_lookback", 10)
    bb2_std_mult = config.get("bb_improved_std_mult", 1.5)
    rsi_sma2 = df["rsi_14"].rolling(window=bb2_lookback, min_periods=bb2_lookback).mean()
    rsi_std2 = df["rsi_14"].rolling(window=bb2_lookback, min_periods=bb2_lookback).std()
    df["rsi_bb2_upper"] = rsi_sma2 + bb2_std_mult * rsi_std2
    df["rsi_bb2_lower"] = rsi_sma2 - bb2_std_mult * rsi_std2
    df["rsi_below_bb2"] = df["rsi_14"] < df["rsi_bb2_lower"]
    df["rsi_above_bb2"] = df["rsi_14"] > df["rsi_bb2_upper"]

    # --- RSI velocity (bar-to-bar change) for rapid-move detection ---
    df["rsi_delta"] = df["rsi_14"].diff()  # positive = RSI rising, negative = falling

    # --- EMA 9/21 crossover detection ---
    df["ema_crossed_up"] = (df["ema_9"] > df["ema_21"]) & (
        df["ema_9"].shift(1) <= df["ema_21"].shift(1)
    )
    df["ema_crossed_down"] = (df["ema_9"] < df["ema_21"]) & (
        df["ema_9"].shift(1) >= df["ema_21"].shift(1)
    )

    # --- Anti-whipsaw: recent opposing cross within window ---
    window = config["anti_whipsaw_window"]
    df["recent_bearish_cross"] = (
        df["ema_crossed_down"]
        .rolling(window=window, min_periods=1)
        .sum()
        .shift(1)
        .fillna(0)
        .astype(bool)
    )
    df["recent_bullish_cross"] = (
        df["ema_crossed_up"]
        .rolling(window=window, min_periods=1)
        .sum()
        .shift(1)
        .fillna(0)
        .astype(bool)
    )

    # --- Consecutive days below SMA-50 (for trend-break confirmation) ---
    below_sma = (df["close"] < df["sma_50"]).astype(int)
    df["days_below_sma50"] = below_sma.groupby(
        (below_sma != below_sma.shift()).cumsum()
    ).cumsum()

    # Drop rows where indicators aren't fully warmed up
    df = df.dropna(subset=["ema_9", "ema_21", "rsi_14", "sma_50", "adx"])
    return df


# ---------------------------------------------------------------------------
# 3. Generate signals — exact replica of Supabase Edge Function logic
# ---------------------------------------------------------------------------


def evaluate_signal(
    row: pd.Series,
    open_trade: dict | None = None,
    config: dict = SIGNAL_CONFIG,
    bar_index: int = 0,
) -> tuple[str, str]:
    """
    Evaluate signal for a single bar. Based on evaluateSignal()
    from supabase/functions/_shared/signal-rules.ts, extended with:
      - Configurable grace period and trend-break confirmation
      - Volume confirmation on entries (require above-average volume)
      - ATR-based dynamic stop-loss (adapts to asset volatility)

    Returns (color, reason) tuple.
    """
    price = row["close"]
    ema9 = row["ema_9"]
    ema21 = row["ema_21"]
    rsi14 = row["rsi_14"]
    sma50 = row["sma_50"]
    adx4h = row["adx"]
    ema_crossed_up = row["ema_crossed_up"]
    ema_crossed_down = row["ema_crossed_down"]
    recent_bearish_cross = row["recent_bearish_cross"]
    recent_bullish_cross = row["recent_bullish_cross"]
    days_below_sma50 = row.get("days_below_sma50", 1)

    # Volume and ATR data (may be NaN early in the series)
    volume_ratio = row.get("volume_ratio", 1.0)
    atr_pct = row.get("atr_pct", float("nan"))

    # ── OVERRIDE CHECKS (fire regardless of cross) ──

    if open_trade is not None and open_trade.get("direction") == "long":
        # Check grace period: overrides disabled for N days after entry
        grace = config.get("grace_period_days", 0)
        days_in_trade = bar_index - open_trade.get("entry_bar_index", 0)
        overrides_active = days_in_trade >= grace

        if overrides_active:
            # Stop-loss: ATR-based dynamic or fixed fallback
            entry_price = open_trade["entry_price"]
            drawdown = (entry_price - price) / entry_price * 100

            if config.get("atr_stop_loss") and not pd.isna(atr_pct):
                # Dynamic stop: 2× ATR as percentage of price
                atr_stop = atr_pct * config.get("atr_stop_multiplier", 2.0)
                if drawdown >= atr_stop:
                    return ("red", "atr_stop_loss")
            else:
                # Fixed stop-loss fallback
                if drawdown >= config["stop_loss_pct"]:
                    return ("red", "stop_loss")

            # Trend break: price below SMA-50 for N consecutive days
            confirm_days = config.get("trend_break_confirm_days", 1)
            if days_below_sma50 >= confirm_days:
                return ("red", "trend_break")

    # ── ATR-based stop-loss for SHORT positions ──

    if open_trade is not None and open_trade.get("direction") == "short":
        grace = config.get("grace_period_days", 0)
        days_in_trade = bar_index - open_trade.get("entry_bar_index", 0)
        overrides_active = days_in_trade >= grace

        if overrides_active:
            entry_price = open_trade["entry_price"]
            # For shorts, loss is when price goes UP
            drawdown = (price - entry_price) / entry_price * 100

            if config.get("atr_stop_loss") and not pd.isna(atr_pct):
                atr_stop = atr_pct * config.get("atr_stop_multiplier", 2.0)
                if drawdown >= atr_stop:
                    return ("green", "atr_stop_loss")
            else:
                if drawdown >= config["stop_loss_pct"]:
                    return ("green", "stop_loss")

    # ── GREEN: Bullish EMA cross with all conditions ──

    if ema_crossed_up:
        # Check regime (trending market)
        if adx4h < config["adx_threshold"]:
            return ("grey", "chop")
        # Check RSI zone
        if rsi14 < config["rsi_long_entry_min"] or rsi14 > config["rsi_long_entry_max"]:
            return ("grey", "rsi_out_of_range")
        # Check trend filter
        if price < sma50:
            return ("grey", "trend_disagree")
        # Check anti-whipsaw
        if recent_bearish_cross:
            return ("grey", "anti_whipsaw")
        # Volume confirmation: require above-average volume on cross day
        if config.get("volume_confirm") and not pd.isna(volume_ratio):
            threshold = config.get("volume_entry_threshold", 1.2)
            if volume_ratio < threshold:
                return ("grey", "low_volume")
        # All conditions met
        return ("green", "ema_cross_up")

    # ── RED: Bearish EMA cross with all conditions ──

    if ema_crossed_down:
        # Check regime
        if adx4h < config["adx_threshold"]:
            return ("grey", "chop")
        # Check RSI zone
        if rsi14 < config["rsi_short_entry_min"] or rsi14 > config["rsi_short_entry_max"]:
            return ("grey", "rsi_out_of_range")
        # Check trend filter
        if price > sma50:
            return ("grey", "trend_disagree")
        # Check anti-whipsaw
        if recent_bullish_cross:
            return ("grey", "anti_whipsaw")
        # Volume confirmation
        if config.get("volume_confirm") and not pd.isna(volume_ratio):
            threshold = config.get("volume_entry_threshold", 1.2)
            if volume_ratio < threshold:
                return ("grey", "low_volume")
        # All conditions met
        return ("red", "ema_cross_down")

    # ── NO CROSS: Grey (no change) ──

    return ("grey", "no_change")


def generate_signals(df: pd.DataFrame, config: dict = SIGNAL_CONFIG) -> pd.DataFrame:
    """
    Apply Vela's exact signal rules to each row.

    Unlike the live system which is stateful (knows about open trades),
    we pass open_trade context for stop-loss/trend-break checks during
    the signal walk-through in simulate_trades().

    For the initial signal pass here, we evaluate without open_trade context
    to get the base signal. The trade simulator applies overrides.
    """
    df = df.copy()
    signals = []
    reasons = []

    for _, row in df.iterrows():
        color, reason = evaluate_signal(row, open_trade=None, config=config)
        signals.append(color)
        reasons.append(reason)

    df["signal_color"] = signals
    df["signal_reason"] = reasons

    # Mark signal changes
    df["prev_signal"] = df["signal_color"].shift(1)
    df["signal_changed"] = df["signal_color"] != df["prev_signal"]

    return df


# ---------------------------------------------------------------------------
# 4. Simulate bidirectional paper trades
# ---------------------------------------------------------------------------


def check_yellow_events(
    rsi14: float, direction: str = "long", config: dict = SIGNAL_CONFIG
) -> str | None:
    """
    Check for yellow (profit-taking) events. Mirrors checkYellowEvents()
    from supabase/functions/_shared/signal-rules.ts, extended with
    reverse yellow for short positions.

    For LONG positions:
      "strong_take_profit" if RSI >= 85 (trim 50%+)
      "take_profit"        if RSI >= 78 (trim 25-30%)

    For SHORT positions (if enabled in config):
      "strong_take_profit" if RSI <= 15 (cover 50%+)
      "take_profit"        if RSI <= 22 (cover 25%)

    Returns None if no yellow event.
    """
    if direction == "long":
        if rsi14 >= config["rsi_orange_threshold"]:
            return "strong_take_profit"
        elif rsi14 >= config["rsi_yellow_threshold"]:
            return "take_profit"
    elif direction == "short":
        short_orange = config.get("rsi_short_orange_threshold", 0)
        short_yellow = config.get("rsi_short_yellow_threshold", 0)
        if short_orange > 0 and rsi14 <= short_orange:
            return "strong_take_profit"
        elif short_yellow > 0 and rsi14 <= short_yellow:
            return "take_profit"
    return None


def simulate_trades(
    df: pd.DataFrame,
    position_size: float = POSITION_SIZE_USD,
    config: dict = SIGNAL_CONFIG,
    btc_df: pd.DataFrame | None = None,
    is_btc: bool = False,
) -> list[dict]:
    """
    Walk through signals chronologically with bidirectional trading,
    yellow event (partial trim) support, and configurable trade management:

    LONG trades:
      - Open on GREEN signal (ema_cross_up)
      - Close on RED signal, stop-loss, trend-break, or BTC crash (altcoins)
      - Partial trim on yellow events (RSI >= 78 or RSI >= 85)

    SHORT trades:
      - Open on RED signal (ema_cross_down)
      - Close on GREEN signal
      - Optional reverse yellow trims when RSI deeply oversold

    RSI BB complementary trades:
      - Open LONG when RSI touches lower BB (oversold in context)
      - Open SHORT when RSI touches upper BB (overbought in context)
      - Auto-close after N days (short-duration mean-reversion)
      - Does NOT override or conflict with EMA-based trades

    Configurable behaviors:
      - grace_period_days: override checks disabled for N bars after entry
      - trend_break_confirm_days: require N consecutive closes below SMA-50
      - trim_mode: "pct_of_remaining" (cascading) or "pct_of_original" (fixed)
      - reverse yellow for shorts: cover partial when RSI <= threshold
      - volume_confirm: require above-average volume for entry
      - atr_stop_loss: dynamic stop-loss based on 2× ATR
      - btc_crash_filter: close altcoin longs when BTC crashes
      - rsi_bb_complementary: mean-reversion trades on RSI BB extremes

    Args:
        btc_df: Pre-calculated BTC indicator DataFrame (for crash detection on altcoins)
        is_btc: True if this asset IS bitcoin (skip BTC crash filter)

    Returns a list of trade dicts ready for Supabase insertion.
    """
    trades: list[dict] = []
    open_long: dict | None = None
    open_short: dict | None = None
    long_remaining_frac: float = 1.0
    short_remaining_frac: float = 1.0
    trim_mode = config.get("trim_mode", "pct_of_remaining")

    # RSI BB complementary trades (tracked separately)
    bb_open_long: dict | None = None
    bb_open_short: dict | None = None
    bb_long_bars: int = 0
    bb_short_bars: int = 0
    bb_hold_days = config.get("rsi_bb_hold_days", 5)
    rsi_bb_enabled = config.get("rsi_bb_complementary", False)
    bb_trend_filter = config.get("rsi_bb_trend_filter", False)
    bb_cooldown_days = config.get("rsi_bb_cooldown_days", 0)
    bb_long_cooldown_until: int = -1  # bar index until which BB longs are blocked
    bb_short_cooldown_until: int = -1  # bar index until which BB shorts are blocked

    # Confirmation-based entry gates: track bars since cross where direction holds
    confirmation_bars = config.get("confirmation_bars", 0)  # 0 = disabled
    consecutive_green: int = 0
    consecutive_red: int = 0
    pending_green_entry: dict | None = None  # indicator snapshot from cross bar
    pending_red_entry: dict | None = None

    # RSI velocity detection
    rsi_velocity_enabled = config.get("rsi_velocity_enabled", False)
    rsi_velocity_threshold = config.get("rsi_velocity_threshold", 15)
    rsi_velocity_action = config.get("rsi_velocity_action", "warn")  # "warn" or "close"

    # BTC crash filter setup
    btc_crash_enabled = config.get("btc_crash_filter", False) and not is_btc and btc_df is not None
    btc_crash_threshold = config.get("btc_crash_threshold", -5.0)

    # ── V5 Strategy 1: Profit-Taking Ladder ──
    profit_ladder_enabled = config.get("profit_ladder_enabled", False)
    profit_ladder_levels = config.get("profit_ladder_levels", [15, 25, 35])
    profit_ladder_fractions = config.get("profit_ladder_fractions", [0.10, 0.10, 0.10])
    ladder_trims_long: list[int] = []   # indices of executed ladder levels for current long
    ladder_trims_short: list[int] = []  # indices of executed ladder levels for current short

    # ── V5 Strategy 2: Pullback Re-entry ──
    pullback_reentry_enabled = config.get("pullback_reentry", False)
    pullback_ema_buffer_pct = config.get("pullback_ema_buffer_pct", 0.5)
    pullback_min_profit_pct = config.get("pullback_min_profit_pct", 5.0)
    pullback_add_frac = config.get("pullback_add_frac", 0.25)
    pullback_max_adds = config.get("pullback_max_adds", 2)
    reentry_pieces_long: list[dict] = []   # each: {entry_price, entry_date, frac, entry_indicators}
    reentry_pieces_short: list[dict] = []
    pullback_adds_long: int = 0   # how many pullback adds done on current long
    pullback_adds_short: int = 0

    # ── V5 Strategy 3: DCA Scaling ──
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

    # ── V5 Strategy 4: Improved BB (BB2) ──
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

    # ── V6: Short Profit Capture ──
    trailing_stop_short = config.get("trailing_stop_short", False)
    trailing_stop_long = config.get("trailing_stop_long", False)
    trailing_stop_activation = config.get("trailing_stop_activation_pct", 5.0)
    trailing_stop_trail = config.get("trailing_stop_trail_pct", 2.5)
    short_peak_profit: float = 0.0  # Best profit % seen during current short
    long_peak_profit: float = 0.0   # Best profit % seen during current long

    # Per-direction ladder config (shorts can have different levels/fractions)
    short_ladder_levels = config.get("short_ladder_levels", profit_ladder_levels)
    short_ladder_fractions = config.get("short_ladder_fractions", profit_ladder_fractions)

    # Per-direction re-entry gate (can disable short re-entries independently)
    pullback_reentry_short_enabled = config.get("pullback_reentry_short", pullback_reentry_enabled)

    for bar_idx, (date, row) in enumerate(df.iterrows()):
        price = row["close"]
        rsi14 = row["rsi_14"]

        # ── BTC crash filter: defensively close altcoin longs ──
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
                    # Don't open new position on crash day — skip to next bar
                    continue

        # Re-evaluate signal WITH open trade context (for stop-loss / trend-break)
        color, reason = evaluate_signal(
            row, open_trade=open_long, config=config, bar_index=bar_idx
        )

        # Also check short position for ATR stop-loss (mirrors long stop-loss above)
        # Without this, shorts have NO stop-loss protection — they only close on
        # opposing EMA crossover, which can take months and produce >100% losses.
        if open_short is not None and color != "green":
            short_color, short_reason = evaluate_signal(
                row, open_trade=open_short, config=config, bar_index=bar_idx
            )
            if short_color == "green" and short_reason in ("atr_stop_loss", "stop_loss"):
                color, reason = short_color, short_reason

        # ── V6: Trailing stop for shorts ──
        # Tracks peak profit and closes if profit retraces beyond trail distance.
        # Works alongside ATR stop: ATR stop fires on absolute loss from entry,
        # trailing stop fires on retrace from peak profit.
        if trailing_stop_short and open_short is not None and color != "green":
            entry_price = open_short["entry_price"]
            current_profit = ((entry_price - price) / entry_price) * 100
            # Update peak profit tracker
            if current_profit > short_peak_profit:
                short_peak_profit = current_profit
            # Close if activated and retraced beyond trail distance
            if (short_peak_profit >= trailing_stop_activation
                    and (short_peak_profit - current_profit) >= trailing_stop_trail):
                color, reason = "green", "trailing_stop"

        # ── V6d: Trailing stop for longs ──
        # Same logic as short trailing stop, but for long positions.
        # Closes long if profit retraces from peak.
        if trailing_stop_long and open_long is not None and color != "red":
            entry_price = open_long["entry_price"]
            current_profit = ((price - entry_price) / entry_price) * 100
            if current_profit > long_peak_profit:
                long_peak_profit = current_profit
            if (long_peak_profit >= trailing_stop_activation
                    and (long_peak_profit - current_profit) >= trailing_stop_trail):
                color, reason = "red", "trailing_stop"

        # ── V5 Strategy 1: Profit-Taking Ladder ──
        # Trim at milestone profit levels (e.g., +15%, +25%, +35%)
        # Sets trimmed_this_bar to prevent conflicting actions on same bar
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

        # ── Yellow events: partial trim on open LONG positions ──
        # Skip if ladder already trimmed this bar (avoid contradictory signals)

        if open_long is not None and long_remaining_frac > 0.1 and not trimmed_this_bar:
            yellow_event = check_yellow_events(rsi14, direction="long", config=config)
            if yellow_event is not None:
                entry_price = open_long["entry_price"]
                pnl_pct_at_trim = round(((price - entry_price) / entry_price) * 100, 2)

                if yellow_event == "strong_take_profit":
                    raw_trim_frac = config["trim_pct_orange"]
                else:
                    raw_trim_frac = config["trim_pct_yellow"]

                # Trim sizing depends on mode
                if trim_mode == "pct_of_original":
                    # Fixed: always trim X% of original position
                    trim_of_original = min(raw_trim_frac, long_remaining_frac)
                else:
                    # Cascading: trim X% of what's left
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

        # ── Yellow events: partial cover on open SHORT positions ──

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

        # ── RSI velocity detection: rapid move toward extremes ──
        # Catches the MOVE, not the extreme — e.g. RSI 55→72 in one cycle
        # Skip if ladder already trimmed this bar
        if rsi_velocity_enabled and not trimmed_this_bar:
            rsi_delta = row.get("rsi_delta", 0)
            if not pd.isna(rsi_delta) and abs(rsi_delta) >= rsi_velocity_threshold:
                # RSI surging upward (toward overbought) — warn/close open longs
                if rsi_delta > 0 and rsi14 > 60 and open_long is not None and long_remaining_frac > 0.1:
                    if rsi_velocity_action == "close":
                        # Force close the long position
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
                    else:
                        # Warn = generate trim (same as yellow event trim)
                        entry_price = open_long["entry_price"]
                        pnl_pct_at_trim = round(((price - entry_price) / entry_price) * 100, 2)
                        trim_frac = min(0.25, long_remaining_frac)  # trim 25%
                        if trim_frac > 0.05:
                            trim_usd = round(trim_frac * position_size * pnl_pct_at_trim / 100, 2)
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
                                "exit_signal_reason": f"rsi_velocity ({rsi_delta:+.0f})",
                                "pnl_pct": pnl_pct_at_trim,
                                "pnl_usd": trim_usd,
                                "trim_pct": round(trim_frac * 100, 1),
                                "status": "closed",
                                "exit_indicators": _snapshot_indicators(row),
                            })
                            long_remaining_frac -= trim_frac

                # RSI plunging downward (toward oversold) — warn/close open shorts
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
                    else:
                        entry_price = open_short["entry_price"]
                        pnl_pct_at_trim = round(((entry_price - price) / entry_price) * 100, 2)
                        trim_frac = min(0.25, short_remaining_frac)
                        if trim_frac > 0.05:
                            trim_usd = round(trim_frac * position_size * pnl_pct_at_trim / 100, 2)
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
                                "exit_signal_reason": f"rsi_velocity ({rsi_delta:+.0f})",
                                "pnl_pct": pnl_pct_at_trim,
                                "pnl_usd": trim_usd,
                                "trim_pct": round(trim_frac * 100, 1),
                                "status": "closed",
                                "exit_indicators": _snapshot_indicators(row),
                            })
                            short_remaining_frac -= trim_frac

        # ── Close existing positions on opposing signals ──

        # Close LONG on red signal (including stop-loss, trend-break)
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
            # Close all pullback re-entry pieces simultaneously
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
            open_long = None
            long_remaining_frac = 1.0
            long_peak_profit = 0.0
            ladder_trims_long = []
            reentry_pieces_long = []
            pullback_adds_long = 0
            dca_active_long = False
            dca_tranche_idx_long = 0

        # Close SHORT on green signal
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
            # Close all pullback re-entry pieces simultaneously
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
            open_short = None
            short_remaining_frac = 1.0
            ladder_trims_short = []
            reentry_pieces_short = []
            pullback_adds_short = 0
            dca_active_short = False
            dca_tranche_idx_short = 0
            short_peak_profit = 0.0

        # ── Confirmation gate: track bars since cross where direction holds ──
        # After an EMA cross, count consecutive bars where EMA-9 stays in the
        # crossed direction (above EMA-21 for bullish, below for bearish).
        # Only enter after the cross persists for N bars — filters whipsaws.
        ema9 = row["ema_9"]
        ema21 = row["ema_21"]

        if color == "green" and reason == "ema_cross_up":
            # Fresh bullish cross — start counting
            consecutive_green = 1
            consecutive_red = 0
            pending_green_entry = _snapshot_indicators(row)
        elif consecutive_green > 0 and ema9 > ema21:
            # EMA-9 still above EMA-21 — cross is holding, increment
            consecutive_green += 1
        elif consecutive_green > 0:
            # EMA-9 fell back below — cross failed confirmation
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

        # ── Open new positions (with optional confirmation gate + DCA) ──

        if open_long is None and consecutive_green > 0:
            # Check if we have enough confirmation bars OR gate is disabled
            if confirmation_bars <= 0 or consecutive_green >= confirmation_bars:
                # Only enter on the actual cross bar if no gate, or on confirmation bar
                if confirmation_bars <= 0 and not (color == "green" and reason == "ema_cross_up"):
                    pass  # Without gate, only enter on cross bar itself
                else:
                    # DCA: first tranche only (if DCA enabled)
                    if dca_enabled:
                        first_frac = dca_tranches[0] if dca_tranches else 1.0
                        open_long = {
                            "direction": "long",
                            "entry_date": str(date),
                            "entry_price": round(price, 2),
                            "entry_signal_color": "green",
                            "entry_signal_reason": "ema_cross_up_confirmed" if confirmation_bars > 0 else reason,
                            "entry_indicators": _snapshot_indicators(row),
                            "entry_bar_index": bar_idx,
                        }
                        long_remaining_frac = first_frac
                        long_peak_profit = 0.0
                        dca_active_long = True
                        dca_tranche_idx_long = 1  # next tranche to fill
                        dca_last_fill_bar_long = bar_idx
                        dca_first_entry_price_long = price
                        # Log DCA first fill as informational trade
                        trades.append({
                            "direction": "dca_entry",
                            "entry_date": str(date),
                            "entry_price": round(price, 2),
                            "entry_signal_color": "green",
                            "entry_signal_reason": f"dca_tranche_1_of_{len(dca_tranches)}",
                            "entry_indicators": _snapshot_indicators(row),
                            "exit_date": str(date),
                            "exit_price": round(price, 2),
                            "pnl_pct": 0.0,
                            "pnl_usd": 0.0,
                            "status": "closed",
                            "exit_indicators": _snapshot_indicators(row),
                        })
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
                    consecutive_green = 0  # Reset after entry

        if open_short is None and consecutive_red > 0:
            if confirmation_bars <= 0 or consecutive_red >= confirmation_bars:
                if confirmation_bars <= 0 and not (color == "red" and reason == "ema_cross_down"):
                    pass
                else:
                    if dca_enabled:
                        first_frac = dca_tranches[0] if dca_tranches else 1.0
                        open_short = {
                            "direction": "short",
                            "entry_date": str(date),
                            "entry_price": round(price, 2),
                            "entry_signal_color": "red",
                            "entry_signal_reason": "ema_cross_down_confirmed" if confirmation_bars > 0 else reason,
                            "entry_indicators": _snapshot_indicators(row),
                            "entry_bar_index": bar_idx,
                        }
                        short_remaining_frac = first_frac
                        short_peak_profit = 0.0
                        dca_active_short = True
                        dca_tranche_idx_short = 1
                        dca_last_fill_bar_short = bar_idx
                        dca_first_entry_price_short = price
                        trades.append({
                            "direction": "dca_entry",
                            "entry_date": str(date),
                            "entry_price": round(price, 2),
                            "entry_signal_color": "red",
                            "entry_signal_reason": f"dca_tranche_1_of_{len(dca_tranches)}",
                            "entry_indicators": _snapshot_indicators(row),
                            "exit_date": str(date),
                            "exit_price": round(price, 2),
                            "pnl_pct": 0.0,
                            "pnl_usd": 0.0,
                            "status": "closed",
                            "exit_indicators": _snapshot_indicators(row),
                        })
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
                    consecutive_red = 0  # Reset after entry

        # ── V5 Strategy 3: DCA Tranche Fill ──
        # Fill subsequent tranches if DCA is active, signal holds, and interval met
        if dca_enabled and not trimmed_this_bar:
            ema9 = row["ema_9"]
            ema21 = row["ema_21"]

            # DCA long: fill next tranche
            if (dca_active_long and open_long is not None
                    and dca_tranche_idx_long < len(dca_tranches)
                    and bar_idx - dca_last_fill_bar_long >= dca_interval_bars):
                # Check signal still holds (EMA-9 > EMA-21) and adverse move within limit
                adverse_pct = ((dca_first_entry_price_long - price) / dca_first_entry_price_long) * 100
                if ema9 > ema21 and adverse_pct <= dca_max_adverse_pct:
                    tranche_frac = dca_tranches[dca_tranche_idx_long]
                    # Update entry price to VWAP of all tranches
                    old_total = long_remaining_frac * open_long["entry_price"]
                    new_total = old_total + tranche_frac * price
                    long_remaining_frac += tranche_frac
                    open_long["entry_price"] = round(new_total / long_remaining_frac, 2)
                    dca_tranche_idx_long += 1
                    dca_last_fill_bar_long = bar_idx
                    # Log DCA fill
                    trades.append({
                        "direction": "dca_entry",
                        "entry_date": str(date),
                        "entry_price": round(price, 2),
                        "entry_signal_color": "green",
                        "entry_signal_reason": f"dca_tranche_{dca_tranche_idx_long}_of_{len(dca_tranches)}",
                        "entry_indicators": _snapshot_indicators(row),
                        "exit_date": str(date),
                        "exit_price": round(price, 2),
                        "pnl_pct": 0.0,
                        "pnl_usd": 0.0,
                        "status": "closed",
                        "exit_indicators": _snapshot_indicators(row),
                    })
                    if dca_tranche_idx_long >= len(dca_tranches):
                        dca_active_long = False  # All tranches filled
                elif adverse_pct > dca_max_adverse_pct:
                    dca_active_long = False  # Cancel remaining — too much adverse move

            # DCA short: fill next tranche
            if (dca_active_short and open_short is not None
                    and dca_tranche_idx_short < len(dca_tranches)
                    and bar_idx - dca_last_fill_bar_short >= dca_interval_bars):
                adverse_pct = ((price - dca_first_entry_price_short) / dca_first_entry_price_short) * 100
                if ema9 < ema21 and adverse_pct <= dca_max_adverse_pct:
                    tranche_frac = dca_tranches[dca_tranche_idx_short]
                    old_total = short_remaining_frac * open_short["entry_price"]
                    new_total = old_total + tranche_frac * price
                    short_remaining_frac += tranche_frac
                    open_short["entry_price"] = round(new_total / short_remaining_frac, 2)
                    dca_tranche_idx_short += 1
                    dca_last_fill_bar_short = bar_idx
                    trades.append({
                        "direction": "dca_entry",
                        "entry_date": str(date),
                        "entry_price": round(price, 2),
                        "entry_signal_color": "red",
                        "entry_signal_reason": f"dca_tranche_{dca_tranche_idx_short}_of_{len(dca_tranches)}",
                        "entry_indicators": _snapshot_indicators(row),
                        "exit_date": str(date),
                        "exit_price": round(price, 2),
                        "pnl_pct": 0.0,
                        "pnl_usd": 0.0,
                        "status": "closed",
                        "exit_indicators": _snapshot_indicators(row),
                    })
                    if dca_tranche_idx_short >= len(dca_tranches):
                        dca_active_short = False
                elif adverse_pct > dca_max_adverse_pct:
                    dca_active_short = False

        # ── V5 Strategy 2: Pullback Re-entry ──
        # Add to winning positions when price pulls back to EMA-9 support
        # Only after DCA is complete (or not active), not on trim bars
        if pullback_reentry_enabled and not trimmed_this_bar:
            ema9 = row["ema_9"]
            ema21 = row["ema_21"]

            # Pullback re-entry for longs
            if (open_long is not None and not dca_active_long
                    and pullback_adds_long < pullback_max_adds):
                entry_price = open_long["entry_price"]
                profit_pct = ((price - entry_price) / entry_price) * 100
                ema9_distance_pct = abs((price - ema9) / ema9) * 100
                trend_intact = ema9 > ema21

                if (profit_pct >= pullback_min_profit_pct
                        and ema9_distance_pct <= pullback_ema_buffer_pct
                        and trend_intact):
                    reentry_pieces_long.append({
                        "entry_price": round(price, 2),
                        "entry_date": str(date),
                        "frac": pullback_add_frac,
                        "entry_indicators": _snapshot_indicators(row),
                    })
                    pullback_adds_long += 1
                    # Log re-entry as informational trade
                    trades.append({
                        "direction": "reentry",
                        "entry_date": str(date),
                        "entry_price": round(price, 2),
                        "entry_signal_color": "green",
                        "entry_signal_reason": "pullback_reentry",
                        "entry_indicators": _snapshot_indicators(row),
                        "exit_date": None,
                        "exit_price": round(price, 2),
                        "pnl_pct": 0.0,
                        "pnl_usd": 0.0,
                        "status": "open",
                        "exit_indicators": None,
                    })

            # Pullback re-entry for shorts (gated by per-direction config)
            if (pullback_reentry_short_enabled and open_short is not None
                    and not dca_active_short
                    and pullback_adds_short < pullback_max_adds):
                entry_price = open_short["entry_price"]
                profit_pct = ((entry_price - price) / entry_price) * 100
                ema9_distance_pct = abs((price - ema9) / ema9) * 100
                trend_intact = ema9 < ema21

                if (profit_pct >= pullback_min_profit_pct
                        and ema9_distance_pct <= pullback_ema_buffer_pct
                        and trend_intact):
                    reentry_pieces_short.append({
                        "entry_price": round(price, 2),
                        "entry_date": str(date),
                        "frac": pullback_add_frac,
                        "entry_indicators": _snapshot_indicators(row),
                    })
                    pullback_adds_short += 1
                    trades.append({
                        "direction": "reentry",
                        "entry_date": str(date),
                        "entry_price": round(price, 2),
                        "entry_signal_color": "red",
                        "entry_signal_reason": "pullback_reentry",
                        "entry_indicators": _snapshot_indicators(row),
                        "exit_date": None,
                        "exit_price": round(price, 2),
                        "pnl_pct": 0.0,
                        "pnl_usd": 0.0,
                        "status": "open",
                        "exit_indicators": None,
                    })

        # ── RSI Bollinger Band complementary trades ──
        # These are independent, short-duration mean-reversion trades
        # that don't conflict with EMA-based positions. They use half
        # position size and auto-close after N days.

        if rsi_bb_enabled:
            rsi_below_bb = row.get("rsi_below_bb", False)
            rsi_above_bb = row.get("rsi_above_bb", False)

            bb_stop_pct = config.get("rsi_bb_stop_pct", 5.0)

            # Close BB trades on time expiry, profit target, or stop-loss
            if bb_open_long is not None:
                bb_long_bars += 1
                bb_entry = bb_open_long["entry_price"]
                bb_pnl_pct = round(((price - bb_entry) / bb_entry) * 100, 2)

                # Close after N days, RSI recovers to midline, or stop-loss hit
                bb_stopped = bb_pnl_pct <= -bb_stop_pct
                if bb_long_bars >= bb_hold_days or rsi14 > 50 or bb_stopped:
                    bb_pnl_usd = round(0.5 * bb_pnl_pct / 100 * position_size, 2)
                    trades.append({
                        **bb_open_long,
                        "exit_date": str(date),
                        "exit_price": round(price, 2),
                        "exit_signal_color": "grey",
                        "exit_signal_reason": "bb_stop" if bb_stopped else ("bb_expiry" if bb_long_bars >= bb_hold_days else "bb_target"),
                        "pnl_pct": bb_pnl_pct,
                        "pnl_usd": bb_pnl_usd,
                        "status": "closed",
                        "exit_indicators": _snapshot_indicators(row),
                    })
                    bb_open_long = None
                    if bb_stopped and bb_cooldown_days > 0:
                        bb_long_cooldown_until = bar_idx + bb_cooldown_days
                    bb_long_bars = 0

            if bb_open_short is not None:
                bb_short_bars += 1
                bb_entry = bb_open_short["entry_price"]
                bb_pnl_pct = round(((bb_entry - price) / bb_entry) * 100, 2)

                bb_stopped = bb_pnl_pct <= -bb_stop_pct
                if bb_short_bars >= bb_hold_days or rsi14 < 50 or bb_stopped:
                    bb_pnl_usd = round(0.5 * bb_pnl_pct / 100 * position_size, 2)
                    trades.append({
                        **bb_open_short,
                        "exit_date": str(date),
                        "exit_price": round(price, 2),
                        "exit_signal_color": "grey",
                        "exit_signal_reason": "bb_stop" if bb_stopped else ("bb_expiry" if bb_short_bars >= bb_hold_days else "bb_target"),
                        "pnl_pct": bb_pnl_pct,
                        "pnl_usd": bb_pnl_usd,
                        "status": "closed",
                        "exit_indicators": _snapshot_indicators(row),
                    })
                    bb_open_short = None
                    if bb_stopped and bb_cooldown_days > 0:
                        bb_short_cooldown_until = bar_idx + bb_cooldown_days
                    bb_short_bars = 0

            # Open new BB trades (only if no existing BB trade in that direction)
            # Trend filter: only allow BB longs in uptrend, BB shorts in downtrend
            sma50 = row.get("sma_50", float("nan"))
            bb_long_ok = not bb_trend_filter or (not pd.isna(sma50) and price > sma50)
            bb_short_ok = not bb_trend_filter or (not pd.isna(sma50) and price < sma50)

            if (rsi_below_bb and bb_open_long is None and open_long is None
                    and bb_long_ok and bar_idx > bb_long_cooldown_until):
                bb_open_long = {
                    "direction": "bb_long",
                    "entry_date": str(date),
                    "entry_price": round(price, 2),
                    "entry_signal_color": "green",
                    "entry_signal_reason": "rsi_bb_lower",
                    "entry_indicators": _snapshot_indicators(row),
                    "entry_bar_index": bar_idx,
                }
                bb_long_bars = 0

            if (rsi_above_bb and bb_open_short is None and open_short is None
                    and bb_short_ok and bar_idx > bb_short_cooldown_until):
                bb_open_short = {
                    "direction": "bb_short",
                    "entry_date": str(date),
                    "entry_price": round(price, 2),
                    "entry_signal_color": "red",
                    "entry_signal_reason": "rsi_bb_upper",
                    "entry_indicators": _snapshot_indicators(row),
                    "entry_bar_index": bar_idx,
                }
                bb_short_bars = 0

        # ── V5 Strategy 4: Improved BB (BB2) trades ──
        # Independent from EMA, uses tighter bands and shorter hold
        if bb2_enabled:
            rsi_below_bb2 = row.get("rsi_below_bb2", False)
            rsi_above_bb2 = row.get("rsi_above_bb2", False)
            sma50 = row.get("sma_50", float("nan"))

            # Close existing BB2 trades
            if bb2_open_long is not None:
                bb2_long_bars += 1
                bb2_entry = bb2_open_long["entry_price"]
                bb2_pnl_pct = round(((price - bb2_entry) / bb2_entry) * 100, 2)

                bb2_stopped = bb2_pnl_pct <= -bb2_stop_pct
                if bb2_long_bars >= bb2_hold_days or rsi14 > 50 or bb2_stopped:
                    bb2_pnl_usd = round(bb2_position_mult * bb2_pnl_pct / 100 * position_size, 2)
                    trades.append({
                        **bb2_open_long,
                        "exit_date": str(date),
                        "exit_price": round(price, 2),
                        "exit_signal_color": "grey",
                        "exit_signal_reason": "bb2_stop" if bb2_stopped else ("bb2_expiry" if bb2_long_bars >= bb2_hold_days else "bb2_target"),
                        "pnl_pct": bb2_pnl_pct,
                        "pnl_usd": bb2_pnl_usd,
                        "status": "closed",
                        "exit_indicators": _snapshot_indicators(row),
                    })
                    bb2_open_long = None
                    if bb2_stopped and bb2_cooldown_days > 0:
                        bb2_long_cooldown_until = bar_idx + bb2_cooldown_days
                    bb2_long_bars = 0

            if bb2_open_short is not None:
                bb2_short_bars += 1
                bb2_entry = bb2_open_short["entry_price"]
                bb2_pnl_pct = round(((bb2_entry - price) / bb2_entry) * 100, 2)

                bb2_stopped = bb2_pnl_pct <= -bb2_stop_pct
                if bb2_short_bars >= bb2_hold_days or rsi14 < 50 or bb2_stopped:
                    bb2_pnl_usd = round(bb2_position_mult * bb2_pnl_pct / 100 * position_size, 2)
                    trades.append({
                        **bb2_open_short,
                        "exit_date": str(date),
                        "exit_price": round(price, 2),
                        "exit_signal_color": "grey",
                        "exit_signal_reason": "bb2_stop" if bb2_stopped else ("bb2_expiry" if bb2_short_bars >= bb2_hold_days else "bb2_target"),
                        "pnl_pct": bb2_pnl_pct,
                        "pnl_usd": bb2_pnl_usd,
                        "status": "closed",
                        "exit_indicators": _snapshot_indicators(row),
                    })
                    bb2_open_short = None
                    if bb2_stopped and bb2_cooldown_days > 0:
                        bb2_short_cooldown_until = bar_idx + bb2_cooldown_days
                    bb2_short_bars = 0

            # Open new BB2 trades (trend filter: uptrend for longs, downtrend for shorts)
            bb2_long_ok = not pd.isna(sma50) and price > sma50
            bb2_short_ok = not pd.isna(sma50) and price < sma50

            if (rsi_below_bb2 and bb2_open_long is None and open_long is None
                    and bb2_long_ok and bar_idx > bb2_long_cooldown_until):
                bb2_open_long = {
                    "direction": "bb2_long",
                    "entry_date": str(date),
                    "entry_price": round(price, 2),
                    "entry_signal_color": "green",
                    "entry_signal_reason": "rsi_bb2_lower",
                    "entry_indicators": _snapshot_indicators(row),
                    "entry_bar_index": bar_idx,
                }
                bb2_long_bars = 0

            if (rsi_above_bb2 and bb2_open_short is None and open_short is None
                    and bb2_short_ok and bar_idx > bb2_short_cooldown_until):
                bb2_open_short = {
                    "direction": "bb2_short",
                    "entry_date": str(date),
                    "entry_price": round(price, 2),
                    "entry_signal_color": "red",
                    "entry_signal_reason": "rsi_bb2_upper",
                    "entry_indicators": _snapshot_indicators(row),
                    "entry_bar_index": bar_idx,
                }
                bb2_short_bars = 0

    # ── Mark still-open trades at end of backtest ──

    last_row = df.iloc[-1]
    last_price = last_row["close"]

    if open_long is not None:
        entry_price = open_long["entry_price"]
        pnl_pct = round(((last_price - entry_price) / entry_price) * 100, 2)
        trades.append({
            **open_long,
            "exit_date": None,
            "exit_price": round(last_price, 2),
            "pnl_pct": pnl_pct,
            "pnl_usd": round(long_remaining_frac * pnl_pct / 100 * position_size, 2),
            "remaining_pct": round(long_remaining_frac * 100, 1),
            "status": "open",
            "exit_indicators": None,
        })

    if open_short is not None:
        entry_price = open_short["entry_price"]
        pnl_pct = round(((entry_price - last_price) / entry_price) * 100, 2)
        trades.append({
            **open_short,
            "exit_date": None,
            "exit_price": round(last_price, 2),
            "pnl_pct": pnl_pct,
            "pnl_usd": round(short_remaining_frac * pnl_pct / 100 * position_size, 2),
            "remaining_pct": round(short_remaining_frac * 100, 1),
            "status": "open",
            "exit_indicators": None,
        })

    # Close any open BB trades at end
    if bb_open_long is not None:
        bb_entry = bb_open_long["entry_price"]
        bb_pnl_pct = round(((last_price - bb_entry) / bb_entry) * 100, 2)
        trades.append({
            **bb_open_long,
            "exit_date": None,
            "exit_price": round(last_price, 2),
            "pnl_pct": bb_pnl_pct,
            "pnl_usd": round(0.5 * bb_pnl_pct / 100 * position_size, 2),
            "status": "open",
            "exit_indicators": None,
        })

    if bb_open_short is not None:
        bb_entry = bb_open_short["entry_price"]
        bb_pnl_pct = round(((bb_entry - last_price) / bb_entry) * 100, 2)
        trades.append({
            **bb_open_short,
            "exit_date": None,
            "exit_price": round(last_price, 2),
            "pnl_pct": bb_pnl_pct,
            "pnl_usd": round(0.5 * bb_pnl_pct / 100 * position_size, 2),
            "status": "open",
            "exit_indicators": None,
        })

    # Close any open BB2 trades at end
    if bb2_open_long is not None:
        bb2_entry = bb2_open_long["entry_price"]
        bb2_pnl_pct = round(((last_price - bb2_entry) / bb2_entry) * 100, 2)
        trades.append({
            **bb2_open_long,
            "exit_date": None,
            "exit_price": round(last_price, 2),
            "pnl_pct": bb2_pnl_pct,
            "pnl_usd": round(bb2_position_mult * bb2_pnl_pct / 100 * position_size, 2),
            "status": "open",
            "exit_indicators": None,
        })

    if bb2_open_short is not None:
        bb2_entry = bb2_open_short["entry_price"]
        bb2_pnl_pct = round(((bb2_entry - last_price) / bb2_entry) * 100, 2)
        trades.append({
            **bb2_open_short,
            "exit_date": None,
            "exit_price": round(last_price, 2),
            "pnl_pct": bb2_pnl_pct,
            "pnl_usd": round(bb2_position_mult * bb2_pnl_pct / 100 * position_size, 2),
            "status": "open",
            "exit_indicators": None,
        })

    # Close any open reentry pieces at end
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
            "exit_date": None,
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
            "exit_date": None,
            "exit_price": round(last_price, 2),
            "pnl_pct": piece_pnl_pct,
            "pnl_usd": piece_pnl_usd,
            "status": "open",
            "exit_indicators": None,
        })

    return trades


def _snapshot_indicators(row: pd.Series) -> dict:
    """Create an indicator snapshot dict from a DataFrame row."""
    snap = {
        "ema_9": round(row["ema_9"], 2),
        "ema_21": round(row["ema_21"], 2),
        "rsi_14": round(row["rsi_14"], 2),
        "sma_50_daily": round(row["sma_50"], 2),
        "adx_4h": round(row["adx"], 2),
    }
    # Include new indicators if available
    if "atr_pct" in row and not pd.isna(row["atr_pct"]):
        snap["atr_pct"] = round(row["atr_pct"], 2)
    if "volume_ratio" in row and not pd.isna(row["volume_ratio"]):
        snap["volume_ratio"] = round(row["volume_ratio"], 2)
    return snap


# ---------------------------------------------------------------------------
# 5. Write results to Supabase
# ---------------------------------------------------------------------------


def clear_backtest_trades(asset_id: str | None = None) -> None:
    """Delete backtest trades from Supabase. If asset_id given, only clear that asset."""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    url = f"{SUPABASE_URL}/rest/v1/paper_trades?source=eq.backtest"
    if asset_id:
        url += f"&asset_id=eq.{asset_id}"
    resp = requests.delete(url, headers=headers, timeout=10)
    if resp.status_code in (200, 204):
        print(f"  🗑️  Cleared backtest trades{f' for {asset_id}' if asset_id else ''}")
    else:
        print(f"  ⚠️  Failed to clear trades: {resp.status_code} — {resp.text}")


def write_to_supabase(
    trades: list[dict],
    asset_id: str,
    coingecko_id: str,
    dry_run: bool = False,
) -> None:
    """Insert backtest trades into the paper_trades table via Supabase REST API."""
    if dry_run:
        print("\n  [DRY RUN] Would write the following trades:")
        for t in trades:
            status = t["status"]
            direction = t.get("direction", "long")
            entry = t["entry_date"]
            exit_d = t.get("exit_date", "still open")
            pnl = t["pnl_pct"]
            reason_in = t.get("entry_signal_reason", "")
            reason_out = t.get("exit_signal_reason", "")

            if direction == "trim":
                trim_pct = t.get("trim_pct", 0)
                emoji = "🟡"
                print(
                    f"    {emoji} TRIM   {entry} -> {exit_d}"
                    f"  |  {pnl:+.1f}% ${t.get('pnl_usd', 0):+,.0f}"
                    f"  |  trimmed {trim_pct:.0f}% ({reason_out})"
                    f"  [{status}]"
                )
            else:
                arrow = "LONG" if direction == "long" else "SHORT"
                emoji = "✅" if pnl >= 0 else "❌"
                remaining = t.get("remaining_pct")
                remain_tag = f" [{remaining:.0f}% rem]" if remaining is not None and remaining < 100 else ""
                print(
                    f"    {emoji} {arrow:5s}  {entry} -> {exit_d}"
                    f"  |  {pnl:+.1f}% ${t.get('pnl_usd', 0):+,.0f}"
                    f"  |  in: {reason_in}, out: {reason_out}"
                    f"  [{status}]{remain_tag}"
                )
        return

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

    inserted = 0
    for trade in trades:
        row = {
            "asset_id": asset_id,
            "entry_price": trade["entry_price"],
            "exit_price": trade["exit_price"] if trade["status"] == "closed" else None,
            "pnl_pct": trade["pnl_pct"] if trade["status"] == "closed" else None,
            "status": trade["status"],
            "opened_at": f"{trade['entry_date']}T00:00:00Z",
            "closed_at": f"{trade['exit_date']}T00:00:00Z" if trade.get("exit_date") else None,
            "source": "backtest",
            "direction": trade.get("direction", "long"),
            "trim_pct": trade.get("trim_pct"),
        }

        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/paper_trades",
            headers=headers,
            json=row,
            timeout=10,
        )

        if resp.status_code in (200, 201):
            inserted += 1
        else:
            print(f"    ⚠️  Failed to insert trade: {resp.status_code} — {resp.text}")

    print(f"  Wrote {inserted}/{len(trades)} trades to Supabase")


# ---------------------------------------------------------------------------
# 6. Summary statistics
# ---------------------------------------------------------------------------


def print_summary(trades: list[dict], coingecko_id: str) -> None:
    """Print a human-readable backtest summary with bidirectional + trim + BB breakdown."""
    closed = [t for t in trades if t["status"] == "closed"]
    open_trades = [t for t in trades if t["status"] == "open"]

    # Separate trims, BB/BB2 trades, reentries, DCA fills, and full EMA closes
    trims = [t for t in closed if t.get("direction") == "trim"]
    bb_trades = [t for t in closed if t.get("direction", "").startswith("bb_")]
    bb2_trades = [t for t in closed if t.get("direction", "").startswith("bb2_")]
    reentry_trades = [t for t in closed if t.get("direction") == "reentry"]
    supplementary_dirs = {"trim", "bb_long", "bb_short", "bb2_long", "bb2_short", "reentry", "dca_entry"}
    full_closes = [t for t in closed if t.get("direction") not in supplementary_dirs]

    if not full_closes and not open_trades and not trims:
        print(f"\n  📊 {coingecko_id}: No trades generated")
        return

    longs = [t for t in full_closes if t.get("direction") == "long"]
    shorts = [t for t in full_closes if t.get("direction") == "short"]

    long_wins = [t for t in longs if t["pnl_pct"] >= 0]
    short_wins = [t for t in shorts if t["pnl_pct"] >= 0]

    # USD P&L accounts for partial positions (trims reduce remaining size)
    total_pnl_usd = sum(t.get("pnl_usd", 0) for t in closed)
    trim_pnl_usd = sum(t.get("pnl_usd", 0) for t in trims)

    long_pnl = sum(t["pnl_pct"] for t in longs)
    short_pnl = sum(t["pnl_pct"] for t in shorts)

    long_win_rate = len(long_wins) / len(longs) * 100 if longs else 0
    short_win_rate = len(short_wins) / len(shorts) * 100 if shorts else 0
    overall_win_rate = (len(long_wins) + len(short_wins)) / len(full_closes) * 100 if full_closes else 0

    bb_pnl_usd = sum(t.get("pnl_usd", 0) for t in bb_trades)

    print(f"\n  📊 Backtest Results: {coingecko_id}")
    print(f"  {'─' * 60}")
    print(f"  Full trades closed:     {len(full_closes)} ({len(longs)} long, {len(shorts)} short)")
    print(f"  Trim (partial) trades:  {len(trims)}")
    if bb_trades:
        print(f"  BB complementary:       {len(bb_trades)}")
    print(f"  Open trades:            {len(open_trades)}")
    print(f"  {'─' * 60}")
    print(f"  Overall win rate:       {overall_win_rate:.0f}%")
    print(f"  Total USD P&L:          ${total_pnl_usd:+,.0f} on ${POSITION_SIZE_USD:,} position")
    if trims:
        print(f"    from trims:           ${trim_pnl_usd:+,.0f}")
        print(f"    from EMA closes:      ${total_pnl_usd - trim_pnl_usd - bb_pnl_usd:+,.0f}")
    if bb_trades:
        bb_win_rate = len([t for t in bb_trades if t["pnl_pct"] >= 0]) / len(bb_trades) * 100
        print(f"    from BB trades:       ${bb_pnl_usd:+,.0f} ({bb_win_rate:.0f}% win rate)")
    print(f"  {'─' * 60}")

    if longs:
        avg_long_win = sum(t["pnl_pct"] for t in long_wins) / len(long_wins) if long_wins else 0
        avg_long_loss_list = [t for t in longs if t["pnl_pct"] < 0]
        avg_long_loss = sum(t["pnl_pct"] for t in avg_long_loss_list) / len(avg_long_loss_list) if avg_long_loss_list else 0
        print(f"  LONG trades:            {len(longs)} | Win rate: {long_win_rate:.0f}% | Return: {long_pnl:+.1f}%")
        print(f"    Avg win: {avg_long_win:+.1f}% | Avg loss: {avg_long_loss:+.1f}%")

    if shorts:
        avg_short_win = sum(t["pnl_pct"] for t in short_wins) / len(short_wins) if short_wins else 0
        avg_short_loss_list = [t for t in shorts if t["pnl_pct"] < 0]
        avg_short_loss = sum(t["pnl_pct"] for t in avg_short_loss_list) / len(avg_short_loss_list) if avg_short_loss_list else 0
        print(f"  SHORT trades:           {len(shorts)} | Win rate: {short_win_rate:.0f}% | Return: {short_pnl:+.1f}%")
        print(f"    Avg win: {avg_short_win:+.1f}% | Avg loss: {avg_short_loss:+.1f}%")

    print(f"  {'─' * 60}")

    if full_closes or trims or bb_trades:
        print(f"\n  Trade log:")
        # Sort all trades chronologically by exit date
        all_closed = sorted(closed, key=lambda t: t.get("exit_date", ""))
        for t in all_closed:
            direction = t.get("direction", "long")
            if direction == "trim":
                trim_pct = t.get("trim_pct", 0)
                emoji = "🟡"
                reason_out = t.get("exit_signal_reason", "")
                remaining_tag = f" (trimmed {trim_pct:.0f}%, RSI {reason_out})"
                print(
                    f"    {emoji} TRIM   {t['entry_date']} -> {t['exit_date']}"
                    f"  |  ${t['entry_price']:,.0f} -> ${t['exit_price']:,.0f}"
                    f"  |  {t['pnl_pct']:+.1f}% ${t.get('pnl_usd', 0):+,.0f}{remaining_tag}"
                )
            elif direction.startswith("bb_"):
                bb_dir = "BB↑   " if direction == "bb_long" else "BB↓   "
                emoji = "🔵" if t["pnl_pct"] >= 0 else "🔴"
                reason_out = t.get("exit_signal_reason", "")
                exit_tag = f" ({reason_out})" if reason_out else ""
                print(
                    f"    {emoji} {bb_dir}{t['entry_date']} -> {t['exit_date']}"
                    f"  |  ${t['entry_price']:,.0f} -> ${t['exit_price']:,.0f}"
                    f"  |  {t['pnl_pct']:+.1f}% ${t.get('pnl_usd', 0):+,.0f}{exit_tag}"
                )
            else:
                arrow = "LONG " if direction == "long" else "SHORT"
                emoji = "✅" if t["pnl_pct"] >= 0 else "❌"
                reason_out = t.get("exit_signal_reason", "")
                exit_tag = f" ({reason_out})" if reason_out else ""
                remaining = t.get("remaining_pct")
                remain_tag = f" [{remaining:.0f}% remaining]" if remaining is not None and remaining < 100 else ""
                print(
                    f"    {emoji} {arrow}  {t['entry_date']} -> {t['exit_date']}"
                    f"  |  ${t['entry_price']:,.0f} -> ${t['exit_price']:,.0f}"
                    f"  |  {t['pnl_pct']:+.1f}% ${t.get('pnl_usd', 0):+,.0f}{exit_tag}{remain_tag}"
                )

    if open_trades:
        print(f"\n  Open trades (unrealized):")
        for t in open_trades:
            direction = t.get("direction", "long")
            arrow = "LONG " if direction == "long" else "SHORT"
            emoji = "📈" if t["pnl_pct"] >= 0 else "📉"
            remaining = t.get("remaining_pct")
            remain_tag = f" [{remaining:.0f}% remaining]" if remaining is not None and remaining < 100 else ""
            print(
                f"    {emoji} {arrow}  {t['entry_date']} -> now"
                f"  |  ${t['entry_price']:,.0f} -> ~${t['exit_price']:,.0f}"
                f"  |  {t['pnl_pct']:+.1f}% ${t.get('pnl_usd', 0):+,.0f}{remain_tag}"
            )


# ---------------------------------------------------------------------------
# 7. Fetch asset list from Supabase
# ---------------------------------------------------------------------------


def fetch_assets() -> list[dict]:
    """Get enabled assets from Supabase."""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/assets?enabled=eq.true&select=id,symbol,coingecko_id",
        headers=headers,
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def run_backtest(
    coingecko_id: str,
    asset_id: str,
    days: int,
    dry_run: bool,
    config: dict = IMPROVED_CONFIG,
    df_cached: pd.DataFrame | None = None,
    quiet: bool = False,
    btc_df: pd.DataFrame | None = None,
    source: str = "hyperliquid",
) -> list[dict]:
    """Run the full backtest pipeline for a single asset.

    Args:
        df_cached: Pre-fetched price DataFrame (avoids redundant API calls in compare mode)
        quiet: Suppress per-trade output (used in compare mode)
        btc_df: Pre-calculated BTC indicator DataFrame for crash detection on altcoins
        source: Data source — "hyperliquid" (default, primary) or "coingecko" (fallback)
    """
    is_btc = coingecko_id == "bitcoin"

    # 1. Fetch price data (or reuse cached)
    if df_cached is not None:
        df = df_cached.copy()
    else:
        df = fetch_ohlc(coingecko_id, days, source=source)

    # 2. Calculate indicators (including EMA cross detection)
    df = calculate_indicators(df, config=config)
    if not quiet:
        print(f"  Calculated indicators for {len(df)} rows")

    # 3. Generate signals (base pass without trade context)
    df = generate_signals(df, config=config)

    if not quiet:
        # Count signal distribution
        reason_counts = df["signal_reason"].value_counts()
        color_counts = df["signal_color"].value_counts()
        print(f"  Signal colors: {dict(color_counts)}")
        print(f"  Signal reasons: {dict(reason_counts)}")

    # 4. Simulate bidirectional trades (with stop-loss/trend-break + yellow trims)
    trades = simulate_trades(
        df, config=config, btc_df=btc_df, is_btc=is_btc
    )
    longs = [t for t in trades if t.get("direction") == "long"]
    shorts = [t for t in trades if t.get("direction") == "short"]
    trims = [t for t in trades if t.get("direction") == "trim"]
    bb_trades = [t for t in trades if t.get("direction", "").startswith("bb_")]
    bb2_trades = [t for t in trades if t.get("direction", "").startswith("bb2_")]
    reentries = [t for t in trades if t.get("direction") == "reentry"]
    dca_fills = [t for t in trades if t.get("direction") == "dca_entry"]
    if not quiet:
        msg = f"  Generated {len(trades)} trades ({len(longs)} long, {len(shorts)} short, {len(trims)} trims"
        if bb_trades:
            msg += f", {len(bb_trades)} BB"
        if bb2_trades:
            msg += f", {len(bb2_trades)} BB2"
        if reentries:
            msg += f", {len(reentries)} re-entries"
        if dca_fills:
            msg += f", {len(dca_fills)} DCA fills"
        msg += ")"
        print(msg)

    # 5. Print summary
    if not quiet:
        print_summary(trades, coingecko_id)

    # 6. Write to Supabase (skip in compare/quiet mode)
    if not quiet:
        write_to_supabase(trades, asset_id, coingecko_id, dry_run=dry_run)

    return trades


# ---------------------------------------------------------------------------
# A/B Comparison mode
# ---------------------------------------------------------------------------


def extract_metrics(trades: list[dict]) -> dict:
    """Extract summary metrics from a trade list for comparison."""
    closed = [t for t in trades if t["status"] == "closed"]
    opens = [t for t in trades if t["status"] == "open"]
    trims = [t for t in closed if t.get("direction") == "trim"]
    bb_trades = [t for t in closed if t.get("direction", "").startswith("bb_")]
    bb2_trades = [t for t in closed if t.get("direction", "").startswith("bb2_")]
    reentry_trades = [t for t in closed if t.get("direction") == "reentry"]
    dca_fills = [t for t in closed if t.get("direction") == "dca_entry"]
    trailing_stop_closes = [t for t in closed if t.get("exit_signal_reason") == "trailing_stop"]
    # Supplementary types to exclude from "full closes" (EMA trades only)
    supplementary_dirs = {"trim", "bb_long", "bb_short", "bb2_long", "bb2_short", "reentry", "dca_entry"}
    full_closes = [t for t in closed if t.get("direction") not in supplementary_dirs]
    longs = [t for t in full_closes if t.get("direction") == "long"]
    shorts = [t for t in full_closes if t.get("direction") == "short"]

    long_wins = [t for t in longs if t["pnl_pct"] >= 0]
    short_wins = [t for t in shorts if t["pnl_pct"] >= 0]
    bb_wins = [t for t in bb_trades if t["pnl_pct"] >= 0]
    bb2_wins = [t for t in bb2_trades if t["pnl_pct"] >= 0]
    reentry_wins = [t for t in reentry_trades if t["pnl_pct"] >= 0]

    total_pnl_usd = sum(t.get("pnl_usd", 0) for t in closed)
    trim_pnl_usd = sum(t.get("pnl_usd", 0) for t in trims)
    bb_pnl_usd = sum(t.get("pnl_usd", 0) for t in bb_trades)
    bb2_pnl_usd = sum(t.get("pnl_usd", 0) for t in bb2_trades)
    reentry_pnl_usd = sum(t.get("pnl_usd", 0) for t in reentry_trades)
    open_pnl_usd = sum(t.get("pnl_usd", 0) for t in opens)

    # Win rate includes EMA trades only (BB/BB2/reentry are supplementary)
    win_rate = (
        (len(long_wins) + len(short_wins)) / len(full_closes) * 100
        if full_closes
        else 0
    )

    # Average trade duration in days (for full closes)
    durations = []
    for t in full_closes:
        if t.get("entry_date") and t.get("exit_date"):
            try:
                d_in = datetime.strptime(t["entry_date"], "%Y-%m-%d")
                d_out = datetime.strptime(t["exit_date"], "%Y-%m-%d")
                durations.append((d_out - d_in).days)
            except (ValueError, TypeError):
                pass
    avg_duration = sum(durations) / len(durations) if durations else 0

    # Max drawdown on any single trade
    all_pnls = [t["pnl_pct"] for t in full_closes]
    max_loss = min(all_pnls) if all_pnls else 0

    # Total trade count (for frequency analysis — all actionable trades)
    total_signals = len(full_closes) + len(bb_trades) + len(bb2_trades) + len(reentry_trades)

    return {
        "full_trades": len(full_closes),
        "trims": len(trims),
        "bb_trades": len(bb_trades),
        "bb_wins": len(bb_wins),
        "bb_pnl_usd": bb_pnl_usd,
        "bb2_trades": len(bb2_trades),
        "bb2_wins": len(bb2_wins),
        "bb2_pnl_usd": bb2_pnl_usd,
        "reentries": len(reentry_trades),
        "reentry_wins": len(reentry_wins),
        "reentry_pnl_usd": reentry_pnl_usd,
        "dca_fills": len(dca_fills),
        "open_trades": len(opens),
        "longs": len(longs),
        "shorts": len(shorts),
        "long_wins": len(long_wins),
        "short_wins": len(short_wins),
        "win_rate": win_rate,
        "long_win_rate": len(long_wins) / len(longs) * 100 if longs else 0,
        "short_win_rate": len(short_wins) / len(shorts) * 100 if shorts else 0,
        "trailing_stop_closes": len(trailing_stop_closes),
        "total_pnl_usd": total_pnl_usd,
        "trim_pnl_usd": trim_pnl_usd,
        "close_pnl_usd": total_pnl_usd - trim_pnl_usd - bb_pnl_usd - bb2_pnl_usd - reentry_pnl_usd,
        "open_pnl_usd": open_pnl_usd,
        "avg_duration_days": avg_duration,
        "max_single_loss_pct": max_loss,
        "total_signals": total_signals,
    }


def print_comparison(
    asset_name: str,
    metrics_a: dict,
    metrics_b: dict,
    config_a: dict,
    config_b: dict,
) -> None:
    """Print side-by-side comparison of two configs for one asset."""
    name_a = config_a.get("name", "Config A")
    name_b = config_b.get("name", "Config B")

    def delta(val_a: float, val_b: float, fmt: str = "+,.0f", higher_is_better: bool = True) -> str:
        diff = val_b - val_a
        if diff == 0:
            return "  ─"
        arrow = "▲" if (diff > 0) == higher_is_better else "▼"
        return f"  {arrow} {diff:{fmt}}"

    print(f"\n  {'─' * 72}")
    print(f"  {asset_name:^72}")
    print(f"  {'─' * 72}")
    print(f"  {'Metric':<28} {name_a:>18} {name_b:>18}   {'Δ':>6}")
    print(f"  {'─' * 72}")

    rows = [
        ("Full trades (EMA)", f"{metrics_a['full_trades']}", f"{metrics_b['full_trades']}", None),
        ("  Longs", f"{metrics_a['longs']}", f"{metrics_b['longs']}", None),
        ("  Shorts", f"{metrics_a['shorts']}", f"{metrics_b['shorts']}", None),
        ("Trim trades", f"{metrics_a['trims']}", f"{metrics_b['trims']}", None),
        ("BB complementary trades", f"{metrics_a.get('bb_trades', 0)}", f"{metrics_b.get('bb_trades', 0)}",
         delta(metrics_a.get("bb_trades", 0), metrics_b.get("bb_trades", 0), "+.0f")),
        ("BB2 improved trades", f"{metrics_a.get('bb2_trades', 0)}", f"{metrics_b.get('bb2_trades', 0)}",
         delta(metrics_a.get("bb2_trades", 0), metrics_b.get("bb2_trades", 0), "+.0f")),
        ("Re-entries", f"{metrics_a.get('reentries', 0)}", f"{metrics_b.get('reentries', 0)}",
         delta(metrics_a.get("reentries", 0), metrics_b.get("reentries", 0), "+.0f")),
        ("DCA fills", f"{metrics_a.get('dca_fills', 0)}", f"{metrics_b.get('dca_fills', 0)}",
         delta(metrics_a.get("dca_fills", 0), metrics_b.get("dca_fills", 0), "+.0f")),
        ("Total signals", f"{metrics_a.get('total_signals', 0)}", f"{metrics_b.get('total_signals', 0)}",
         delta(metrics_a.get("total_signals", 0), metrics_b.get("total_signals", 0), "+.0f")),
        ("Trailing stop closes", f"{metrics_a.get('trailing_stop_closes', 0)}", f"{metrics_b.get('trailing_stop_closes', 0)}",
         delta(metrics_a.get("trailing_stop_closes", 0), metrics_b.get("trailing_stop_closes", 0), "+.0f")),
        ("Win rate (EMA)", f"{metrics_a['win_rate']:.0f}%", f"{metrics_b['win_rate']:.0f}%",
         delta(metrics_a["win_rate"], metrics_b["win_rate"], "+.0f")),
        ("  Long win rate", f"{metrics_a.get('long_win_rate', 0):.0f}%", f"{metrics_b.get('long_win_rate', 0):.0f}%",
         delta(metrics_a.get("long_win_rate", 0), metrics_b.get("long_win_rate", 0), "+.0f")),
        ("  Short win rate", f"{metrics_a.get('short_win_rate', 0):.0f}%", f"{metrics_b.get('short_win_rate', 0):.0f}%",
         delta(metrics_a.get("short_win_rate", 0), metrics_b.get("short_win_rate", 0), "+.0f")),
        ("Avg duration (days)", f"{metrics_a['avg_duration_days']:.0f}", f"{metrics_b['avg_duration_days']:.0f}",
         delta(metrics_a["avg_duration_days"], metrics_b["avg_duration_days"], "+.0f")),
        ("Max single loss", f"{metrics_a['max_single_loss_pct']:+.1f}%", f"{metrics_b['max_single_loss_pct']:+.1f}%",
         delta(metrics_a["max_single_loss_pct"], metrics_b["max_single_loss_pct"], "+.1f", higher_is_better=True)),
        ("─" * 28, "─" * 18, "─" * 18, "─" * 6),
        ("USD P&L (closed)", f"${metrics_a['total_pnl_usd']:+,.0f}", f"${metrics_b['total_pnl_usd']:+,.0f}",
         delta(metrics_a["total_pnl_usd"], metrics_b["total_pnl_usd"], "+,.0f")),
        ("  from EMA closes", f"${metrics_a['close_pnl_usd']:+,.0f}", f"${metrics_b['close_pnl_usd']:+,.0f}",
         delta(metrics_a["close_pnl_usd"], metrics_b["close_pnl_usd"], "+,.0f")),
        ("  from trims", f"${metrics_a['trim_pnl_usd']:+,.0f}", f"${metrics_b['trim_pnl_usd']:+,.0f}",
         delta(metrics_a["trim_pnl_usd"], metrics_b["trim_pnl_usd"], "+,.0f")),
        ("  from BB trades", f"${metrics_a.get('bb_pnl_usd', 0):+,.0f}", f"${metrics_b.get('bb_pnl_usd', 0):+,.0f}",
         delta(metrics_a.get("bb_pnl_usd", 0), metrics_b.get("bb_pnl_usd", 0), "+,.0f")),
        ("  from BB2 trades", f"${metrics_a.get('bb2_pnl_usd', 0):+,.0f}", f"${metrics_b.get('bb2_pnl_usd', 0):+,.0f}",
         delta(metrics_a.get("bb2_pnl_usd", 0), metrics_b.get("bb2_pnl_usd", 0), "+,.0f")),
        ("  from re-entries", f"${metrics_a.get('reentry_pnl_usd', 0):+,.0f}", f"${metrics_b.get('reentry_pnl_usd', 0):+,.0f}",
         delta(metrics_a.get("reentry_pnl_usd", 0), metrics_b.get("reentry_pnl_usd", 0), "+,.0f")),
        ("USD P&L (open)", f"${metrics_a['open_pnl_usd']:+,.0f}", f"${metrics_b['open_pnl_usd']:+,.0f}",
         delta(metrics_a["open_pnl_usd"], metrics_b["open_pnl_usd"], "+,.0f")),
    ]

    for label, val_a, val_b, d in rows:
        d_str = d if d else ""
        print(f"  {label:<28} {val_a:>18} {val_b:>18} {d_str}")

    print(f"  {'─' * 72}")


def apply_circuit_breaker(
    all_asset_trades: dict[str, list[dict]],
    all_asset_dfs: dict[str, pd.DataFrame],
    config: dict,
    position_size: float = POSITION_SIZE_USD,
) -> dict[str, list[dict]]:
    """
    Portfolio-level drawdown circuit breaker (post-processing pass).

    After running each asset's simulation independently, this function
    walks through all dates chronologically and checks the aggregate
    unrealized P&L across all open positions. If it breaches the
    threshold, force-closes everything.

    Args:
        all_asset_trades: {coingecko_id: [trade, ...]} from individual simulations
        all_asset_dfs: {coingecko_id: indicator DataFrame} for price lookups
        config: signal config with circuit_breaker_pct
        position_size: USD per position

    Returns:
        Modified all_asset_trades dict with circuit breaker closures injected.
    """
    if not config.get("portfolio_circuit_breaker", False):
        return all_asset_trades

    threshold_pct = config.get("circuit_breaker_pct", -10.0)

    # Collect all unique dates across all assets
    all_dates: set = set()
    for cg_id, df in all_asset_dfs.items():
        all_dates.update(df.index.tolist())
    all_dates_sorted = sorted(all_dates)

    # Build a timeline of open positions from each asset's trades
    # For each asset, track what's open and when it opened/closed
    tripped = False
    trip_date = None

    for date in all_dates_sorted:
        if tripped:
            break

        # Calculate aggregate unrealized P&L on this date
        total_unrealized_pct = 0.0
        open_positions = []  # (cg_id, trade, unrealized_pct, remaining_frac)

        for cg_id, trades in all_asset_trades.items():
            df = all_asset_dfs.get(cg_id)
            if df is None or date not in df.index:
                continue

            current_price = df.loc[date]["close"]

            for t in trades:
                direction = t.get("direction", "long")
                if direction in ("trim", "dca_entry", "reentry") or direction.startswith("bb_") or direction.startswith("bb2_"):
                    continue  # skip supplementary trades for circuit breaker calc

                entry_date_str = t.get("entry_date", "")
                exit_date_str = t.get("exit_date") or "9999-12-31"

                try:
                    entry_dt = datetime.strptime(entry_date_str, "%Y-%m-%d").date()
                    exit_dt = datetime.strptime(exit_date_str, "%Y-%m-%d").date()
                except (ValueError, TypeError):
                    continue

                # Is this trade open on this date?
                if entry_dt <= date <= exit_dt:
                    entry_price = t["entry_price"]
                    remaining = t.get("remaining_pct", 100) / 100.0

                    if direction == "long":
                        unrealized = ((current_price - entry_price) / entry_price) * 100
                    elif direction == "short":
                        unrealized = ((entry_price - current_price) / entry_price) * 100
                    else:
                        continue

                    weighted = unrealized * remaining
                    total_unrealized_pct += weighted
                    open_positions.append((cg_id, t, unrealized, remaining))

        # Check circuit breaker
        if open_positions and total_unrealized_pct <= threshold_pct:
            tripped = True
            trip_date = date
            num_positions = len(open_positions)
            print(f"\n  🚨 CIRCUIT BREAKER TRIPPED on {date}!")
            print(f"     Aggregate unrealized: {total_unrealized_pct:+.1f}% (threshold: {threshold_pct}%)")
            print(f"     Force-closing {num_positions} positions:")

            # Force-close all open EMA positions
            for cg_id, trade, unrealized, remaining in open_positions:
                df = all_asset_dfs[cg_id]
                if date not in df.index:
                    continue
                row = df.loc[date]
                current_price = row["close"]
                direction = trade.get("direction", "long")
                entry_price = trade["entry_price"]

                if direction == "long":
                    pnl_pct = round(((current_price - entry_price) / entry_price) * 100, 2)
                else:
                    pnl_pct = round(((entry_price - current_price) / entry_price) * 100, 2)

                pnl_usd = round(remaining * pnl_pct / 100 * position_size, 2)

                print(f"       {cg_id}: {direction.upper()} {pnl_pct:+.1f}% ${pnl_usd:+,.0f}")

                # Modify the trade in-place: set exit date and mark closed
                trade["exit_date"] = str(date)
                trade["exit_price"] = round(current_price, 2)
                trade["exit_signal_color"] = "red" if direction == "long" else "green"
                trade["exit_signal_reason"] = f"circuit_breaker ({total_unrealized_pct:+.1f}%)"
                trade["pnl_pct"] = pnl_pct
                trade["pnl_usd"] = pnl_usd
                trade["remaining_pct"] = round(remaining * 100, 1)
                trade["status"] = "closed"
                trade["exit_indicators"] = _snapshot_indicators(row)

    if not tripped:
        print(f"\n  ✅ Circuit breaker ({threshold_pct}%) never tripped")

    return all_asset_trades


# ---------------------------------------------------------------------------
# Volatile period analysis
# ---------------------------------------------------------------------------


def identify_volatile_periods(
    df: pd.DataFrame, n: int = 5, window_days: int = 7
) -> list[dict]:
    """
    Find the N worst drawdown periods in a price DataFrame.

    Slides a `window_days`-wide window across the data, computes peak-to-trough
    drawdown in each window, and returns the N worst (non-overlapping) periods.

    Returns list of dicts: [{start_date, end_date, drawdown_pct, lowest_price, peak_price}]
    """
    if len(df) < window_days:
        return []

    close = df["close"]
    periods: list[dict] = []

    for i in range(len(close) - window_days + 1):
        window = close.iloc[i: i + window_days]
        peak = window.max()
        trough = window.min()
        drawdown = ((trough - peak) / peak) * 100  # negative number

        periods.append({
            "start_date": df.index[i],
            "end_date": df.index[i + window_days - 1],
            "drawdown_pct": round(drawdown, 2),
            "peak_price": round(peak, 2),
            "lowest_price": round(trough, 2),
        })

    # Sort by worst drawdown (most negative first)
    periods.sort(key=lambda p: p["drawdown_pct"])

    # Deduplicate overlapping windows — keep worst, skip if overlapping
    selected: list[dict] = []
    used_dates: set = set()

    for p in periods:
        # Check if any date in this period's range is already used
        start = p["start_date"]
        end = p["end_date"]
        overlap = False
        for used in used_dates:
            if start <= used <= end:
                overlap = True
                break
        if not overlap:
            selected.append(p)
            # Mark all dates in range as used
            idx = df.index.tolist()
            for d in idx:
                if start <= d <= end:
                    used_dates.add(d)
        if len(selected) >= n:
            break

    return selected


def measure_period_performance(
    trades: list[dict], start_date, end_date
) -> dict:
    """
    Measure trade performance within a specific date window.

    Includes trades that were open during any part of the period:
    - Fully within the period (entry and exit both in range)
    - Partially overlapping (open before, closed during; or opened during, still open)

    Returns: {trades_active, pnl_usd, trades_closed, trades_opened}
    """
    start_str = str(start_date)
    end_str = str(end_date)

    active_trades = []
    for t in trades:
        entry = t.get("entry_date", "")
        exit_d = t.get("exit_date") or "9999-12-31"
        direction = t.get("direction", "long")

        # Skip trims for the main P&L calculation (they're partial)
        if direction == "trim":
            continue

        # Trade is active during this period if it overlaps
        if entry <= end_str and exit_d >= start_str:
            active_trades.append(t)

    # Calculate P&L from trades closed during the period
    closed_in_period = [
        t for t in active_trades
        if t.get("exit_date") and start_str <= t["exit_date"] <= end_str
        and t["status"] == "closed"
    ]
    opened_in_period = [
        t for t in active_trades
        if start_str <= t.get("entry_date", "") <= end_str
    ]

    pnl_usd = sum(t.get("pnl_usd", 0) for t in closed_in_period)

    # Also count trims that happened during the period
    trims_in_period = [
        t for t in trades
        if t.get("direction") == "trim"
        and t.get("exit_date") and start_str <= t["exit_date"] <= end_str
    ]
    trim_pnl = sum(t.get("pnl_usd", 0) for t in trims_in_period)

    return {
        "trades_active": len(active_trades),
        "trades_closed": len(closed_in_period),
        "trades_opened": len(opened_in_period),
        "trims": len(trims_in_period),
        "pnl_usd": round(pnl_usd, 2),
        "trim_pnl_usd": round(trim_pnl, 2),
        "total_pnl_usd": round(pnl_usd + trim_pnl, 2),
    }


def compute_buy_and_hold(df: pd.DataFrame) -> float:
    """Compute buy-and-hold return % over the entire DataFrame period."""
    if len(df) < 2:
        return 0.0
    first = df["close"].iloc[0]
    last = df["close"].iloc[-1]
    return round(((last - first) / first) * 100, 2)


def print_volatile_period_report(
    periods: list[dict],
    baseline_trades: list[dict],
    proposed_trades: list[dict],
    asset_name: str,
    baseline_name: str = "Baseline",
    proposed_name: str = "Proposed",
) -> None:
    """Print side-by-side performance during volatile periods."""
    if not periods:
        print(f"\n  No volatile periods identified for {asset_name}")
        return

    print(f"\n  {'─' * 80}")
    print(f"  VOLATILE PERIOD ANALYSIS: {asset_name}")
    print(f"  {'─' * 80}")
    print(f"  {'Period':<22} {'Drawdown':>10} {'':>4} {baseline_name:>16} {proposed_name:>16} {'Delta':>10}")
    print(f"  {'─' * 80}")

    total_baseline = 0.0
    total_proposed = 0.0

    for i, period in enumerate(periods):
        start = period["start_date"]
        end = period["end_date"]
        dd = period["drawdown_pct"]

        baseline_perf = measure_period_performance(baseline_trades, start, end)
        proposed_perf = measure_period_performance(proposed_trades, start, end)

        b_pnl = baseline_perf["total_pnl_usd"]
        p_pnl = proposed_perf["total_pnl_usd"]
        delta = p_pnl - b_pnl

        total_baseline += b_pnl
        total_proposed += p_pnl

        better = "▲" if delta > 0 else ("▼" if delta < 0 else "─")
        date_str = f"{start} → {end}"

        print(
            f"  {date_str:<22} {dd:>+9.1f}% {'':>4} ${b_pnl:>+14,.0f} ${p_pnl:>+14,.0f} {better} ${abs(delta):>7,.0f}"
        )

    print(f"  {'─' * 80}")
    total_delta = total_proposed - total_baseline
    better = "▲" if total_delta > 0 else ("▼" if total_delta < 0 else "─")
    print(
        f"  {'TOTAL':<22} {'':>10} {'':>4} ${total_baseline:>+14,.0f} ${total_proposed:>+14,.0f} {better} ${abs(total_delta):>7,.0f}"
    )
    print(f"  {'─' * 80}")

    if total_delta > 0:
        print(f"  ✅ Proposed config performed ${total_delta:,.0f} BETTER during volatile periods")
    elif total_delta < 0:
        print(f"  ❌ Proposed config performed ${abs(total_delta):,.0f} WORSE during volatile periods")
    else:
        print(f"  ─ No difference during volatile periods")


def run_comparison(
    assets: list[dict],
    days: int,
    config_a: dict | None = None,
    config_b: dict | None = None,
    source: str = "hyperliquid",
) -> None:
    """Run A/B comparison on same price data. Defaults to SIGNAL_CONFIG vs IMPROVED_CONFIG."""
    if config_a is None:
        config_a = SIGNAL_CONFIG
    if config_b is None:
        config_b = IMPROVED_CONFIG

    print("\n" + "=" * 74)
    print(f"  A/B COMPARISON: {config_a['name']} vs {config_b['name']}")
    print(f"  Lookback: {days} days | Position: ${POSITION_SIZE_USD:,}")
    print("=" * 74)

    # Print config differences
    print(f"\n  Config differences:")
    diff_keys = [
        ("grace_period_days", "Grace period (days)"),
        ("trend_break_confirm_days", "Trend-break confirm"),
        ("trim_mode", "Trim sizing mode"),
        ("rsi_short_yellow_threshold", "Short yellow RSI ≤"),
        ("rsi_short_orange_threshold", "Short orange RSI ≤"),
        ("volume_confirm", "Volume confirmation"),
        ("volume_entry_threshold", "Volume entry threshold"),
        ("atr_stop_loss", "ATR dynamic stop-loss"),
        ("atr_stop_multiplier", "ATR stop multiplier"),
        ("btc_crash_filter", "BTC crash filter"),
        ("btc_crash_threshold", "BTC crash threshold"),
        ("portfolio_circuit_breaker", "Portfolio circuit breaker"),
        ("rsi_bb_complementary", "RSI BB complementary"),
        ("rsi_bb_hold_days", "RSI BB hold days"),
        ("rsi_bb_trend_filter", "BB trend filter (SMA-50)"),
        ("rsi_bb_cooldown_days", "BB cooldown after stop"),
        ("confirmation_bars", "Confirmation gate (bars)"),
        ("rsi_velocity_enabled", "RSI velocity detection"),
        ("rsi_velocity_threshold", "RSI velocity threshold"),
        ("rsi_velocity_action", "RSI velocity action"),
        # V5 strategy params
        ("profit_ladder_enabled", "Profit ladder"),
        ("profit_ladder_levels", "Ladder levels (%)"),
        ("profit_ladder_fractions", "Ladder fractions"),
        ("pullback_reentry", "Pullback re-entry"),
        ("pullback_ema_buffer_pct", "Pullback EMA buffer %"),
        ("pullback_min_profit_pct", "Pullback min profit %"),
        ("pullback_add_frac", "Pullback add fraction"),
        ("pullback_max_adds", "Pullback max adds"),
        ("dca_enabled", "DCA scaling"),
        ("dca_tranches", "DCA tranches"),
        ("dca_interval_bars", "DCA interval (bars)"),
        ("dca_max_adverse_pct", "DCA max adverse %"),
        ("bb_improved", "Improved BB (BB2)"),
        ("bb_improved_lookback", "BB2 lookback"),
        ("bb_improved_std_mult", "BB2 std multiplier"),
        ("bb_improved_hold_days", "BB2 hold days"),
        ("bb_improved_stop_pct", "BB2 stop %"),
        ("bb_improved_position_mult", "BB2 position mult"),
        ("bb_improved_cooldown_days", "BB2 cooldown days"),
        # V6 short profit capture params
        ("trailing_stop_short", "Trailing stop (shorts)"),
        ("trailing_stop_long", "Trailing stop (longs)"),
        ("trailing_stop_activation_pct", "Trail activation %"),
        ("trailing_stop_trail_pct", "Trail distance %"),
        ("short_ladder_levels", "Short ladder levels"),
        ("short_ladder_fractions", "Short ladder fractions"),
        ("pullback_reentry_short", "Short re-entry enabled"),
    ]
    for key, label in diff_keys:
        va = config_a.get(key, "n/a")
        vb = config_b.get(key, "n/a")
        marker = " ◀" if va != vb else ""
        print(f"    {label:<28} {str(va):>14} → {str(vb):<14}{marker}")

    # ── Pre-fetch BTC data for crash filter (used by altcoins) ──
    btc_df_for_crash: pd.DataFrame | None = None
    has_btc_filter = config_b.get("btc_crash_filter", False)
    if has_btc_filter:
        # Check if BTC is among the assets
        btc_asset = next((a for a in assets if a["coingecko_id"] == "bitcoin"), None)
        if btc_asset:
            print(f"\n  Pre-fetching BTC data for crash filter...")
            btc_raw = fetch_ohlc("bitcoin", days, source=source)
            btc_df_for_crash = calculate_indicators(btc_raw, config=config_a)
            print(f"  BTC data ready ({len(btc_df_for_crash)} rows)")
            if source == "coingecko":
                time.sleep(CG_SLEEP_SECONDS)
        else:
            # Fetch BTC separately for the crash filter
            print(f"\n  Pre-fetching BTC data for crash filter (BTC not in asset list)...")
            btc_raw = fetch_ohlc("bitcoin", days, source=source)
            btc_df_for_crash = calculate_indicators(btc_raw, config=config_a)
            print(f"  BTC data ready ({len(btc_df_for_crash)} rows)")
            if source == "coingecko":
                time.sleep(CG_SLEEP_SECONDS)

    # Per-asset trades and indicator DataFrames (needed for circuit breaker)
    per_asset_trades_a: dict[str, list[dict]] = {}
    per_asset_trades_b: dict[str, list[dict]] = {}
    per_asset_dfs: dict[str, pd.DataFrame] = {}

    for i, asset in enumerate(assets):
        cg_id = asset["coingecko_id"]
        a_id = asset["id"]
        symbol = asset["symbol"]

        print(f"\n{'─' * 74}")
        print(f"  [{i + 1}/{len(assets)}] Fetching {symbol} ({cg_id})...")
        print(f"{'─' * 74}")

        # Fetch price data ONCE
        df_raw = fetch_ohlc(cg_id, days, source=source)

        # Store indicator DataFrame for circuit breaker price lookups
        df_indicators = calculate_indicators(df_raw.copy(), config=config_b)
        per_asset_dfs[cg_id] = df_indicators

        # Run both configs on same data
        print(f"  Running {config_a['name']}...")
        trades_a = run_backtest(
            cg_id, a_id, days, dry_run=True, config=config_a,
            df_cached=df_raw, quiet=True, btc_df=None,
        )
        print(f"  Running {config_b['name']}...")
        trades_b = run_backtest(
            cg_id, a_id, days, dry_run=True, config=config_b,
            df_cached=df_raw, quiet=True, btc_df=btc_df_for_crash,
        )

        per_asset_trades_a[cg_id] = trades_a
        per_asset_trades_b[cg_id] = trades_b

        # Rate limit (only needed for CoinGecko; Hyperliquid is fast with generous limits)
        if i < len(assets) - 1 and source == "coingecko":
            print(f"\n  ⏳ Sleeping {CG_SLEEP_SECONDS}s for rate limit...")
            time.sleep(CG_SLEEP_SECONDS)

    # ── Apply portfolio circuit breaker (config B only) ──
    if config_b.get("portfolio_circuit_breaker", False) and len(assets) > 1:
        print(f"\n{'─' * 74}")
        print(f"  Portfolio Circuit Breaker Check ({config_b['name']})")
        print(f"{'─' * 74}")
        per_asset_trades_b = apply_circuit_breaker(
            per_asset_trades_b, per_asset_dfs, config_b, position_size=POSITION_SIZE_USD
        )

    # ── Per-asset comparison (after circuit breaker) ──
    all_metrics_a: list[dict] = []
    all_metrics_b: list[dict] = []

    for asset in assets:
        cg_id = asset["coingecko_id"]
        symbol = asset["symbol"]
        trades_a = per_asset_trades_a[cg_id]
        trades_b = per_asset_trades_b[cg_id]

        metrics_a = extract_metrics(trades_a)
        metrics_b = extract_metrics(trades_b)
        all_metrics_a.append(metrics_a)
        all_metrics_b.append(metrics_b)

        print_comparison(f"{symbol} ({cg_id})", metrics_a, metrics_b, config_a, config_b)

        print(f"\n  {config_a['name']} trades:")
        _print_trade_log(trades_a)
        print(f"\n  {config_b['name']} trades:")
        _print_trade_log(trades_b)

    # ── Aggregate comparison ──
    agg_a = _aggregate_metrics(all_metrics_a)
    agg_b = _aggregate_metrics(all_metrics_b)
    print_comparison("ALL ASSETS (AGGREGATE)", agg_a, agg_b, config_a, config_b)

    # ── Verdict ──
    pnl_diff = agg_b["total_pnl_usd"] + agg_b["open_pnl_usd"] - agg_a["total_pnl_usd"] - agg_a["open_pnl_usd"]
    wr_diff = agg_b["win_rate"] - agg_a["win_rate"]

    print(f"\n{'=' * 74}")
    print(f"  VERDICT")
    print(f"{'=' * 74}")
    total_a = agg_a["total_pnl_usd"] + agg_a["open_pnl_usd"]
    total_b = agg_b["total_pnl_usd"] + agg_b["open_pnl_usd"]
    print(f"  {config_a['name']:>24}: ${total_a:+,.0f} total (closed + open)")
    print(f"  {config_b['name']:>24}: ${total_b:+,.0f} total (closed + open)")
    print(f"  {'Difference':>24}: ${pnl_diff:+,.0f} | Win rate: {wr_diff:+.0f}pp")

    if pnl_diff > 0 and wr_diff >= 0:
        print(f"\n  ✅ Improved config wins on both P&L and win rate.")
    elif pnl_diff > 0:
        print(f"\n  🟡 Improved config has better P&L but lower win rate (higher risk/reward).")
    elif wr_diff > 0:
        print(f"\n  🟡 Improved config has better win rate but lower P&L.")
    else:
        print(f"\n  ❌ Current config outperforms on this data set.")
    print(f"{'=' * 74}")

    # ── Buy-and-hold comparison ──
    print(f"\n{'=' * 74}")
    print(f"  BUY-AND-HOLD COMPARISON")
    print(f"{'=' * 74}")
    print(f"  {'Asset':<20} {'Buy & Hold':>12} {config_a['name']:>18} {config_b['name']:>18}")
    print(f"  {'─' * 70}")
    for asset in assets:
        cg_id = asset["coingecko_id"]
        symbol = asset["symbol"]
        df = per_asset_dfs.get(cg_id)
        bnh = compute_buy_and_hold(df) if df is not None else 0.0
        a_pnl = extract_metrics(per_asset_trades_a[cg_id])["total_pnl_usd"]
        b_pnl = extract_metrics(per_asset_trades_b[cg_id])["total_pnl_usd"]
        # Convert USD P&L to % of position for fair comparison
        a_pct = a_pnl / POSITION_SIZE_USD * 100 if POSITION_SIZE_USD else 0
        b_pct = b_pnl / POSITION_SIZE_USD * 100 if POSITION_SIZE_USD else 0
        print(f"  {symbol:<20} {bnh:>+11.1f}% {a_pct:>+17.1f}% {b_pct:>+17.1f}%")
    print(f"{'=' * 74}")

    # ── Volatile period analysis (per asset) ──
    print(f"\n{'=' * 74}")
    print(f"  VOLATILE PERIOD ANALYSIS (5 worst drawdowns per asset)")
    print(f"{'=' * 74}")
    for asset in assets:
        cg_id = asset["coingecko_id"]
        symbol = asset["symbol"]
        df = per_asset_dfs.get(cg_id)
        if df is None:
            continue

        periods = identify_volatile_periods(df, n=5, window_days=7)
        trades_a = per_asset_trades_a[cg_id]
        trades_b = per_asset_trades_b[cg_id]

        print_volatile_period_report(
            periods, trades_a, trades_b, symbol,
            baseline_name=config_a["name"],
            proposed_name=config_b["name"],
        )


def _print_trade_log(trades: list[dict]) -> None:
    """Compact trade log for comparison output."""
    closed = sorted(
        [t for t in trades if t["status"] == "closed"],
        key=lambda t: t.get("exit_date", ""),
    )
    opens = [t for t in trades if t["status"] == "open"]

    for t in closed:
        direction = t.get("direction", "long")
        if direction == "trim":
            trim_pct = t.get("trim_pct", 0)
            reason = t.get("exit_signal_reason", "")
            ladder_tag = " [ladder]" if "ladder_" in reason else ""
            print(f"    🟡 TRIM   {t['exit_date']}  {t['pnl_pct']:+.1f}% ${t.get('pnl_usd',0):+,.0f}  (trimmed {trim_pct:.0f}%{ladder_tag})")
        elif direction == "dca_entry":
            reason = t.get("entry_signal_reason", "")
            print(f"    📊 DCA    {t['entry_date']}  ${t['entry_price']:,.0f}  ({reason})")
        elif direction == "reentry":
            emoji = "🔄" if t["pnl_pct"] >= 0 else "🔃"
            reason = t.get("exit_signal_reason", "")
            exit_date = t.get("exit_date", "now")
            print(f"    {emoji} RE-EN {t['entry_date']} → {exit_date}  {t['pnl_pct']:+.1f}% ${t.get('pnl_usd',0):+,.0f}  ({reason})")
        elif direction.startswith("bb2_"):
            bb_dir = "BB2↑" if direction == "bb2_long" else "BB2↓"
            emoji = "🔵" if t["pnl_pct"] >= 0 else "🔴"
            reason = t.get("exit_signal_reason", "")
            print(f"    {emoji} {bb_dir:5s} {t['entry_date']} → {t['exit_date']}  {t['pnl_pct']:+.1f}% ${t.get('pnl_usd',0):+,.0f}  ({reason})")
        elif direction.startswith("bb_"):
            bb_dir = "BB↑" if direction == "bb_long" else "BB↓"
            emoji = "🔵" if t["pnl_pct"] >= 0 else "🔴"
            reason = t.get("exit_signal_reason", "")
            print(f"    {emoji} {bb_dir:5s} {t['entry_date']} → {t['exit_date']}  {t['pnl_pct']:+.1f}% ${t.get('pnl_usd',0):+,.0f}  ({reason})")
        else:
            arrow = "LONG " if direction == "long" else "SHORT"
            reason = t.get("exit_signal_reason", "")
            if reason == "trailing_stop":
                emoji = "🎯"  # Trailing stop — profit captured
            elif t["pnl_pct"] >= 0:
                emoji = "✅"
            else:
                emoji = "❌"
            remaining = t.get("remaining_pct")
            rem = f" [{remaining:.0f}%rem]" if remaining is not None and remaining < 100 else ""
            print(f"    {emoji} {arrow} {t['entry_date']} → {t['exit_date']}  {t['pnl_pct']:+.1f}% ${t.get('pnl_usd',0):+,.0f}  ({reason}){rem}")

    for t in opens:
        direction = t.get("direction", "long")
        if direction.startswith("bb2_"):
            bb_dir = "BB2↑" if direction == "bb2_long" else "BB2↓"
            emoji = "📈" if t["pnl_pct"] >= 0 else "📉"
            print(f"    {emoji} {bb_dir:5s} {t['entry_date']} → now       {t['pnl_pct']:+.1f}% ${t.get('pnl_usd',0):+,.0f}  (open)")
        elif direction.startswith("bb_"):
            bb_dir = "BB↑" if direction == "bb_long" else "BB↓"
            emoji = "📈" if t["pnl_pct"] >= 0 else "📉"
            print(f"    {emoji} {bb_dir:5s} {t['entry_date']} → now       {t['pnl_pct']:+.1f}% ${t.get('pnl_usd',0):+,.0f}  (open)")
        elif direction == "reentry":
            emoji = "🔄" if t["pnl_pct"] >= 0 else "🔃"
            print(f"    {emoji} RE-EN {t['entry_date']} → now       {t['pnl_pct']:+.1f}% ${t.get('pnl_usd',0):+,.0f}  (open)")
        else:
            arrow = "LONG " if direction == "long" else "SHORT"
            emoji = "📈" if t["pnl_pct"] >= 0 else "📉"
            remaining = t.get("remaining_pct")
            rem = f" [{remaining:.0f}%rem]" if remaining is not None and remaining < 100 else ""
            print(f"    {emoji} {arrow} {t['entry_date']} → now       {t['pnl_pct']:+.1f}% ${t.get('pnl_usd',0):+,.0f}  (open){rem}")


def _aggregate_metrics(metrics_list: list[dict]) -> dict:
    """Sum up metrics across multiple assets."""
    agg = {
        "full_trades": sum(m["full_trades"] for m in metrics_list),
        "trims": sum(m["trims"] for m in metrics_list),
        "bb_trades": sum(m.get("bb_trades", 0) for m in metrics_list),
        "bb_wins": sum(m.get("bb_wins", 0) for m in metrics_list),
        "bb_pnl_usd": sum(m.get("bb_pnl_usd", 0) for m in metrics_list),
        "bb2_trades": sum(m.get("bb2_trades", 0) for m in metrics_list),
        "bb2_wins": sum(m.get("bb2_wins", 0) for m in metrics_list),
        "bb2_pnl_usd": sum(m.get("bb2_pnl_usd", 0) for m in metrics_list),
        "reentries": sum(m.get("reentries", 0) for m in metrics_list),
        "reentry_wins": sum(m.get("reentry_wins", 0) for m in metrics_list),
        "reentry_pnl_usd": sum(m.get("reentry_pnl_usd", 0) for m in metrics_list),
        "dca_fills": sum(m.get("dca_fills", 0) for m in metrics_list),
        "open_trades": sum(m["open_trades"] for m in metrics_list),
        "longs": sum(m["longs"] for m in metrics_list),
        "shorts": sum(m["shorts"] for m in metrics_list),
        "long_wins": sum(m["long_wins"] for m in metrics_list),
        "short_wins": sum(m["short_wins"] for m in metrics_list),
        "total_pnl_usd": sum(m["total_pnl_usd"] for m in metrics_list),
        "trim_pnl_usd": sum(m["trim_pnl_usd"] for m in metrics_list),
        "close_pnl_usd": sum(m["close_pnl_usd"] for m in metrics_list),
        "open_pnl_usd": sum(m["open_pnl_usd"] for m in metrics_list),
        "max_single_loss_pct": min(m["max_single_loss_pct"] for m in metrics_list),
        "total_signals": sum(m.get("total_signals", 0) for m in metrics_list),
        "trailing_stop_closes": sum(m.get("trailing_stop_closes", 0) for m in metrics_list),
    }
    total_full = agg["full_trades"]
    agg["win_rate"] = (
        (agg["long_wins"] + agg["short_wins"]) / total_full * 100
        if total_full > 0
        else 0
    )
    agg["long_win_rate"] = (
        agg["long_wins"] / agg["longs"] * 100
        if agg["longs"] > 0
        else 0
    )
    agg["short_win_rate"] = (
        agg["short_wins"] / agg["shorts"] * 100
        if agg["shorts"] > 0
        else 0
    )
    durations = [m["avg_duration_days"] for m in metrics_list if m["full_trades"] > 0]
    agg["avg_duration_days"] = sum(durations) / len(durations) if durations else 0
    return agg


# ---------------------------------------------------------------------------
# Compounding portfolio simulation
# ---------------------------------------------------------------------------


def simulate_compounding_single_pool(
    all_asset_trades: dict[str, list[dict]],
    starting_capital: float = 1000.0,
) -> dict:
    """
    Simulate a single capital pool that compounds across all assets.

    Walks through all trades chronologically. When a trade opens, the full
    available capital is deployed. When capital is locked in an open trade,
    new signals on other assets are skipped. Dollar P&L compounds — gains
    increase future position sizes, losses decrease them.

    Returns a dict with:
      - trades: list of trades with recalculated pnl_usd and position_size
      - final_capital: ending capital
      - peak_capital: high-water mark
      - max_drawdown_pct: worst peak-to-trough drawdown
      - skipped_trades: number of trades skipped due to capital being deployed
    """
    # Collect all entry events and exit events, sort by date
    events: list[dict] = []

    for cg_id, trades in all_asset_trades.items():
        for t in trades:
            # Skip supplementary trades for the single-pool sim —
            # they represent partial actions on a position already tracked
            direction = t.get("direction", "long")
            if direction in ("trim", "dca_entry", "reentry") or direction.startswith("bb_") or direction.startswith("bb2_"):
                continue

            events.append({
                "cg_id": cg_id,
                "trade": t,
                "entry_date": t.get("entry_date", ""),
                "exit_date": t.get("exit_date") or "9999-12-31",
                "pnl_pct": t.get("pnl_pct", 0),
                "remaining_pct": t.get("remaining_pct", 100),
                "status": t.get("status", "closed"),
                "direction": direction,
            })

    # Sort by entry date (ties broken by exit date — closed first)
    events.sort(key=lambda e: (e["entry_date"], e["exit_date"]))

    capital = starting_capital
    peak_capital = starting_capital
    max_drawdown_pct = 0.0
    deployed_until: str | None = None  # date string when capital frees up
    deployed_cg_id: str | None = None

    result_trades: list[dict] = []
    skipped = 0

    # Also track trims that happen during a deployed trade
    # We need to apply trim P&L to capital when they occur
    all_trims: list[dict] = []
    for cg_id, trades in all_asset_trades.items():
        for t in trades:
            if t.get("direction") == "trim":
                all_trims.append({"cg_id": cg_id, "trade": t})
    all_trims.sort(key=lambda x: x["trade"].get("exit_date", ""))

    for event in events:
        entry_date = event["entry_date"]
        exit_date = event["exit_date"]
        trade = event["trade"]

        # Check if capital is available (previous trade has exited)
        if deployed_until is not None and entry_date < deployed_until:
            skipped += 1
            continue

        # Capital is available — deploy it
        position_size = capital
        pnl_pct = event["pnl_pct"]
        remaining_frac = event["remaining_pct"] / 100.0

        # Compute dollar P&L on the full position at closing
        # (remaining_frac accounts for trims already taken)
        pnl_usd = round(remaining_frac * pnl_pct / 100 * position_size, 2)

        # Also compute trim P&L that happened during this trade
        trim_pnl = 0.0
        if event["status"] == "closed" or event["status"] == "open":
            for trim_info in all_trims:
                trim = trim_info["trade"]
                if trim_info["cg_id"] != event["cg_id"]:
                    continue
                if trim.get("entry_date") != event["entry_date"]:
                    continue
                trim_frac = trim.get("trim_pct", 0) / 100.0
                trim_return = trim.get("pnl_pct", 0)
                trim_pnl += round(trim_frac * trim_return / 100 * position_size, 2)

        total_trade_pnl = pnl_usd + trim_pnl

        result_trades.append({
            **trade,
            "position_size": round(position_size, 2),
            "pnl_usd_compound": round(total_trade_pnl, 2),
            "capital_before": round(capital, 2),
        })

        if event["status"] == "closed":
            capital += total_trade_pnl
            capital = round(capital, 2)

            # Track drawdown
            if capital > peak_capital:
                peak_capital = capital
            drawdown = ((peak_capital - capital) / peak_capital) * 100
            if drawdown > max_drawdown_pct:
                max_drawdown_pct = drawdown

            deployed_until = None
            deployed_cg_id = None
        else:
            # Trade is still open — capital remains deployed
            deployed_until = "9999-12-31"
            deployed_cg_id = event["cg_id"]

    return {
        "trades": result_trades,
        "final_capital": round(capital, 2),
        "starting_capital": starting_capital,
        "peak_capital": round(peak_capital, 2),
        "max_drawdown_pct": round(max_drawdown_pct, 1),
        "skipped_trades": skipped,
        "total_return_pct": round(((capital - starting_capital) / starting_capital) * 100, 1),
    }


def simulate_compounding_per_asset(
    all_asset_trades: dict[str, list[dict]],
    starting_capital: float = 1000.0,
) -> dict:
    """
    Simulate independent per-asset capital pools that each compound.

    Each asset gets starting_capital / num_assets. Trades compound within
    each pool independently. No cross-asset capital sharing.

    Returns a dict with:
      - per_asset: {cg_id: {trades, final_capital, ...}}
      - total_final_capital: sum of all pools
      - total_return_pct: overall portfolio return
    """
    num_assets = len(all_asset_trades)
    if num_assets == 0:
        return {"per_asset": {}, "total_final_capital": starting_capital, "total_return_pct": 0}

    pool_size = round(starting_capital / num_assets, 2)
    per_asset_results: dict[str, dict] = {}

    for cg_id, trades in all_asset_trades.items():
        capital = pool_size
        peak = pool_size
        max_dd = 0.0
        result_trades: list[dict] = []

        # Get EMA trades (not trims/BB) sorted by entry date
        ema_trades = sorted(
            [t for t in trades if t.get("direction") in ("long", "short")],
            key=lambda t: t.get("entry_date", ""),
        )
        # Index trims by entry_date for lookup
        trims_by_entry: dict[str, list[dict]] = {}
        for t in trades:
            if t.get("direction") == "trim":
                key = t.get("entry_date", "")
                trims_by_entry.setdefault(key, []).append(t)

        for trade in ema_trades:
            position_size = capital
            pnl_pct = trade.get("pnl_pct", 0)
            remaining_frac = trade.get("remaining_pct", 100) / 100.0

            # P&L from the close
            pnl_usd = round(remaining_frac * pnl_pct / 100 * position_size, 2)

            # P&L from trims during this trade
            trim_pnl = 0.0
            entry_key = trade.get("entry_date", "")
            for trim in trims_by_entry.get(entry_key, []):
                trim_frac = trim.get("trim_pct", 0) / 100.0
                trim_return = trim.get("pnl_pct", 0)
                trim_pnl += round(trim_frac * trim_return / 100 * position_size, 2)

            total_pnl = pnl_usd + trim_pnl

            result_trades.append({
                **trade,
                "position_size": round(position_size, 2),
                "pnl_usd_compound": round(total_pnl, 2),
                "capital_before": round(capital, 2),
            })

            if trade.get("status") == "closed":
                capital += total_pnl
                capital = round(capital, 2)
                if capital > peak:
                    peak = capital
                dd = ((peak - capital) / peak) * 100
                if dd > max_dd:
                    max_dd = dd

        per_asset_results[cg_id] = {
            "trades": result_trades,
            "starting_capital": pool_size,
            "final_capital": round(capital, 2),
            "peak_capital": round(peak, 2),
            "max_drawdown_pct": round(max_dd, 1),
            "total_return_pct": round(((capital - pool_size) / pool_size) * 100, 1),
        }

    total_final = sum(r["final_capital"] for r in per_asset_results.values())
    return {
        "per_asset": per_asset_results,
        "total_final_capital": round(total_final, 2),
        "starting_capital": starting_capital,
        "pool_size_per_asset": pool_size,
        "total_return_pct": round(((total_final - starting_capital) / starting_capital) * 100, 1),
    }


def print_compounding_summary(
    single_pool: dict,
    per_asset: dict,
    asset_names: dict[str, str],
) -> None:
    """Print comparison of single-pool vs per-asset compounding models."""

    print(f"\n{'=' * 74}")
    print(f"  COMPOUNDING PORTFOLIO SIMULATION")
    print(f"  Starting capital: ${single_pool['starting_capital']:,.0f}")
    print(f"{'=' * 74}")

    # ── Single Pool ──
    print(f"\n  {'─' * 70}")
    print(f"  MODEL A: Single Pool (sequential, cross-asset)")
    print(f"  {'─' * 70}")
    print(f"  Starting capital:   ${single_pool['starting_capital']:,.0f}")
    print(f"  Final capital:      ${single_pool['final_capital']:,.0f}")
    print(f"  Total return:       {single_pool['total_return_pct']:+.1f}%")
    print(f"  Peak capital:       ${single_pool['peak_capital']:,.0f}")
    print(f"  Max drawdown:       {single_pool['max_drawdown_pct']:.1f}%")
    print(f"  Trades taken:       {len(single_pool['trades'])}")
    print(f"  Trades skipped:     {single_pool['skipped_trades']} (capital deployed elsewhere)")

    # Trade log for single pool
    if single_pool["trades"]:
        print(f"\n  Trade log (compounded):")
        for t in single_pool["trades"]:
            direction = t.get("direction", "long")
            arrow = "LONG " if direction == "long" else "SHORT"
            pnl_usd = t.get("pnl_usd_compound", 0)
            pos_size = t.get("position_size", 0)
            emoji = "✅" if t.get("pnl_pct", 0) >= 0 else "❌"
            status = t.get("status", "closed")
            exit_d = t.get("exit_date", "now") or "now"
            cg_id = ""
            # Find asset name from the trade
            for cg, name in asset_names.items():
                if t.get("entry_price") and any(
                    tr.get("entry_date") == t.get("entry_date") and tr.get("entry_price") == t.get("entry_price")
                    for tr in (single_pool.get("_raw_trades", {}).get(cg, []))
                ):
                    cg_id = name
                    break
            if status == "open":
                emoji = "📈" if t.get("pnl_pct", 0) >= 0 else "📉"
            print(
                f"    {emoji} {arrow} {t['entry_date']} → {exit_d}"
                f"  |  ${pos_size:,.0f} deployed  |  {t.get('pnl_pct', 0):+.1f}% ${pnl_usd:+,.0f}"
                f"  |  [{status}]"
            )

    # ── Per-Asset Pools ──
    pa = per_asset
    print(f"\n  {'─' * 70}")
    print(f"  MODEL B: Per-Asset Pools (${pa['pool_size_per_asset']:,.0f} each × {len(pa['per_asset'])} assets)")
    print(f"  {'─' * 70}")
    print(f"  Starting capital:   ${pa['starting_capital']:,.0f}")
    print(f"  Final capital:      ${pa['total_final_capital']:,.0f}")
    print(f"  Total return:       {pa['total_return_pct']:+.1f}%")

    for cg_id, result in pa["per_asset"].items():
        name = asset_names.get(cg_id, cg_id)
        print(
            f"    {name:>6}: ${result['starting_capital']:,.0f} → ${result['final_capital']:,.0f}"
            f"  ({result['total_return_pct']:+.1f}%)"
            f"  |  max DD: {result['max_drawdown_pct']:.1f}%"
            f"  |  {len(result['trades'])} trades"
        )

    # ── Comparison ──
    sp_return = single_pool["total_return_pct"]
    pa_return = pa["total_return_pct"]
    sp_final = single_pool["final_capital"]
    pa_final = pa["total_final_capital"]

    print(f"\n  {'─' * 70}")
    print(f"  COMPARISON")
    print(f"  {'─' * 70}")
    print(f"  {'Metric':<28} {'Single Pool':>18} {'Per-Asset':>18}")
    print(f"  {'─' * 70}")
    print(f"  {'Final capital':<28} ${sp_final:>17,.0f} ${pa_final:>17,.0f}")
    print(f"  {'Total return':<28} {sp_return:>17.1f}% {pa_return:>17.1f}%")
    print(f"  {'Max drawdown':<28} {single_pool['max_drawdown_pct']:>17.1f}% {'':>18}")
    print(f"  {'Trades taken':<28} {len(single_pool['trades']):>18} {sum(len(r['trades']) for r in pa['per_asset'].values()):>18}")
    print(f"  {'Trades skipped':<28} {single_pool['skipped_trades']:>18} {'0':>18}")
    print(f"  {'─' * 70}")

    diff = sp_final - pa_final
    if diff > 0:
        print(f"\n  → Single pool outperforms by ${diff:,.0f} ({sp_return - pa_return:+.1f}pp)")
        print(f"    Reason: Compounding wins across assets, but {single_pool['skipped_trades']} trades were skipped.")
    elif diff < 0:
        print(f"\n  → Per-asset pools outperform by ${abs(diff):,.0f} ({pa_return - sp_return:+.1f}pp)")
        print(f"    Reason: Diversification catches more trades ({single_pool['skipped_trades']} were skipped in single pool).")
    else:
        print(f"\n  → Both models produced identical results.")

    print(f"\n  Takeaway for product:")
    print(f"    1. Per-asset allocation lets users capture signals across all assets")
    print(f"    2. Single pool concentrates capital for bigger compounding on winners")
    print(f"    3. Offering customizable allocation %s enables both strategies")
    print(f"{'=' * 74}")


def run_compounding_sim(
    assets: list[dict],
    days: int,
    starting_capital: float = 1000.0,
    config: dict = IMPROVED_CONFIG,
    source: str = "hyperliquid",
) -> None:
    """Run backtest with compounding capital simulation."""

    print("\n" + "=" * 74)
    print(f"  COMPOUNDING BACKTEST")
    print(f"  Starting capital: ${starting_capital:,.0f} | Config: {config.get('name', 'default')}")
    print(f"  Lookback: {days} days | Assets: {', '.join(a['symbol'] for a in assets)}")
    print("=" * 74)

    # Pre-fetch BTC data for crash filter
    btc_df_for_crash: pd.DataFrame | None = None
    if config.get("btc_crash_filter", False):
        print(f"\n  Pre-fetching BTC data for crash filter...")
        btc_raw = fetch_ohlc("bitcoin", days, source=source)
        btc_df_for_crash = calculate_indicators(btc_raw, config=config)
        print(f"  BTC data ready ({len(btc_df_for_crash)} rows)")

    # Run per-asset backtests (standard fixed-size — percentages are what matter)
    all_asset_trades: dict[str, list[dict]] = {}
    asset_names: dict[str, str] = {}

    for i, asset in enumerate(assets):
        cg_id = asset["coingecko_id"]
        symbol = asset["symbol"]
        asset_names[cg_id] = symbol

        print(f"\n{'─' * 74}")
        print(f"  [{i + 1}/{len(assets)}] {symbol} ({cg_id})")
        print(f"{'─' * 74}")

        is_btc = cg_id == "bitcoin"
        trades = run_backtest(
            cg_id, asset["id"], days,
            dry_run=True, config=config,
            quiet=False, btc_df=None if is_btc else btc_df_for_crash,
            source=source,
        )
        all_asset_trades[cg_id] = trades

        if i < len(assets) - 1 and source == "coingecko":
            print(f"\n  ⏳ Sleeping {CG_SLEEP_SECONDS}s for rate limit...")
            time.sleep(CG_SLEEP_SECONDS)

    # Run both compounding models
    single_pool = simulate_compounding_single_pool(all_asset_trades, starting_capital)
    per_asset = simulate_compounding_per_asset(all_asset_trades, starting_capital)

    # Print comparison
    print_compounding_summary(single_pool, per_asset, asset_names)


# ---------------------------------------------------------------------------
# Leverage simulation
# ---------------------------------------------------------------------------


def simulate_leverage_scenario(
    all_asset_trades: dict[str, list[dict]],
    all_asset_dfs: dict[str, pd.DataFrame],
    leverage_config: dict,
    signal_config: dict = IMPROVED_CONFIG,
    starting_capital: float = 1000.0,
) -> dict:
    """
    Simulate compounding portfolio with leverage applied per confidence tier.

    Uses single-pool sequential model. Each trade gets a confidence tier
    (A/B/C) based on indicator alignment at entry, which determines leverage.

    Liquidation check: if leveraged loss exceeds position value, the trade
    is treated as a liquidation (100% loss of deployed capital).

    Args:
        all_asset_trades: {cg_id: [trade_dicts]} from standard backtest
        all_asset_dfs: {cg_id: indicator DataFrame} for confidence tier lookups
        leverage_config: leverage multipliers per tier
        signal_config: signal config (for RSI range boundaries in tier calc)
        starting_capital: initial capital

    Returns dict with trades, final capital, stats, and per-trade tier/leverage info.
    """
    # Collect EMA trades (no trims/BB handled separately)
    events: list[dict] = []
    for cg_id, trades in all_asset_trades.items():
        for t in trades:
            direction = t.get("direction", "long")
            if direction in ("trim", "dca_entry", "reentry") or direction.startswith("bb_") or direction.startswith("bb2_"):
                continue
            events.append({
                "cg_id": cg_id,
                "trade": t,
                "entry_date": t.get("entry_date", ""),
                "exit_date": t.get("exit_date") or "9999-12-31",
                "pnl_pct": t.get("pnl_pct", 0),
                "remaining_pct": t.get("remaining_pct", 100),
                "status": t.get("status", "closed"),
                "direction": direction,
            })

    events.sort(key=lambda e: (e["entry_date"], e["exit_date"]))

    capital = starting_capital
    peak_capital = starting_capital
    max_drawdown_pct = 0.0
    deployed_until: str | None = None

    result_trades: list[dict] = []
    skipped = 0
    liquidations = 0
    tier_counts = {"A": 0, "B": 0, "C": 0}

    # Index trims by (cg_id, entry_date) for P&L inclusion
    all_trims_by_key: dict[tuple[str, str], list[dict]] = {}
    for cg_id, trades in all_asset_trades.items():
        for t in trades:
            if t.get("direction") == "trim":
                key = (cg_id, t.get("entry_date", ""))
                all_trims_by_key.setdefault(key, []).append(t)

    for event in events:
        entry_date = event["entry_date"]
        trade = event["trade"]
        cg_id = event["cg_id"]
        direction = event["direction"]

        if deployed_until is not None and entry_date < deployed_until:
            skipped += 1
            continue

        # Look up the entry row in the indicator DataFrame for tier assessment
        df = all_asset_dfs.get(cg_id)
        tier = "B"  # default
        if df is not None:
            try:
                entry_dt = datetime.strptime(entry_date, "%Y-%m-%d").date()
                if entry_dt in df.index:
                    row = df.loc[entry_dt]
                    tier = compute_confidence_tier(row, direction, config=signal_config)
            except (ValueError, TypeError, KeyError):
                pass

        tier_counts[tier] += 1

        # Determine leverage for this tier
        if tier == "A":
            leverage = leverage_config.get("tier_a_leverage", 1.0)
        elif tier == "C":
            leverage = leverage_config.get("tier_c_leverage", 1.0)
        else:
            leverage = leverage_config.get("tier_b_leverage", 1.0)

        position_size = capital
        effective_exposure = position_size * leverage

        # Compute base P&L (% return)
        pnl_pct = event["pnl_pct"]
        remaining_frac = event["remaining_pct"] / 100.0

        # Leveraged P&L: percentage * leverage
        leveraged_pnl_pct = pnl_pct * leverage

        # Check for liquidation: if leveraged loss exceeds 100%, it's a wipeout
        is_liquidated = False
        if leveraged_pnl_pct * remaining_frac <= -100:
            is_liquidated = True
            liquidations += 1
            pnl_usd = -position_size  # Total loss of deployed capital
        else:
            pnl_usd = round(remaining_frac * leveraged_pnl_pct / 100 * position_size, 2)

        # Trim P&L (also leveraged)
        trim_pnl = 0.0
        trim_key = (cg_id, event["entry_date"])
        for trim in all_trims_by_key.get(trim_key, []):
            trim_frac = trim.get("trim_pct", 0) / 100.0
            trim_return = trim.get("pnl_pct", 0) * leverage
            trim_pnl += round(trim_frac * trim_return / 100 * position_size, 2)

        total_trade_pnl = pnl_usd + trim_pnl if not is_liquidated else pnl_usd

        result_trades.append({
            **trade,
            "tier": tier,
            "leverage": leverage,
            "position_size": round(position_size, 2),
            "effective_exposure": round(effective_exposure, 2),
            "pnl_pct_leveraged": round(leveraged_pnl_pct, 2),
            "pnl_usd_leveraged": round(total_trade_pnl, 2),
            "capital_before": round(capital, 2),
            "liquidated": is_liquidated,
        })

        if event["status"] == "closed":
            capital += total_trade_pnl
            capital = max(capital, 0)  # Can't go negative
            capital = round(capital, 2)

            if capital > peak_capital:
                peak_capital = capital
            if peak_capital > 0:
                drawdown = ((peak_capital - capital) / peak_capital) * 100
                if drawdown > max_drawdown_pct:
                    max_drawdown_pct = drawdown

            deployed_until = None
        else:
            deployed_until = "9999-12-31"

    return {
        "name": leverage_config.get("name", "Unknown"),
        "trades": result_trades,
        "starting_capital": starting_capital,
        "final_capital": round(capital, 2),
        "peak_capital": round(peak_capital, 2),
        "max_drawdown_pct": round(max_drawdown_pct, 1),
        "skipped_trades": skipped,
        "liquidations": liquidations,
        "tier_counts": tier_counts,
        "total_return_pct": round(((capital - starting_capital) / starting_capital) * 100, 1) if starting_capital > 0 else 0,
    }


def print_leverage_comparison(
    scenarios: list[dict],
    asset_names: dict[str, str],
) -> None:
    """Print side-by-side comparison of leverage scenarios."""

    print(f"\n{'=' * 80}")
    print(f"  LEVERAGE SCENARIO COMPARISON")
    print(f"  Starting capital: ${scenarios[0]['starting_capital']:,.0f}")
    print(f"{'=' * 80}")

    # ── Per-scenario detail ──
    for sc in scenarios:
        print(f"\n  {'─' * 76}")
        print(f"  {sc['name']}")
        print(f"  {'─' * 76}")
        print(f"  Final capital:     ${sc['final_capital']:,.0f}  ({sc['total_return_pct']:+.1f}%)")
        print(f"  Peak capital:      ${sc['peak_capital']:,.0f}")
        print(f"  Max drawdown:      {sc['max_drawdown_pct']:.1f}%")
        print(f"  Trades taken:      {len(sc['trades'])} ({sc['skipped_trades']} skipped)")
        if sc["liquidations"] > 0:
            print(f"  ⚠️  LIQUIDATIONS:   {sc['liquidations']}")
        tc = sc["tier_counts"]
        if any(v > 0 for v in tc.values()):
            print(f"  Confidence tiers:  A={tc['A']}  B={tc['B']}  C={tc['C']}")

        # Trade log
        print(f"\n  Trade log:")
        for t in sc["trades"]:
            direction = t.get("direction", "long")
            arrow = "LONG " if direction == "long" else "SHORT"
            tier = t.get("tier", "?")
            leverage = t.get("leverage", 1.0)
            pos_size = t.get("position_size", 0)
            pnl_usd = t.get("pnl_usd_leveraged", 0)
            pnl_pct = t.get("pnl_pct_leveraged", 0)
            exit_d = t.get("exit_date", "now") or "now"
            is_liq = t.get("liquidated", False)
            status = t.get("status", "closed")

            if is_liq:
                emoji = "💀"
            elif status == "open":
                emoji = "📈" if pnl_pct >= 0 else "📉"
            else:
                emoji = "✅" if pnl_pct >= 0 else "❌"

            lev_tag = f" {leverage:.0f}x" if leverage != 1.0 else "  1x"
            liq_tag = " LIQUIDATED" if is_liq else ""
            print(
                f"    {emoji} {arrow} [{tier}]{lev_tag} {t['entry_date']} → {exit_d}"
                f"  |  ${pos_size:,.0f} deployed  |  {pnl_pct:+.1f}% ${pnl_usd:+,.0f}"
                f"  [{status}]{liq_tag}"
            )

    # ── Side-by-side comparison table ──
    print(f"\n  {'=' * 80}")
    print(f"  SUMMARY COMPARISON")
    print(f"  {'=' * 80}")

    # Header
    header = f"  {'Metric':<28}"
    for sc in scenarios:
        header += f" {sc['name']:>16}"
    print(header)
    print(f"  {'─' * 80}")

    # Rows
    row_def = [
        ("Final capital", lambda sc: f"${sc['final_capital']:>15,.0f}"),
        ("Total return", lambda sc: f"{sc['total_return_pct']:>15.1f}%"),
        ("Peak capital", lambda sc: f"${sc['peak_capital']:>15,.0f}"),
        ("Max drawdown", lambda sc: f"{sc['max_drawdown_pct']:>15.1f}%"),
        ("Trades taken", lambda sc: f"{len(sc['trades']):>16}"),
        ("Liquidations", lambda sc: f"{sc['liquidations']:>16}"),
    ]

    for label, fn in row_def:
        row = f"  {label:<28}"
        for sc in scenarios:
            row += f" {fn(sc)}"
        print(row)

    print(f"  {'─' * 80}")

    # Risk-adjusted return (Calmar-like: return / max drawdown)
    print(f"\n  Risk-adjusted analysis:")
    for sc in scenarios:
        dd = sc["max_drawdown_pct"]
        ret = sc["total_return_pct"]
        calmar = ret / dd if dd > 0 else float("inf")
        print(
            f"    {sc['name']:>30}: return/drawdown = {calmar:.2f}"
            f"  ({ret:+.1f}% / {dd:.1f}% DD)"
        )

    # Verdict
    print(f"\n  {'─' * 80}")
    best = max(scenarios, key=lambda sc: sc["final_capital"])
    safest = min(scenarios, key=lambda sc: sc["max_drawdown_pct"])
    best_risk_adj = max(
        scenarios,
        key=lambda sc: (sc["total_return_pct"] / sc["max_drawdown_pct"])
        if sc["max_drawdown_pct"] > 0 else float("inf"),
    )

    print(f"  Best absolute return:      {best['name']} (${best['final_capital']:,.0f})")
    print(f"  Lowest risk (drawdown):    {safest['name']} ({safest['max_drawdown_pct']:.1f}% DD)")
    print(f"  Best risk-adjusted:        {best_risk_adj['name']}")

    # Warn about liquidations
    total_liqs = sum(sc["liquidations"] for sc in scenarios)
    if total_liqs > 0:
        print(f"\n  ⚠️  WARNING: {total_liqs} liquidation(s) occurred across scenarios.")
        print(f"     Liquidation = 100% loss of deployed capital on a single trade.")
        print(f"     This is the #1 reason retail traders blow up with leverage.")

    has_tiered = any("Tiered" in sc["name"] for sc in scenarios)
    if has_tiered:
        tiered = next(sc for sc in scenarios if "Tiered" in sc["name"])
        flat = next((sc for sc in scenarios if "Flat" in sc["name"]), None)
        spot = next((sc for sc in scenarios if "Spot" in sc["name"]), None)

        print(f"\n  Takeaway:")
        if flat and tiered["final_capital"] > flat["final_capital"]:
            print(f"    Tiered leverage beats flat leverage — confidence-based sizing works.")
        if flat and tiered["max_drawdown_pct"] < flat["max_drawdown_pct"]:
            print(f"    Tiered leverage has lower drawdown — selective amplification is safer.")
        if spot and tiered["final_capital"] > spot["final_capital"]:
            edge = tiered["final_capital"] - spot["final_capital"]
            print(f"    Tiered leverage adds ${edge:,.0f} vs spot — worth the complexity.")
        if spot and tiered["max_drawdown_pct"] > spot["max_drawdown_pct"] * 1.5:
            print(f"    But drawdown risk is significantly higher — needs clear user warnings.")

    print(f"{'=' * 80}")


def run_leverage_sim(
    assets: list[dict],
    days: int,
    starting_capital: float = 1000.0,
    config: dict = IMPROVED_CONFIG,
    source: str = "hyperliquid",
) -> None:
    """Run all 3 leverage scenarios and compare results."""

    print("\n" + "=" * 80)
    print(f"  LEVERAGE BACKTEST SIMULATION")
    print(f"  Starting capital: ${starting_capital:,.0f} | Config: {config.get('name', 'default')}")
    print(f"  Lookback: {days} days | Assets: {', '.join(a['symbol'] for a in assets)}")
    print(f"  Scenarios: {', '.join(lc['name'] for lc in LEVERAGE_CONFIGS.values())}")
    print("=" * 80)

    # Pre-fetch BTC data for crash filter
    btc_df_for_crash: pd.DataFrame | None = None
    if config.get("btc_crash_filter", False):
        print(f"\n  Pre-fetching BTC data for crash filter...")
        btc_raw = fetch_ohlc("bitcoin", days, source=source)
        btc_df_for_crash = calculate_indicators(btc_raw, config=config)
        print(f"  BTC data ready ({len(btc_df_for_crash)} rows)")

    # Run per-asset backtests
    all_asset_trades: dict[str, list[dict]] = {}
    all_asset_dfs: dict[str, pd.DataFrame] = {}
    asset_names: dict[str, str] = {}

    for i, asset in enumerate(assets):
        cg_id = asset["coingecko_id"]
        symbol = asset["symbol"]
        asset_names[cg_id] = symbol

        print(f"\n{'─' * 80}")
        print(f"  [{i + 1}/{len(assets)}] {symbol} ({cg_id})")
        print(f"{'─' * 80}")

        df_raw = fetch_ohlc(cg_id, days, source=source)
        df_indicators = calculate_indicators(df_raw.copy(), config=config)
        all_asset_dfs[cg_id] = df_indicators

        is_btc = cg_id == "bitcoin"
        trades = run_backtest(
            cg_id, asset["id"], days,
            dry_run=True, config=config,
            quiet=True, btc_df=None if is_btc else btc_df_for_crash,
            source=source,
        )
        all_asset_trades[cg_id] = trades
        print(f"  {len(trades)} trades generated")

        if i < len(assets) - 1 and source == "coingecko":
            print(f"\n  ⏳ Sleeping {CG_SLEEP_SECONDS}s for rate limit...")
            time.sleep(CG_SLEEP_SECONDS)

    # Run all 3 scenarios
    scenarios: list[dict] = []
    for key, lev_config in LEVERAGE_CONFIGS.items():
        result = simulate_leverage_scenario(
            all_asset_trades, all_asset_dfs, lev_config,
            signal_config=config, starting_capital=starting_capital,
        )
        scenarios.append(result)

    # Print comparison
    print_leverage_comparison(scenarios, asset_names)


# ---------------------------------------------------------------------------
# Stress test: black swan event analysis
# ---------------------------------------------------------------------------


def run_stress_test(assets: list[dict], days: int, event_date: str, source: str = "hyperliquid") -> None:
    """Analyze how each config handled a specific date (black swan event).

    For each asset × config, shows:
      - What positions were open on the event date
      - What the P&L drawdown was on that day
      - Whether overrides (stop-loss, trend-break) fired
      - Days to eventual exit
    """
    configs = [SIGNAL_CONFIG, IMPROVED_CONFIG]

    print("\n" + "=" * 74)
    print(f"  STRESS TEST: Black Swan Analysis — {event_date}")
    print(f"  Configs: {', '.join(c['name'] for c in configs)}")
    print("=" * 74)

    from datetime import date as date_type

    try:
        event_dt = datetime.strptime(event_date, "%Y-%m-%d").date()
    except ValueError:
        print(f"  ❌ Invalid date format: {event_date}. Use YYYY-MM-DD.")
        return

    for i, asset in enumerate(assets):
        cg_id = asset["coingecko_id"]
        symbol = asset["symbol"]

        print(f"\n{'─' * 74}")
        print(f"  {symbol} ({cg_id})")
        print(f"{'─' * 74}")

        df_raw = fetch_ohlc(cg_id, days, source=source)

        # Get price context around the event
        df_indicators = calculate_indicators(df_raw.copy(), config=SIGNAL_CONFIG)
        event_rows = df_indicators[df_indicators.index == event_dt]

        if event_rows.empty:
            # Find closest date
            all_dates = list(df_indicators.index)
            closest = min(all_dates, key=lambda d: abs((d - event_dt).days))
            print(f"  ⚠️  No data for exact date {event_date}. Closest: {closest}")
            event_rows = df_indicators[df_indicators.index == closest]
            event_dt = closest

        if not event_rows.empty:
            event_row = event_rows.iloc[0]
            # Find prior day for change calculation
            event_idx = list(df_indicators.index).index(event_dt)
            if event_idx > 0:
                prev_price = df_indicators.iloc[event_idx - 1]["close"]
                day_change = (event_row["close"] - prev_price) / prev_price * 100
            else:
                day_change = 0
            print(f"  Price on {event_dt}: ${event_row['close']:,.2f} (day change: {day_change:+.1f}%)")
            print(f"  RSI: {event_row['rsi_14']:.1f} | ADX: {event_row['adx']:.1f} | SMA-50: ${event_row['sma_50']:,.2f}")

        for config in configs:
            print(f"\n  ▸ {config['name']}:")

            # Run full backtest to get trade history
            trades = run_backtest(
                cg_id, asset["id"], days, dry_run=True,
                config=config, df_cached=df_raw, quiet=True
            )

            # Find trades that were OPEN on event_date
            open_on_date = []
            for t in trades:
                entry_d = t.get("entry_date", "")
                exit_d = t.get("exit_date") or "9999-12-31"
                direction = t.get("direction", "long")
                if direction == "trim":
                    continue  # skip trims, we want the parent trade

                try:
                    entry_dt = datetime.strptime(entry_d, "%Y-%m-%d").date()
                    exit_dt = datetime.strptime(exit_d, "%Y-%m-%d").date()
                except (ValueError, TypeError):
                    continue

                if entry_dt <= event_dt <= exit_dt:
                    open_on_date.append(t)

            if not open_on_date:
                print(f"    No positions open on {event_date}")
                continue

            for t in open_on_date:
                direction = t.get("direction", "long")
                entry_price = t["entry_price"]
                event_price = event_row["close"] if not event_rows.empty else 0

                if direction == "long":
                    unrealized_pnl = (event_price - entry_price) / entry_price * 100
                else:
                    unrealized_pnl = (entry_price - event_price) / entry_price * 100

                exit_d = t.get("exit_date") or "still open"
                exit_reason = t.get("exit_signal_reason", "n/a")
                final_pnl = t.get("pnl_pct", 0)
                final_usd = t.get("pnl_usd", 0)
                status = t.get("status", "?")

                # Days from event to exit
                if t.get("exit_date"):
                    try:
                        exit_dt = datetime.strptime(t["exit_date"], "%Y-%m-%d").date()
                        days_to_exit = (exit_dt - event_dt).days
                    except (ValueError, TypeError):
                        days_to_exit = "?"
                else:
                    days_to_exit = "still open"

                arrow = "LONG" if direction == "long" else "SHORT"
                emoji = "🛡️" if unrealized_pnl >= 0 else "🔥"

                print(f"    {emoji} {arrow} opened {t['entry_date']} @ ${entry_price:,.2f}")
                print(f"       Unrealized on {event_date}: {unrealized_pnl:+.1f}%")
                print(f"       Final exit: {exit_d} ({exit_reason}) → {final_pnl:+.1f}% ${final_usd:+,.0f}")
                print(f"       Days event→exit: {days_to_exit}")

            # Also show trims that happened BEFORE the event (reduced exposure)
            trims_before = [
                t for t in trades
                if t.get("direction") == "trim"
                and t.get("exit_date", "") <= str(event_dt)
            ]
            if trims_before:
                total_trimmed = sum(t.get("trim_pct", 0) for t in trims_before)
                trim_usd = sum(t.get("pnl_usd", 0) for t in trims_before)
                print(f"    🟡 Had trimmed {total_trimmed:.0f}% before event (locked in ${trim_usd:+,.0f})")

        if i < len(assets) - 1:
            print(f"\n  ⏳ Sleeping {CG_SLEEP_SECONDS}s...")
            time.sleep(CG_SLEEP_SECONDS)

    print(f"\n{'=' * 74}")


def main():
    parser = argparse.ArgumentParser(description="Vela Backtesting Engine")
    parser.add_argument("--asset", type=str, help="CoinGecko ID (e.g. 'bitcoin')")
    parser.add_argument("--days", type=int, default=730, help="Lookback period in days (default: 730)")
    parser.add_argument("--source", type=str, default="hyperliquid", choices=["hyperliquid", "coingecko"],
                        help="Data source (default: hyperliquid — real OHLCV, up to 5000 days)")
    parser.add_argument("--dry-run", action="store_true", help="Print trades without writing to Supabase")
    parser.add_argument("--compare", action="store_true", help="A/B test: current config vs improved config")
    parser.add_argument("--config-a", type=str, default=None,
                        help=f"Config A name for --compare (options: {', '.join(NAMED_CONFIGS.keys())})")
    parser.add_argument("--config-b", type=str, default=None,
                        help=f"Config B name for --compare (options: {', '.join(NAMED_CONFIGS.keys())})")
    parser.add_argument("--volatile", action="store_true",
                        help="Include volatile period analysis in --compare output")
    parser.add_argument("--notify", action="store_true",
                        help="Send Telegram/email notifications for signal changes")
    parser.add_argument("--stress-test", type=str, metavar="YYYY-MM-DD",
                        help="Analyze open positions on a specific date (black swan analysis)")
    parser.add_argument("--compound", action="store_true",
                        help="Run compounding capital simulation (single pool + per-asset pools)")
    parser.add_argument("--leverage", action="store_true",
                        help="Run leverage scenario comparison (spot vs tiered vs flat 2x)")
    parser.add_argument("--capital", type=float, default=1000.0,
                        help="Starting capital for compounding/leverage simulation (default: $1,000)")
    parser.add_argument("--clear", action="store_true",
                        help="Delete existing backtest trades before writing new ones")
    args = parser.parse_args()

    # Validate Supabase keys are available (deferred from module-level for testability)
    _require_supabase_keys()

    # ── Leverage simulation mode ──
    if args.leverage:
        assets = fetch_assets()
        if args.asset:
            asset = next((a for a in assets if a["coingecko_id"] == args.asset), None)
            if not asset:
                asset = {"id": "unknown", "symbol": args.asset.upper(), "coingecko_id": args.asset}
            assets = [asset]
        if not assets:
            print("  No assets found.")
            sys.exit(1)
        lev_config = NAMED_CONFIGS[args.config_a] if args.config_a and args.config_a in NAMED_CONFIGS else IMPROVED_CONFIG
        run_leverage_sim(assets, args.days, starting_capital=args.capital, config=lev_config, source=args.source)
        return

    # ── Compounding simulation mode ──
    if args.compound:
        assets = fetch_assets()
        if args.asset:
            asset = next((a for a in assets if a["coingecko_id"] == args.asset), None)
            if not asset:
                asset = {"id": "unknown", "symbol": args.asset.upper(), "coingecko_id": args.asset}
            assets = [asset]
        if not assets:
            print("  No assets found.")
            sys.exit(1)
        comp_config = NAMED_CONFIGS[args.config_a] if args.config_a and args.config_a in NAMED_CONFIGS else IMPROVED_CONFIG
        run_compounding_sim(assets, args.days, starting_capital=args.capital, config=comp_config, source=args.source)
        return

    # ── Stress test mode ──
    if args.stress_test:
        assets = fetch_assets()
        if args.asset:
            asset = next((a for a in assets if a["coingecko_id"] == args.asset), None)
            if not asset:
                asset = {"id": "unknown", "symbol": args.asset.upper(), "coingecko_id": args.asset}
            assets = [asset]
        if not assets:
            print("  No assets found.")
            sys.exit(1)
        run_stress_test(assets, args.days, args.stress_test, source=args.source)
        return

    # ── Compare mode ──
    if args.compare:
        assets = fetch_assets()
        if args.asset:
            asset = next((a for a in assets if a["coingecko_id"] == args.asset), None)
            if not asset:
                asset = {"id": "unknown", "symbol": args.asset.upper(), "coingecko_id": args.asset}
            assets = [asset]
        if not assets:
            print("  No assets found.")
            sys.exit(1)

        # Resolve config names
        ca = None
        cb = None
        if args.config_a:
            ca = NAMED_CONFIGS.get(args.config_a)
            if ca is None:
                print(f"  ❌ Unknown config-a: '{args.config_a}'. Options: {', '.join(NAMED_CONFIGS.keys())}")
                sys.exit(1)
        if args.config_b:
            cb = NAMED_CONFIGS.get(args.config_b)
            if cb is None:
                print(f"  ❌ Unknown config-b: '{args.config_b}'. Options: {', '.join(NAMED_CONFIGS.keys())}")
                sys.exit(1)

        run_comparison(assets, args.days, config_a=ca, config_b=cb, source=args.source)
        return

    # ── Standard mode ──
    print("=" * 60)
    print("  Vela Backtesting Engine v4 — Volume + ATR + BTC Filter + RSI BB")
    print(f"  Lookback: {args.days} days | Dry run: {args.dry_run}")
    cfg = IMPROVED_CONFIG
    print(f"  Signal config: {cfg['name']} | ADX >= {cfg['adx_threshold']}, "
          f"RSI long [{cfg['rsi_long_entry_min']}-{cfg['rsi_long_entry_max']}], "
          f"RSI short [{cfg['rsi_short_entry_min']}-{cfg['rsi_short_entry_max']}], "
          f"Stop-loss {cfg['stop_loss_pct']}%")
    print(f"  Yellow trims: RSI >= {cfg['rsi_yellow_threshold']} → trim {int(cfg['trim_pct_yellow']*100)}%, "
          f"RSI >= {cfg['rsi_orange_threshold']} → trim {int(cfg['trim_pct_orange']*100)}%")
    print(f"  RSI BB: {'ON' if cfg.get('rsi_bb_complementary') else 'OFF'} | "
          f"Volume: {'ON' if cfg.get('volume_confirm') else 'OFF'} | "
          f"ATR stop: {'ON' if cfg.get('atr_stop_loss') else 'OFF'}")
    print("=" * 60)

    # ── Clear existing backtest trades if requested ──
    if args.clear and not args.dry_run:
        assets_for_clear = fetch_assets()
        if args.asset:
            asset_match = next((a for a in assets_for_clear if a["coingecko_id"] == args.asset), None)
            if asset_match:
                clear_backtest_trades(asset_match["id"])
            else:
                print(f"  ⚠️  Asset '{args.asset}' not found — skipping clear")
        else:
            clear_backtest_trades()

    if args.asset:
        # Single asset mode — use provided CoinGecko ID
        assets = fetch_assets()
        asset = next((a for a in assets if a["coingecko_id"] == args.asset), None)
        if not asset:
            asset = {"id": "unknown", "symbol": args.asset.upper(), "coingecko_id": args.asset}
            if not args.dry_run:
                print(f"  ⚠️  Asset '{args.asset}' not found in Supabase. Use --dry-run or add it first.")
                sys.exit(1)

        run_backtest(asset["coingecko_id"], asset["id"], args.days, args.dry_run, source=args.source)
    else:
        # All enabled assets
        assets = fetch_assets()
        if not assets:
            print("  No enabled assets found in Supabase.")
            sys.exit(1)

        print(f"  Found {len(assets)} enabled assets: {', '.join(a['symbol'] for a in assets)}")

        all_trades = []
        for i, asset in enumerate(assets):
            print(f"\n{'─' * 60}")
            print(f"  [{i + 1}/{len(assets)}] {asset['symbol']} ({asset['coingecko_id']})")
            print(f"{'─' * 60}")

            try:
                trades = run_backtest(
                    asset["coingecko_id"], asset["id"], args.days, args.dry_run,
                    source=args.source,
                )
                all_trades.extend(trades)
            except Exception as e:
                print(f"  ❌ Error backtesting {asset['symbol']}: {e}")

            # Rate limit between assets (only needed for CoinGecko)
            if i < len(assets) - 1 and args.source == "coingecko":
                print(f"\n  ⏳ Sleeping {CG_SLEEP_SECONDS}s for CoinGecko rate limit...")
                time.sleep(CG_SLEEP_SECONDS)

        # Overall summary
        closed = [t for t in all_trades if t["status"] == "closed"]
        if closed:
            trims = [t for t in closed if t.get("direction") == "trim"]
            full_closes = [t for t in closed if t.get("direction") != "trim"]
            longs = [t for t in full_closes if t.get("direction") == "long"]
            shorts = [t for t in full_closes if t.get("direction") == "short"]
            long_wins = len([t for t in longs if t["pnl_pct"] >= 0])
            short_wins = len([t for t in shorts if t["pnl_pct"] >= 0])
            total_wins = long_wins + short_wins
            total_pnl_usd = sum(t.get("pnl_usd", 0) for t in closed)
            trim_pnl_usd = sum(t.get("pnl_usd", 0) for t in trims)
            print(f"\n{'=' * 60}")
            print(f"  OVERALL: {len(full_closes)} full trades | {total_wins}/{len(full_closes)} wins")
            print(f"    LONG:  {len(longs)} trades | {long_wins} wins")
            print(f"    SHORT: {len(shorts)} trades | {short_wins} wins")
            print(f"    TRIMS: {len(trims)} partial profit-takes")
            print(f"    USD P&L: ${total_pnl_usd:+,.0f} (trims: ${trim_pnl_usd:+,.0f}, closes: ${total_pnl_usd - trim_pnl_usd:+,.0f})")
            print(f"{'=' * 60}")

        # ── Notifications (only with --notify flag) ──
        if args.notify:
            _dispatch_notifications(assets, all_trades)


def _dispatch_notifications(
    assets: list[dict], all_trades: list[dict]
) -> None:
    """Send notifications for the latest signal per asset.

    Looks at the most recent trade for each asset and sends a notification
    if a trade was opened or closed today. Intended for scheduled runs
    (e.g., daily cron), not historical backtests.
    """
    from notify import notify_signal_change

    today = datetime.now().strftime("%Y-%m-%d")
    print(f"\n  [notify] Checking for today's signal changes ({today})...")

    for asset in assets:
        asset_trades = [t for t in all_trades if t.get("asset_id") == asset["id"]]
        if not asset_trades:
            continue

        # Find the most recent trade (by entry date)
        latest = max(asset_trades, key=lambda t: t.get("entry_date", ""))
        entry_date = latest.get("entry_date", "")

        # Only notify if the trade was opened today
        if entry_date.startswith(today):
            direction = latest.get("direction", "long")
            # Map trade direction to signal color
            if direction in ("long", "bb_long"):
                signal_color = "green"
            elif direction in ("short", "bb_short"):
                signal_color = "red"
            else:
                signal_color = "grey"

            headline = (
                f"{asset['symbol']} signal changed — "
                f"{'buying pressure building' if signal_color == 'green' else 'selling pressure increasing' if signal_color == 'red' else 'no clear direction'}"
            )
            price = latest.get("entry_price")
            notify_signal_change(
                asset_symbol=asset["symbol"],
                asset_id=asset["id"],
                signal_color=signal_color,
                headline=headline,
                price=price,
            )
        else:
            print(f"  [notify] {asset['symbol']}: no new signal today (latest entry: {entry_date})")


if __name__ == "__main__":
    main()
