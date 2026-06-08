# Foregone Move Analysis

Run the post-close candle analysis to measure how much additional profit was available
after each trailing stop exit. Fetches 48h of 1h candles from Hyperliquid for all
closed positions, grouped by close reason.

## Steps

1. **Check environment** — confirm `SUPABASE_URL` and `SUPABASE_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) are set:
   ```bash
   echo "SUPABASE_URL: ${SUPABASE_URL:0:30}..."
   echo "SUPABASE_KEY set: $([ -n "$SUPABASE_KEY" ] && echo yes || echo NO)"
   ```
   If missing, load from `.env.local`.

2. **Install dependencies:**
   ```bash
   pip install -r scripts/requirements-backtest.txt
   ```

3. **Run the analysis** (trailing stops only, which is the primary investigation):
   ```bash
   python3 scripts/foregone_move_analysis.py --close-reason trailing_stop
   ```
   Output: console summary tables + `foregone_move_analysis.csv` in the repo root.

4. **Optional — run for all close reasons** (stop_loss, take_profit, manual, etc.):
   ```bash
   python3 scripts/foregone_move_analysis.py
   ```

5. **Optional — single asset debug:**
   ```bash
   python3 scripts/foregone_move_analysis.py --close-reason trailing_stop --asset btc
   ```

## What it produces

- **Foregone move %:** max favourable move in trade direction within 48h post-close
- **Breakeven in N candles:** how quickly price retraced back to entry after exit  
- **Continuation rate:** % of exits where price continued >2% in trade direction within 24h
- CSV with per-position detail for further analysis

## Notes

- Requires direct Hyperliquid API access — **will not work in the cloud Claude Code environment** (outbound HTTP blocked by network policy)
- Run from `~/vela` directory: `cd ~/vela && git pull origin main`
- HL symbol mapping is in `scripts/foregone_move_analysis.py` — `ASSET_TO_HL` dict. Non-crypto assets use `xyz:` prefix (e.g. `xyz:AAPL`, `xyz:CL` for oil)
- If you see "SPX500 not found" or similar, check the mapping — correct symbol is `xyz:SPX`
