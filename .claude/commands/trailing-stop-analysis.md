# Trailing Stop Post-Close Analysis

For each of our 81 closed trailing-stop positions, fetch 48h of post-close price data
from Hyperliquid and calculate how much additional profit was available after we exited.
This tells us whether the trailing stop is exiting too early.

## Steps

1. **Check env vars are set:**
   ```bash
   echo "SUPABASE_URL: ${SUPABASE_URL:0:40}..."
   echo "SUPABASE_KEY set: $([ -n "$SUPABASE_KEY" ] && echo YES || echo MISSING)"
   ```
   If missing, load from `.env.local`.

2. **Install dependencies:**
   ```bash
   pip install -r scripts/requirements-backtest.txt
   ```

3. **Run the analysis:**
   ```bash
   python3 scripts/foregone_move_analysis.py --close-reason trailing_stop
   ```

## Output

- Console table: per-asset summary (continuation rate, avg profit left on table)
- `foregone_move_analysis.csv`: one row per position with full detail

## Requirements

- Must run **locally** — Hyperliquid API is blocked in the cloud Claude Code environment
- Run from the `~/vela` directory after `git pull origin main`
