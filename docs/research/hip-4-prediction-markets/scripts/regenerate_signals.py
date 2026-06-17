"""
Regenerate Vela V7-EMA signals over 12-month window with PROD_ACTUAL exit rules.

Faithful Python replica of crypto-agent/scripts/backtest-realistic.ts §runEmaSim
for the EMA strategy, simplified to the 9/21 pair (production default).

Output: per-trade CSV with entry timestamp, asset, side, entry price, exit
reason, ladder hits, gross/fees/net PnL pct, MFE/MAE.

Usage:
    python3 regenerate_signals.py --asset BTC --days 365
"""

import argparse
import csv
import json
import sys
from pathlib import Path

import requests

DATA_DIR = Path(__file__).parent.parent / "data"
HL_INFO = "https://api.hyperliquid.xyz/info"

# Config from PROD_ACTUAL
LEVERAGE = 1
FEE_PER_FILL_PCT = 0.095
LADDER_LEVELS_PCT = [15.0, 25.0, 35.0]
LADDER_FRACTIONS = [0.10, 0.10, 0.10]
EQUITY_STOP_PCT = 8.0
TRAIL_CRYPTO = (5.0, 2.5)   # activation, trail
TRAIL_NON = (3.0, 1.5)
RSI_PERIOD = 14
SMA50_PERIOD = 50
ADX_THRESHOLD = 20
RSI_LONG_MIN, RSI_LONG_MAX = 40, 70
RSI_SHORT_MIN, RSI_SHORT_MAX = 30, 60
EMA_FAST, EMA_SLOW = 9, 21
COOLDOWN_HOURS = 24

# BB2 config
BB2_RSI_PERIOD = 10
BB2_MULT = 1.5
BB2_STOP_PCT = 1.5
BB2_HOLD_HOURS = 48
BB2_DEDUP_HOURS = 12


def post_json(payload):
    r = requests.post(HL_INFO, json=payload, timeout=30)
    r.raise_for_status()
    return r.json()


def fetch_candles(coin: str, interval: str, days: int):
    import time
    end = int(time.time() * 1000)
    start = end - days * 24 * 3600 * 1000
    out = []
    cur = start
    while cur < end:
        chunk_end = min(cur + 5000 * 60 * 60 * 1000, end)
        payload = {
            "type": "candleSnapshot",
            "req": {"coin": coin, "interval": interval, "startTime": cur, "endTime": chunk_end},
        }
        page = post_json(payload)
        if not page:
            break
        out.extend(page)
        cur = chunk_end + 1
    seen = set()
    deduped = []
    for c in out:
        if c["t"] in seen:
            continue
        seen.add(c["t"])
        deduped.append({
            "ts": int(c["t"]),
            "open": float(c["o"]),
            "high": float(c["h"]),
            "low": float(c["l"]),
            "close": float(c["c"]),
            "volume": float(c.get("v") or 0),
        })
    deduped.sort(key=lambda x: x["ts"])
    return deduped


def ema_series(closes, period):
    out = [None] * len(closes)
    if len(closes) < period:
        return out
    alpha = 2.0 / (period + 1)
    sma = sum(closes[:period]) / period
    out[period - 1] = sma
    for i in range(period, len(closes)):
        out[i] = alpha * closes[i] + (1 - alpha) * out[i - 1]
    return out


