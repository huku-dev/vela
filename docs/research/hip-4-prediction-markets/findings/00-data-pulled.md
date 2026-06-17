# 00 — Data pulled, shape inspection, decision points

First pass at standing up the data sources for the HIP-4 research spike. Three sources confirmed accessible without auth, sample data inspected, gotchas surfaced.

## What we have

### Polymarket
- **673 BTC/ETH price-target markets** discovered via Gamma API `/markets?closed=true`. ~6 months of recently-active history.
- Per-market metadata: question text, start/end date, outcome (yes/no), final settlement, volume, liquidity, CLOB token IDs.
- Historical timeseries: works on **recent CLOB-era markets only**. Older AMM-era markets return 0 points from `/prices-history`. Practical implication: usable history is roughly the last 6 months at most, and probably less for older / lower-volume markets. Most relevant markets (weekly and daily BTC price targets) do return data.
- Sample: "Will Bitcoin be above $78,000 on May 2?" started yesterday at p=0.755, settled at p=0.0005 (BTC did not close above $78K). This is the exact shape we need for calibration.
- File: `data/polymarket_btc_eth_markets.csv` (673 rows), `data/sample-polymarket.json`.

### Kalshi
- **24,209 BTC/ETH price markets** across 61 series. Dominant volume is in `KXBTCD` (BTC daily, ~4000 markets), `KXETHD` equivalent for ETH, and intra-day series like `KXBTC15M`.
- Auth-free public market data confirmed.
- Series taxonomy: `KX{ASSET}{HORIZON}{TYPE}`, e.g. `KXBTCD` = BTC daily binary, `KXBTCMAXW` = BTC weekly maximum, `KXBTCMINMON` = BTC monthly minimum.
- Per-market: ticker, open/close/expiration, status, result, last price, volume, OI, settlement value.
- Historical price endpoint exists (`/historical/markets/{ticker}/candlesticks`) but not yet pulled. Next step.
- File: `data/kalshi_btc_eth_markets.csv` (24K rows), `data/sample-kalshi.json`.

### Hyperliquid
- BTC and ETH funding rates pulled, hourly cadence, last 180 days. 4320 entries each.
- Files: `data/hl_funding_BTC_180d.json`, `data/hl_funding_ETH_180d.json`.
- Mark-price history not pulled yet. Available via `candleSnapshot` info endpoint when needed.

### Vela signals
- Not yet pulled. Production DB query needed (Supabase prod ref `dikybxkubbaabnshnreh`). Will pull via MCP when running the alignment cuts.

## Gotchas surfaced during the pull

1. **Polymarket AMM-era markets are dead-data for our purposes.** Markets with $1M+ historical volume but pre-CLOB return zero history points. Limits the backtest depth more than I expected. Realistic usable window: 4-6 months on the well-trafficked weekly/daily BTC markets, less for ETH.

2. **Kalshi crypto series taxonomy is irregular.** `KXBTCD` (with the `KX` prefix) and `BTC` (without) are both legitimate series tickers, but content overlaps inconsistently. Need to dedupe by checking event_ticker uniqueness before any cross-source alignment.

3. **Polymarket `prices-history` only accepts CLOB token IDs, not market IDs.** Each market has 2 tokens (Yes / No). For binary markets they're complements (sum to ~1.0), so pulling either is sufficient. Doc snippet was misleading on this; the parameter is named `market` but takes `tokenId`.

4. **Naming discipline matters.** Many Polymarket "BTC" markets are actually about CryptoPunks floor in BTC, BTC-related ETF flows, etc. Initial discovery returned 673 candidates but the truly comparable subset (binary "BTC above/below $X by date Y") is smaller, probably 200-300 once we filter by question pattern. Recommend regex-filter pass before the alignment cuts.

5. **Kalshi false positives in prefix matching.** `ETH` matched series like `BETHER` (BET Her TV show) and `KXETHFLIP` (ETH flippening, which is a ratio market). Manual exclusion list curated; flag for review if anyone touches the discover_kalshi.py filter logic.

## Cuts we can run with this data

In order of effort and value:

### Cut 1 (cheapest, fastest): Play 0 basis check
Compare HL BTC funding rates against Polymarket BTC binary implied probabilities for daily/weekly horizons. Is there a systematic divergence that would create delta-neutral edge if we could short one side?

Data needed: aligned timestamps. We have everything. ~half-day of analysis work.

### Cut 2: Play 4 calibration direction
Pull Vela historical signals, find the Polymarket / Kalshi binary market open at signal-fire time with strike closest to the signal's price target, compare market-implied probability at signal-fire to actual settle outcome. Are Vela's high-conviction signals materially better than market-implied?

Data needed: Vela signal export from prod. Half-day of work after that.

### Cut 3: Play 1 confirmation/divergence
Same data as Cut 2, but different framing: when the binary's implied probability disagrees with our signal direction by more than X%, does the signal hit rate change? Can probability divergence flag low-quality signals?

### Cut 4 (skip for now): Premium economics for Plays 2 / 3
Out of scope here per the adversarial review. Wait for HIP-4 quote data.

## Recommended next move

Cut 1 first because:
- It's the least scoped (no Vela DB export needed)
- It's the play with the highest a priori edge case (delta-neutral arb)
- Polymarket as proxy is most defensible for this cut (we're checking direction of basis, not magnitude)
- It either shows a basis exists or it doesn't, which is a binary decision

If basis exists in any meaningful regime, we proceed to Cut 2 with a concrete reason. If not, Plays 0 dies and we narrow focus to Cuts 2-3.

## Open questions for the user

1. Pull depth: 6 months covers what's realistically available. Want to extend to the oldest CLOB-era markets we can find (maybe 12-18 months back) or stick with 6 months for the first cut?
2. Asset coverage: BTC + ETH only for v1, or do we want SOL / HYPE in scope? HL has perp data for all; Polymarket and Kalshi coverage gets thinner past BTC + ETH.
3. Vela signal export: any constraints on what we pull from prod? Specifically I'd want signal timestamp, asset, direction, conviction tier (if exists), and 24h-after price for hit-rate computation.
