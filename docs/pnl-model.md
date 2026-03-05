# Position-Level P&L Model

> **Changed:** 2026-03-05 (pre-launch, no user impact)
> **Previous model:** Close-only P&L stored in `closed_pnl` column

---

## 1. Position Definition

A **position** is a complete trading lifecycle:

```
1 Entry + N Trims + 1 Close = 1 Position
```

- **Entry:** Opening a long or short position (e.g., LONG BTC at $45,000 with $1,000)
- **Trim:** Partial profit-taking during the trade (e.g., sell 10% at +15% profit)
- **Close:** Final exit of the remaining position

Trims are NOT separate trades. They are position management events grouped with their parent.

---

## 2. P&L Calculation

### Total Position P&L

```
Total P&L = Close P&L (dollars) + Sum of Trim P&Ls (dollars)
```

### Trim P&L (per trim)

```
trim_dollar_pnl = (trim.pnl_pct / 100) * (trim.trim_pct / 100) * position_size
```

Where:
- `pnl_pct` = percentage price change from entry to trim exit
- `trim_pct` = percentage of original position trimmed (e.g., 10%)
- `position_size` = original dollar position size (e.g., $1,000)

### Close P&L

```
remaining_fraction = 1.0 - sum(trim.trim_pct / 100)
close_dollar_pnl = (parent.pnl_pct / 100) * remaining_fraction * position_size
```

### Total

```
total_dollar_pnl = close_dollar_pnl + sum(trim_dollar_pnl)
total_pnl_pct = total_dollar_pnl / position_size * 100
```

---

## 3. Win/Loss Classification

```
Win  = total_dollar_pnl >= 0
Loss = total_dollar_pnl < 0
```

A position that trimmed +$100 profit but closed at -$20 is a **WIN** (+$80 total).

---

## 4. Cost Basis Model

Each trim reduces the user's remaining exposure:

```
cost_basis_pct = 100% - cumulative_trim_pct
```

Example with two 10% trims:
- After trim 1: cost basis = 90% ($900 of original $1,000)
- After trim 2: cost basis = 80% ($800 remaining)
- Close: exits the remaining 80%

**Negative cost basis** = "house money." If trims have already locked in more profit than the original investment, the remaining position is playing with profits only.

---

## 5. Worked Example

**ETH LONG, $1,000 position, entry at $3,000:**

| Event | Price | Action | P&L | Running Cost Basis |
|-------|-------|--------|-----|--------------------|
| Entry | $3,000 | Open $1,000 LONG | — | 100% ($1,000) |
| Trim 1 | $3,450 | Sell 10% (+15%) | +$15 | 90% ($900) |
| Trim 2 | $3,750 | Sell 10% (+25%) | +$25 | 80% ($800) |
| Close | $2,940 | Exit 80% (-2%) | -$16 | 0% |

**Total P&L:** +$15 + $25 - $16 = **+$24 (WIN)**

Under the old close-only model, this would have been classified as a **LOSS** (-$16 close P&L), completely ignoring the +$40 in trim profits.

---

## 6. Production Database Columns

### `positions` table

| Column | Type | Description |
|--------|------|-------------|
| `total_pnl` | numeric | Close P&L + Trim P&L (total position P&L in USD) |
| `trim_pnl` | numeric | Trim contribution only (for transparency) |
| `closed_pnl_pct` | numeric | Close-only percentage (entry to exit price). Used for price display on trade cards, NOT for win/loss. |
| `closed_pnl_exchange` | numeric | Exchange-reported P&L. Different concept entirely (includes funding, fees). |

### `trade_postmortems` table

Same columns: `total_pnl`, `trim_pnl`.

---

## 7. Code Locations

### Backend (Deno/Supabase)

- **`_shared/pnl-utils.ts`** — `computeTrimPnl()`: Computes total trim P&L from `trim_history` array
- **`position-monitor/index.ts`** — 6 close paths, each calls `computeTrimPnl()` and writes `total_pnl` + `trim_pnl`
- **`_shared/trade-executor.ts`** — Signal-red close path, same pattern
- **`_shared/postmortem.ts`** — Writes `total_pnl` and `trim_pnl` to postmortem record

### Frontend (React/TypeScript)

- **`utils/calculations.ts`** — `computePositionPnl()` and `aggregatePositionStats()`
- **`pages/TrackRecord.tsx`** — Stats use position-level aggregation; trade cards show total P&L with trim timeline

### Backtest (Python)

- **`scripts/backtest.py`** — `group_into_positions()` groups trades; `print_summary()` shows position-level stats

---

## 8. Historical Note

Changed 2026-03-05, pre-launch. No users affected.

**Previous model:** The `closed_pnl` column stored close-only P&L and determined win/loss based solely on the final close. This understated win rates for any position that profitably trimmed before closing at a loss.

**Column rename:** `closed_pnl` was renamed to `total_pnl` in migration `20260305000001_position_pnl_model.sql`. The `trim_pnl` column was added to both `positions` and `trade_postmortems`.

**Impact on backtest results:** V6D baseline changed from ~73% close-only win rate to 56% position-level win rate. The position count dropped from 42 (which counted trims as separate trades) to 41 (trims grouped with parents). Total P&L remained consistent at +$199 on $1K positions.