def rsi_series(closes, period=RSI_PERIOD):
    out = [None] * len(closes)
    if len(closes) <= period:
        return out
    gains, losses = [], []
    for i in range(1, period + 1):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0))
        losses.append(max(-d, 0))
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    if avg_loss == 0:
        out[period] = 100
    else:
        rs = avg_gain / avg_loss
        out[period] = 100 - 100 / (1 + rs)
    for i in range(period + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        g = max(d, 0)
        l_ = max(-d, 0)
        avg_gain = (avg_gain * (period - 1) + g) / period
        avg_loss = (avg_loss * (period - 1) + l_) / period
        if avg_loss == 0:
            out[i] = 100
        else:
            rs = avg_gain / avg_loss
            out[i] = 100 - 100 / (1 + rs)
    return out


def adx_series(candles, period=14):
    n = len(candles)
    out = [None] * n
    if n < period * 2:
        return out
    tr_list, plus_dm_list, minus_dm_list = [], [], []
    for i in range(1, n):
        high, low, prev_close = candles[i]["high"], candles[i]["low"], candles[i - 1]["close"]
        tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
        up = candles[i]["high"] - candles[i - 1]["high"]
        dn = candles[i - 1]["low"] - candles[i]["low"]
        plus_dm = up if (up > dn and up > 0) else 0
        minus_dm = dn if (dn > up and dn > 0) else 0
        tr_list.append(tr)
        plus_dm_list.append(plus_dm)
        minus_dm_list.append(minus_dm)
    if len(tr_list) < period:
        return out
    atr = sum(tr_list[:period]) / period
    plus_dm_smooth = sum(plus_dm_list[:period]) / period
    minus_dm_smooth = sum(minus_dm_list[:period]) / period
    dx_list = []
    plus_di = 100 * plus_dm_smooth / atr if atr else 0
    minus_di = 100 * minus_dm_smooth / atr if atr else 0
    if (plus_di + minus_di) > 0:
        dx_list.append(100 * abs(plus_di - minus_di) / (plus_di + minus_di))
    for i in range(period, len(tr_list)):
        atr = (atr * (period - 1) + tr_list[i]) / period
        plus_dm_smooth = (plus_dm_smooth * (period - 1) + plus_dm_list[i]) / period
        minus_dm_smooth = (minus_dm_smooth * (period - 1) + minus_dm_list[i]) / period
        plus_di = 100 * plus_dm_smooth / atr if atr else 0
        minus_di = 100 * minus_dm_smooth / atr if atr else 0
        if (plus_di + minus_di) > 0:
            dx = 100 * abs(plus_di - minus_di) / (plus_di + minus_di)
            dx_list.append(dx)
            if len(dx_list) >= period:
                adx = sum(dx_list[-period:]) / period
                out[i + 1] = adx
    return out


def sma_series(closes, period):
    out = [None] * len(closes)
    if len(closes) < period:
        return out
    s = sum(closes[:period])
    out[period - 1] = s / period
    for i in range(period, len(closes)):
        s += closes[i] - closes[i - period]
        out[i] = s / period
    return out


def daily_sma50_at(daily_candles, ts_ms):
    """Return the most recent daily SMA50 with close_time < ts_ms."""
    closes = [c["close"] for c in daily_candles]
    sma = sma_series(closes, SMA50_PERIOD)
    last = None
    for i, c in enumerate(daily_candles):
        if c["ts"] >= ts_ms:
            break
        if sma[i] is not None:
            last = sma[i]
    return last


def run_ema_sim(candles_4h, daily, asset_class):
    closes = [c["close"] for c in candles_4h]
    ef = ema_series(closes, EMA_FAST)
    es = ema_series(closes, EMA_SLOW)
    rsi = rsi_series(closes)
    adx = adx_series(candles_4h)
    trail = TRAIL_CRYPTO if asset_class == "crypto" else TRAIL_NON
    trades = []
    last_entry = {}
    start_bar = max(EMA_SLOW + 5, 30)

    for i in range(start_bar, len(candles_4h)):
        f, s, pf, ps = ef[i], es[i], ef[i - 1], es[i - 1]
        r, a = rsi[i], adx[i]
        if any(x is None for x in (f, s, pf, ps, r, a)):
            continue
        candle = candles_4h[i]
        price = candle["close"]
        s50 = daily_sma50_at(daily, candle["ts"])
        if s50 is None:
            continue

        side = None
        if pf <= ps and f > s and a >= ADX_THRESHOLD and RSI_LONG_MIN <= r <= RSI_LONG_MAX and price > s50:
            side = "long"
        elif pf >= ps and f < s and a >= ADX_THRESHOLD and RSI_SHORT_MIN <= r <= RSI_SHORT_MAX and price < s50:
            side = "short"
        if side is None:
            continue

        # Cooldown
        if side in last_entry and candle["ts"] - last_entry[side] < COOLDOWN_HOURS * 3600 * 1000:
            continue

        # Forward simulation
        ladder_hit = 0
        realised_gross = 0.0
        ladder_fills = []
        max_adv = 0.0
        max_fav = 0.0
        peak = 0.0
        exit_reason = "expiry"
        exit_pnl_pct = 0.0
        remaining = 1.0
        exited = False
        last_pnl_close = 0.0

        for j in range(i + 1, len(candles_4h)):
            c = candles_4h[j]
            ap = c["low"] if side == "long" else c["high"]
            fp = c["high"] if side == "long" else c["low"]
            adv_pct = ((price - ap) / price) * 100 if side == "long" else ((ap - price) / price) * 100
            fav_pct = ((fp - price) / price) * 100 if side == "long" else ((price - fp) / price) * 100
            max_adv = max(max_adv, adv_pct)
            max_fav = max(max_fav, fav_pct)

            while ladder_hit < len(LADDER_LEVELS_PCT) and max_fav >= LADDER_LEVELS_PCT[ladder_hit]:
                frac = LADDER_FRACTIONS[ladder_hit]
                pct = LADDER_LEVELS_PCT[ladder_hit]
                realised_gross += frac * pct
                remaining -= frac
                ladder_fills.append(pct)
                ladder_hit += 1

            if adv_pct >= EQUITY_STOP_PCT:
                exit_reason = "stop_loss"
                exit_pnl_pct = -EQUITY_STOP_PCT
                exited = True
                break

            pnl_close = ((c["close"] - price) / price) * 100 if side == "long" else ((price - c["close"]) / price) * 100
            last_pnl_close = pnl_close
            peak = max(peak, pnl_close)
            if peak >= trail[0] and (peak - pnl_close) >= trail[1]:
                exit_reason = "trailing_stop"
                exit_pnl_pct = pnl_close
                exited = True
                break

            cf, cs = ef[j], es[j]
            if cf is not None and cs is not None and ((side == "long" and cf < cs) or (side == "short" and cf > cs)):
                exit_reason = "signal_flip"
                exit_pnl_pct = pnl_close
                exited = True
                break

        if not exited:
            exit_reason = "unclosed"
            exit_pnl_pct = last_pnl_close

        gross_pnl = realised_gross + remaining * exit_pnl_pct
        fills = 1 + len(ladder_fills) + 1
        fees = fills * FEE_PER_FILL_PCT
        net_pnl = gross_pnl - fees

        trades.append({
            "asset": "",
            "side": side,
            "ts": candle["ts"],
            "entry_price": price,
            "exit_reason": exit_reason,
            "ladder_hits": ladder_hit,
            "gross_pnl_pct": gross_pnl,
            "fees": fees,
            "net_pnl_pct": net_pnl,
            "mfe_pct": max_fav,
            "mae_pct": max_adv,
            "fills": fills,
        })
        last_entry[side] = candle["ts"]

    return trades


def bb_rsi_series(rsi_vals, period, mult):
    """Bollinger bands of RSI: returns list of (upper, lower) or None per index."""
    out = [None] * len(rsi_vals)
    for i in range(len(rsi_vals)):
        if i < period - 1:
            continue
        window = rsi_vals[i - period + 1: i + 1]
        if any(v is None for v in window):
            continue
        m = sum(window) / period
        var = sum((v - m) ** 2 for v in window) / period
        sd = var ** 0.5
        out[i] = (m + mult * sd, m - mult * sd)
    return out


def run_bb2_sim(candles_4h, daily, asset_class):
    closes = [c["close"] for c in candles_4h]
    rsi = rsi_series(closes)
    bb = bb_rsi_series(rsi, BB2_RSI_PERIOD, BB2_MULT)

    trades = []
    last_entry = {}
    bar_ms = 4 * 3600 * 1000

    for i in range(30, len(candles_4h)):
        r = rsi[i]
        b = bb[i]
        if r is None or b is None:
            continue
        candle = candles_4h[i]
        price = candle["close"]
        s50 = daily_sma50_at(daily, candle["ts"])
        if s50 is None:
            continue

        side = None
        if r < b[1] and price > s50:
            side = "long"
        elif r > b[0] and price < s50:
            side = "short"
        if side is None:
            continue

        # Dedup 12h
        if side in last_entry and candle["ts"] - last_entry[side] < BB2_DEDUP_HOURS * 3600 * 1000:
            continue

        # Forward sim
        max_adv = 0.0
        max_fav = 0.0
        exit_reason = "expiry"
        exit_pnl_pct = 0.0

        for j in range(i + 1, len(candles_4h)):
            c = candles_4h[j]
            elapsed_ms = c["ts"] - candle["ts"]
            ap = c["low"] if side == "long" else c["high"]
            fp = c["high"] if side == "long" else c["low"]
            adv_pct = ((price - ap) / price) * 100 if side == "long" else ((ap - price) / price) * 100
            fav_pct = ((fp - price) / price) * 100 if side == "long" else ((price - fp) / price) * 100
            max_adv = max(max_adv, adv_pct)
            max_fav = max(max_fav, fav_pct)

            if adv_pct >= BB2_STOP_PCT:
                exit_reason = "stop_loss"
                exit_pnl_pct = -BB2_STOP_PCT
                break

            pnl_close = ((c["close"] - price) / price) * 100 if side == "long" else ((price - c["close"]) / price) * 100
            jr = rsi[j]
            if jr is not None and ((side == "long" and jr > 50) or (side == "short" and jr < 50)):
                exit_reason = "rsi_target"
                exit_pnl_pct = pnl_close
                break
            if elapsed_ms >= BB2_HOLD_HOURS * 3600 * 1000:
                exit_reason = "expiry"
                exit_pnl_pct = pnl_close
                break

        gross = exit_pnl_pct
        fees = 2 * FEE_PER_FILL_PCT
        net = gross - fees

        trades.append({
            "asset": "",
            "side": side,
            "ts": candle["ts"],
            "entry_price": price,
            "exit_reason": exit_reason,
            "ladder_hits": 0,
            "gross_pnl_pct": gross,
            "fees": fees,
            "net_pnl_pct": net,
            "mfe_pct": max_fav,
            "mae_pct": max_adv,
            "fills": 2,
            "strategy": "BB2",
        })
        last_entry[side] = candle["ts"]
    return trades


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset", required=True, help="HL coin symbol e.g. BTC, ETH")
    parser.add_argument("--asset-class", default="crypto")
    parser.add_argument("--days", type=int, default=365)
    parser.add_argument("--strategy", default="V7", choices=["V7", "BB2", "BOTH"])
    args = parser.parse_args()

    DATA_DIR.mkdir(exist_ok=True)
    print(f"fetching {args.asset} 4H + 1D candles {args.days}d", file=sys.stderr)
    candles_4h = fetch_candles(args.asset, "4h", args.days)
    daily = fetch_candles(args.asset, "1d", args.days + 60)
    print(f"  4H: {len(candles_4h)}, 1D: {len(daily)}", file=sys.stderr)

    trades = []
    if args.strategy in ("V7", "BOTH"):
        v7 = run_ema_sim(candles_4h, daily, args.asset_class)
        for t in v7:
            t["asset"] = args.asset
            t.setdefault("strategy", "V7")
        trades.extend(v7)
        print(f"  V7 trades: {len(v7)}", file=sys.stderr)
    if args.strategy in ("BB2", "BOTH"):
        bb = run_bb2_sim(candles_4h, daily, args.asset_class)
        for t in bb:
            t["asset"] = args.asset
        trades.extend(bb)
        print(f"  BB2 trades: {len(bb)}", file=sys.stderr)

    print(f"  total: {len(trades)}", file=sys.stderr)
    if trades:
        wins = sum(1 for t in trades if t["net_pnl_pct"] > 0)
        avg = sum(t["net_pnl_pct"] for t in trades) / len(trades)
        print(f"  win rate={wins/len(trades):.3f}  avg net pnl={avg:+.3f}%", file=sys.stderr)

    suffix = args.strategy.lower()
    out_path = DATA_DIR / f"signals_{args.asset}_{suffix}_{args.days}d.csv"
    with out_path.open("w", newline="") as f:
        if trades:
            w = csv.DictWriter(f, fieldnames=list(trades[0].keys()))
            w.writeheader()
            w.writerows(trades)
    print(f"wrote {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
