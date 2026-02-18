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

if not SUPABASE_URL or not SUPABASE_KEY:
    sys.exit("ERROR: Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env")

COINGECKO_BASE = "https://api.coingecko.com/api/v3"

# CoinGecko free-tier rate limit: ~10-30 calls/min. We add a generous sleep.
CG_SLEEP_SECONDS = 6

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

    # BTC crash filter setup
    btc_crash_enabled = config.get("btc_crash_filter", False) and not is_btc and btc_df is not None
    btc_crash_threshold = config.get("btc_crash_threshold", -5.0)

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
                    # Don't open new position on crash day — skip to next bar
                    continue

        # Re-evaluate signal WITH open trade context (for stop-loss / trend-break)
        color, reason = evaluate_signal(
            row, open_trade=open_long, config=config, bar_index=bar_idx
        )

        # ── Yellow events: partial trim on open LONG positions ──

        if open_long is not None and long_remaining_frac > 0.1:
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

        if open_short is not None and short_remaining_frac > 0.1:
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
            open_long = None
            long_remaining_frac = 1.0

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
            open_short = None
            short_remaining_frac = 1.0

        # ── Open new positions ──

        if color == "green" and reason == "ema_cross_up" and open_long is None:
            open_long = {
                "direction": "long",
                "entry_date": str(date),
                "entry_price": round(price, 2),
                "entry_signal_color": "green",
                "entry_signal_reason": reason,
                "entry_indicators": _snapshot_indicators(row),
                "entry_bar_index": bar_idx,
            }
            long_remaining_frac = 1.0

        if color == "red" and reason == "ema_cross_down" and open_short is None:
            open_short = {
                "direction": "short",
                "entry_date": str(date),
                "entry_price": round(price, 2),
                "entry_signal_color": "red",
                "entry_signal_reason": reason,
                "entry_indicators": _snapshot_indicators(row),
                "entry_bar_index": bar_idx,
            }
            short_remaining_frac = 1.0

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

    # Separate trims, BB trades, and full EMA closes
    trims = [t for t in closed if t.get("direction") == "trim"]
    bb_trades = [t for t in closed if t.get("direction", "").startswith("bb_")]
    full_closes = [t for t in closed if t.get("direction") not in ("trim",) and not t.get("direction", "").startswith("bb_")]

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
    config: dict = SIGNAL_CONFIG,
    df_cached: pd.DataFrame | None = None,
    quiet: bool = False,
    btc_df: pd.DataFrame | None = None,
) -> list[dict]:
    """Run the full backtest pipeline for a single asset.

    Args:
        df_cached: Pre-fetched price DataFrame (avoids redundant API calls in compare mode)
        quiet: Suppress per-trade output (used in compare mode)
        btc_df: Pre-calculated BTC indicator DataFrame for crash detection on altcoins
    """
    is_btc = coingecko_id == "bitcoin"

    # 1. Fetch price data (or reuse cached)
    if df_cached is not None:
        df = df_cached.copy()
    else:
        df = fetch_historical_ohlc(coingecko_id, days)

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
    if not quiet:
        msg = f"  Generated {len(trades)} trades ({len(longs)} long, {len(shorts)} short, {len(trims)} trims"
        if bb_trades:
            msg += f", {len(bb_trades)} BB complementary"
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
    full_closes = [t for t in closed if t.get("direction") not in ("trim",) and not t.get("direction", "").startswith("bb_")]
    longs = [t for t in full_closes if t.get("direction") == "long"]
    shorts = [t for t in full_closes if t.get("direction") == "short"]

    long_wins = [t for t in longs if t["pnl_pct"] >= 0]
    short_wins = [t for t in shorts if t["pnl_pct"] >= 0]
    bb_wins = [t for t in bb_trades if t["pnl_pct"] >= 0]

    total_pnl_usd = sum(t.get("pnl_usd", 0) for t in closed)
    trim_pnl_usd = sum(t.get("pnl_usd", 0) for t in trims)
    bb_pnl_usd = sum(t.get("pnl_usd", 0) for t in bb_trades)
    open_pnl_usd = sum(t.get("pnl_usd", 0) for t in opens)

    # Win rate includes EMA trades only (BB trades are supplementary)
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

    # Total trade count (for frequency analysis)
    total_signals = len(full_closes) + len(bb_trades)

    return {
        "full_trades": len(full_closes),
        "trims": len(trims),
        "bb_trades": len(bb_trades),
        "bb_wins": len(bb_wins),
        "bb_pnl_usd": bb_pnl_usd,
        "open_trades": len(opens),
        "longs": len(longs),
        "shorts": len(shorts),
        "long_wins": len(long_wins),
        "short_wins": len(short_wins),
        "win_rate": win_rate,
        "total_pnl_usd": total_pnl_usd,
        "trim_pnl_usd": trim_pnl_usd,
        "close_pnl_usd": total_pnl_usd - trim_pnl_usd - bb_pnl_usd,
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
        ("Total signals", f"{metrics_a.get('total_signals', 0)}", f"{metrics_b.get('total_signals', 0)}",
         delta(metrics_a.get("total_signals", 0), metrics_b.get("total_signals", 0), "+.0f")),
        ("Win rate (EMA)", f"{metrics_a['win_rate']:.0f}%", f"{metrics_b['win_rate']:.0f}%",
         delta(metrics_a["win_rate"], metrics_b["win_rate"], "+.0f")),
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
                if direction == "trim" or direction.startswith("bb_"):
                    continue  # skip trims and BB trades for circuit breaker calc

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


def run_comparison(assets: list[dict], days: int) -> None:
    """Run A/B comparison: current config vs improved config on same price data."""
    config_a = SIGNAL_CONFIG
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
            btc_raw = fetch_historical_ohlc("bitcoin", days)
            btc_df_for_crash = calculate_indicators(btc_raw, config=config_a)
            print(f"  BTC data ready ({len(btc_df_for_crash)} rows)")
            time.sleep(CG_SLEEP_SECONDS)
        else:
            # Fetch BTC separately for the crash filter
            print(f"\n  Pre-fetching BTC data for crash filter (BTC not in asset list)...")
            btc_raw = fetch_historical_ohlc("bitcoin", days)
            btc_df_for_crash = calculate_indicators(btc_raw, config=config_a)
            print(f"  BTC data ready ({len(btc_df_for_crash)} rows)")
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
        df_raw = fetch_historical_ohlc(cg_id, days)

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

        # Rate limit
        if i < len(assets) - 1:
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
            print(f"    🟡 TRIM   {t['exit_date']}  {t['pnl_pct']:+.1f}% ${t.get('pnl_usd',0):+,.0f}  (trimmed {trim_pct:.0f}%)")
        elif direction.startswith("bb_"):
            bb_dir = "BB↑" if direction == "bb_long" else "BB↓"
            emoji = "🔵" if t["pnl_pct"] >= 0 else "🔴"
            reason = t.get("exit_signal_reason", "")
            print(f"    {emoji} {bb_dir:5s} {t['entry_date']} → {t['exit_date']}  {t['pnl_pct']:+.1f}% ${t.get('pnl_usd',0):+,.0f}  ({reason})")
        else:
            arrow = "LONG " if direction == "long" else "SHORT"
            emoji = "✅" if t["pnl_pct"] >= 0 else "❌"
            reason = t.get("exit_signal_reason", "")
            remaining = t.get("remaining_pct")
            rem = f" [{remaining:.0f}%rem]" if remaining is not None and remaining < 100 else ""
            print(f"    {emoji} {arrow} {t['entry_date']} → {t['exit_date']}  {t['pnl_pct']:+.1f}% ${t.get('pnl_usd',0):+,.0f}  ({reason}){rem}")

    for t in opens:
        direction = t.get("direction", "long")
        if direction.startswith("bb_"):
            bb_dir = "BB↑" if direction == "bb_long" else "BB↓"
            emoji = "📈" if t["pnl_pct"] >= 0 else "📉"
            print(f"    {emoji} {bb_dir:5s} {t['entry_date']} → now       {t['pnl_pct']:+.1f}% ${t.get('pnl_usd',0):+,.0f}  (open)")
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
    }
    total_full = agg["full_trades"]
    agg["win_rate"] = (
        (agg["long_wins"] + agg["short_wins"]) / total_full * 100
        if total_full > 0
        else 0
    )
    durations = [m["avg_duration_days"] for m in metrics_list if m["full_trades"] > 0]
    agg["avg_duration_days"] = sum(durations) / len(durations) if durations else 0
    return agg


