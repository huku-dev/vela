# HIP-4 Prediction Markets Research

Research project to evaluate whether outcome / prediction markets (HIP-4 on Hyperliquid, plus Polymarket and Kalshi as historical proxies) provide actionable edge for Vela's signal engine and trading layer.

## Why this exists

HIP-4 is live but has no history (single BTC daily binary, just launched). To make integration decisions before HIP-4 has multi-asset depth, we use Polymarket and Kalshi as historical proxies for the structural questions.

Strategic context: see the parent thinking memo and adversarial review captured in session transcripts.

## Plays under evaluation

| ID | Play | Question this research answers | Proxy validity |
|---|---|---|---|
| 0 | Funding-basis arb (perp vs binary) | Does HL perp funding diverge from binary implied probability over short horizons in a way that creates delta-neutral edge? | Direction-only on Polymarket; HL funding is real |
| 1 | Implied-probability signal input | Does implied probability divergence from our signal direction predict signal hit rate? | Direction defensible |
| 4 | Conviction overlay | Do Vela high-conviction signals settle in their favor at rates above market-implied probability? | Direction only, magnitude won't transfer |

Plays 2 (stop-replacement), 3 (tail overlay), and 5 (catalyst windows) are explicitly out of scope here. Play 2 needs HIP-4 quote data we don't have. Play 3 economics need real premium data. Play 5 was killed by the adversarial review (catalyst blocking exists for model-invalidity reasons, not risk-shape reasons).

## Data sources

- **Polymarket** (`https://clob.polymarket.com` and `https://gamma-api.polymarket.com`): historical BTC and ETH price-target markets, no auth needed for market data
- **Kalshi** (`https://api.elections.kalshi.com/trade-api/v2`): historical BTC and ETH price markets, no auth needed for public market data
- **Hyperliquid** (`https://api.hyperliquid.xyz/info`): historical funding rates and mark prices, no auth
- **Vela signal history**: production DB export (Supabase, prod ref `dikybxkubbaabnshnreh`)

## Layout

- `scripts/` — pull and analysis scripts (Python)
- `data/` — pulled samples (CSVs, JSONs). Gitignored beyond a small sample for shape inspection.
- `findings/` — markdown writeups per analysis cut

## Status

Research spike. No code here ships to production. If a play graduates, it gets rebuilt against prod patterns.
