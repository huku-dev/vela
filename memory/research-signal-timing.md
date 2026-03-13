# Signal Timing Research (2026-03-09)

## Overview
Research into whether shorter timeframe monitoring (30m) can improve entry and exit timing vs the current 4H evaluation cycle.

## Motivation
The 4H signal evaluation cycle can delay entries/exits by up to 3.5H. During fast price surges (like recent HYPE moves), we may miss the start of breakouts or trim too late after peaks.

## Backtest Scripts
- `scripts/momentum_detector_backtest.py` — Entry timing (momentum detector + BB2)
- `scripts/exit_timing_backtest.py` — Exit timing (30m RSI scanner for trims)

---

## Entry Timing: Momentum Detector (momentum_detector_backtest.py)

### Approach
30m scanner detects price acceleration (>1.5% in 2H) + volume confirmation (>1.1x SMA20) and triggers early 4H signal evaluation.

### Cross-Asset Results (1.5% price threshold)
| Asset | Baseline P&L | Momentum delta | BB2 delta | Total w/ both |
|-------|-------------|---------------|-----------|---------------|
| HYPE  | +$983       | +$57          | +$6       | +$1,046       |
| BTC   | +$59        | +$33          | +$72      | +$164         |
| ETH   | +$158       | +$148         | +$148     | +$454         |
| SOL   | +$278       | +$48          | +$40      | +$366         |

### Key Findings
- **Momentum detector: +$286 total across all assets** (positive on every asset)
- **BB2 fast-scan: +$266 total** (64-67% win rate consistently)
- Volume at breakout onset is typically 0.89x-1.18x (below average — price leads, volume follows)
- 1.5% price threshold outperforms 2.0% (16 vs 12 early entries)

---

## Exit Timing: 30m RSI Scanner (exit_timing_backtest.py)

### Approach
30m RSI scanner detects RSI crossing 78 (yellow) or 85 (orange) between 4H closes. Velocity filter: only fires when RSI velocity >= +10 pts/2H (empirically validated median at actual crossings).

### RSI Velocity Empirical Calibration
- +5 pts/2H: happens 51-55% of all bars (too noisy)
- +8 pts/2H: happens ~31% (better but still frequent)
- +10 pts/2H: median velocity at actual RSI 78 crossings — recommended threshold
- At actual 78 crossings: median prior velocity is 9-15 pts/2H

### Cross-Asset Results
| Asset | A: Baseline | B: Exit Only | C: Combined | B delta | C delta |
|-------|------------|-------------|-------------|---------|---------|
| HYPE  | +$983      | +$1,012     | +$1,026     | +$29    | +$43    |
| BTC   | +$59       | -$119       | +$63        | -$178   | +$3     |
| ETH   | +$158      | -$50        | +$179       | -$208   | +$21    |
| SOL   | +$278      | +$225       | +$376       | -$53    | +$99    |
| TOTAL |            |             |             | **-$410** | **+$166** |

### Key Findings
- **Exit scanner ALONE hurts performance: -$410** across all assets
- **Combined (momentum entries + exit scanner): +$166** — net positive
- **Why exit-only hurts:** Early trims fragment position size. Each trim reduces remaining exposure, so if the trend continues, you capture less of the move. The trade-off is "trim at 1% better price" vs "hold larger position for continued trend."
- **Trim P&L improves** (+$173 HYPE, +$147 ETH, +$100 SOL) — but position P&L drops more
- HYPE is the only asset where exit scanner is net positive standalone (+$29)

---

## Production Recommendations

### Build (clear positive signal)
1. **Momentum detector for entries** — +$286 across all assets
2. **BB2 30m scanner** — +$266, 64-67% WR, user explicitly requested this
3. **Combined system** (momentum entries + exit scanner together) — +$166

### Don't build (standalone)
4. **Exit scanner by itself** — -$410, counterproductive

### Open questions
- Should the exit scanner only trigger on orange (RSI >= 85) and skip yellow (78) on 30m? The yellow trims are the most damaging to position size
- Is there a trim frequency limiter that would help (e.g., max 1 early trim per position)?

---

## Data Limitations
- Hyperliquid provides ~104 days of 30m data (not full 365 days)
- Full 365 days available for 4H data
- Overlap period: ~Nov 2025 to Mar 2026 (~104 days) for 30m comparisons
- Results still valid for comparison since all strategies use the same data window