# ---------------------------------------------------------------------------
# Stress test: black swan event analysis
# ---------------------------------------------------------------------------


def run_stress_test(assets: list[dict], days: int, event_date: str) -> None:
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

        df_raw = fetch_historical_ohlc(cg_id, days)

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
    parser.add_argument("--days", type=int, default=180, help="Lookback period in days (default: 180)")
    parser.add_argument("--dry-run", action="store_true", help="Print trades without writing to Supabase")
    parser.add_argument("--compare", action="store_true", help="A/B test: current config vs improved config")
    parser.add_argument("--stress-test", type=str, metavar="YYYY-MM-DD",
                        help="Analyze open positions on a specific date (black swan analysis)")
    args = parser.parse_args()

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
        run_stress_test(assets, args.days, args.stress_test)
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
        run_comparison(assets, args.days)
        return

    # ── Standard mode ──
    print("=" * 60)
    print("  Vela Backtesting Engine v4 — Volume + ATR + BTC Filter + RSI BB")
    print(f"  Lookback: {args.days} days | Dry run: {args.dry_run}")
    print(f"  Signal config: ADX >= {SIGNAL_CONFIG['adx_threshold']}, "
          f"RSI long [{SIGNAL_CONFIG['rsi_long_entry_min']}-{SIGNAL_CONFIG['rsi_long_entry_max']}], "
          f"RSI short [{SIGNAL_CONFIG['rsi_short_entry_min']}-{SIGNAL_CONFIG['rsi_short_entry_max']}], "
          f"Stop-loss {SIGNAL_CONFIG['stop_loss_pct']}%")
    print(f"  Yellow trims: RSI >= {SIGNAL_CONFIG['rsi_yellow_threshold']} → trim {int(SIGNAL_CONFIG['trim_pct_yellow']*100)}%, "
          f"RSI >= {SIGNAL_CONFIG['rsi_orange_threshold']} → trim {int(SIGNAL_CONFIG['trim_pct_orange']*100)}%")
    print("=" * 60)

    if args.asset:
        # Single asset mode — use provided CoinGecko ID
        assets = fetch_assets()
        asset = next((a for a in assets if a["coingecko_id"] == args.asset), None)
        if not asset:
            asset = {"id": "unknown", "symbol": args.asset.upper(), "coingecko_id": args.asset}
            if not args.dry_run:
                print(f"  ⚠️  Asset '{args.asset}' not found in Supabase. Use --dry-run or add it first.")
                sys.exit(1)

        run_backtest(asset["coingecko_id"], asset["id"], args.days, args.dry_run)
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
                    asset["coingecko_id"], asset["id"], args.days, args.dry_run
                )
                all_trades.extend(trades)
            except Exception as e:
                print(f"  ❌ Error backtesting {asset['symbol']}: {e}")

            # Rate limit between assets
            if i < len(assets) - 1:
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


if __name__ == "__main__":
    main()
