# P&L Model Rerun Results (2026-03-05)

## Context

Changed win/loss classification from **close-only P&L** to **position-level P&L** (close P&L + trim P&L). A "win" is now defined as total position P&L >= 0. This properly credits profitable trims that lower cost basis.

---

## V6D Baseline (Production Config)

| Asset | Positions | Win Rate | Total P&L | From Trims | From Closes |
|-------|-----------|----------|-----------|------------|-------------|
| BTC | 16 | 62% | +$299 | +$45 | +$254 |
| ETH | 11 | 45% | -$203 | +$16 | -$219 |
| HYPE | 5 | 60% | +$337 | +$111 | +$226 |
| SOL | 9 | 56% | -$234 | +$19 | -$254 |
| **TOTAL** | **41** | **56%** | **+$199** | **+$192** | **+$7** |

Key insight: $192 of the $199 total P&L came from trims. Without trims, close-only P&L was only +$7. This confirms the old model dramatically understated performance for positions that trimmed profitably before closing at a loss.

---

## V6D vs Enhanced v3

| Metric | V6D | Enhanced v3 | Delta |
|--------|-----|-------------|-------|
| Positions | 41 | 34 | -7 |
| Win rate | 56% | 18% | -38pp |
| Total P&L | +$199 | -$1,077 | -$1,276 |
| From trims | +$192 | +$311 | +$119 |
| Avg position P&L | +$5 | -$32 | -$37 |

**Verdict: V6D remains clearly superior.** Enhanced v3 generates more trim P&L but far worse close P&L.

---

## Late Entry Sweep (Position-Level)

### Aggregate Comparison (All Assets)

| Config | Positions | Win% | Total P&L | Late-Only # | Late Win% | Late P&L |
|--------|-----------|------|-----------|-------------|-----------|----------|
| Baseline (no late entry) | 41 | 56% | +$199 | n/a | n/a | n/a |
| 1-bar (4H) | 54 | 54% | -$193 | 15 | 47% | -$487 |
| 2-bar (8H) | 63 | 54% | -$13 | 24 | 50% | -$299 |
| 3-bar (12H) | 69 | 52% | +$125 | 30 | 47% | -$161 |
| **6-bar (24H)** | **92** | **54%** | **+$950** | **53** | **53%** | **+$685** |

### SOL Breakdown (Best Performer for Late Entry)

| Config | Positions | Win% | Total P&L | Trims | Closes |
|--------|-----------|------|-----------|-------|--------|
| Baseline | 9 | 56% | -$234 | +$19 | -$226 |
| 6-bar | 26 | 65% | +$363 | +$147 | +$265 |

### Key Finding

The 6-bar (24H) late entry config is **dramatically better** under position-level P&L:
- +$950 total vs +$199 baseline (+$751 improvement)
- 92 positions vs 41 (2.2x more trade activity)
- 54% win rate (only 2pp below baseline)
- Late-entry-only trades: 53 additional, 53% win rate, +$685 net contribution

**Under the old close-only model, this config appeared marginal. Under the corrected model, it's the clear best performer.** The high trim activity on late-entry trades was being ignored, making them look worse than they actually were.

---

## Previously-Rejected Configs vs V6D Baseline

All configs compared against V6D (41 positions, 56% win rate, +$199 P&L) over 730 days across BTC/ETH/HYPE/SOL.

### V5 Series (Trade Velocity)

| Config | Positions | Win Rate | Closed P&L | Trim P&L | Net Assessment |
|--------|-----------|----------|------------|----------|----------------|
| V5A Ladder | 33 | 18% | -$899 | +$659 | Still rejected |
| V5B Pullback | 33 | 18% | -$1,510 | +$311 | Still rejected |
| V5C DCA | 33 | 12% | -$1,212 | +$293 | Still rejected |
| V5F Full Suite | 33 | 18% | -$1,243 | +$659 | Still rejected |
| V5H Ladder+DCA | 33 | 18% | -$972 | +$598 | Still rejected |

### V4 Series (Entry Gates)

| Config | Positions | Win Rate | Closed P&L | Trim P&L | Net Assessment |
|--------|-----------|----------|------------|----------|----------------|
| V4 Confirmation | 33 | 9% | -$1,935 | +$302 | Still rejected |
| V4 RSI Velocity | 33 | 18% | -$1,154 | +$311 | Still rejected |
| V4 Combined | 33 | 9% | -$1,935 | +$302 | Still rejected |

### V6 Series (Exit Strategies)

| Config | Positions | Win Rate | Closed P&L | Trim P&L | Net Assessment |
|--------|-----------|----------|------------|----------|----------------|
| V6B Aggressive Ladder | 33 | 27% | -$229 | +$1,314 | Closest competitor, still worse |
| V6C Combined | 37 | 43% | -$261 | +$754 | Second closest, still worse |

### Analysis

**None of the rejected configs become viable under the corrected P&L model.** The core thesis holds:
- V6D's edge is on the **exit side** (trailing stop both-directions)
- Alternative configs generate more trim P&L but destroy close P&L
- V4 entry gates are the worst performers (9% win rate) — stricter entry doesn't help
- V6B Aggressive Ladder is interesting: +$1,314 in trim P&L (best of all), but -$229 close P&L negates it
- All V5 configs produce fewer positions (33 vs 41) AND worse P&L — lose on both axes

**The overly-conservative hypothesis was wrong.** The rejected configs were correctly rejected — they genuinely underperform, not just from measurement error.

---

## Strategic Recommendations

1. **V6D remains the production baseline.** No config change needed.

2. **Late entry 6-bar (24H) deserves serious consideration.** Under corrected P&L:
   - 2.2x more positions
   - +$950 total P&L (vs +$199 baseline)
   - Only 2pp win rate drop
   - This should be investigated further as a production enhancement

3. **Exit-side optimization remains the highest-leverage area.** V6D's trailing stop is the key differentiator. Future research should focus on adaptive trailing stop widths, not entry filtering.

4. **Marketing numbers should use V6D baseline:** 41 positions, 56% win rate, +$199 on $1K positions.
