# Testnet trial 1: read-only validation

**Date:** 2026-05-13
**Mode:** Read-only (no orders submitted; no testnet credentials yet supplied)
**Bot version:** v1 + v1.5 + v1.6 + v2 (logs-only)
**Network:** Hyperliquid testnet via `https://api.hyperliquid-testnet.xyz`

---

## What ran

90-second monitor run on testnet with `PLAY_A_ENABLED=false`. Polled every 5 seconds. Configured to route all API calls to testnet via `HL_TESTNET=true` (after fixing a config-routing bug where `HL_INFO_URL` wasn't auto-deriving from the testnet flag).

```bash
cd /Users/henry/crypto-agent/tools/hip4-arb-monitor
HL_TESTNET=true PLAY_A_ENABLED=false POLL_INTERVAL_SEC=5 python3 monitor.py
```

## What was discovered on testnet

**Binary outcomes (2):**
- Outcome 9830: BTC @ $80,950, expires 2026-05-14 03:00 UTC. Live book with wide spreads.
- Outcome 9940: HYPE @ $29, expires 2026-05-13 08:30 UTC. **Empty book**, no liquidity.

**Multi-outcome questions (2):**
- Question 760: BTC 3-bucket [<$79,278 / $79,278-$82,513 / >$82,513]. **Only leg 0 has liquidity, legs 1+2 empty.**
- Question 770: BTC 3-bucket [<$80,791 / $80,791-$81,034 / >$81,034]. **All legs empty.**

Most testnet markets are illiquid placeholders. Only outcome 9830 has a real two-sided book to evaluate.

## What the bot did

### Discovery + polling

- Discovered all 4 markets via `outcomeMeta` correctly. ✅
- Polled outcome 9830 books every 5 seconds for 90s = 18 snapshots recorded. ✅
- All snapshots persisted to SQLite with full quote/edge/dislocation columns. ✅
- BTC realized vol estimated from HL testnet 7-day hourly candles: **39.3% annualized** (vs mainnet 26.8%). Testnet BTC is more volatile due to thinner flow. ✅

### Mechanical arb (v1) result on outcome 9830

```
YES bid 0.392 / ask 0.474
NO  bid 0.526 / ask 0.608
sum_ask = 1.082
edge = -7.67%/$
```

**Sum at ask is well above $1.** Buying both legs costs $1.08 to receive $1 at settle = guaranteed -7.67% loss. No mechanical arb. v1 correctly skipped.

Worth noting: bid+bid = 0.918. If we could short both sides we'd collect $0.918 and pay $1 at settle = guaranteed -8.2% loss. Mids are coherent (yes_mid + no_mid ≈ 1.0); the 8% premium at ask is the bid-ask spread market makers collect on thin testnet flow.

### Multi-leg arb (v1.6)

Question 760 has 1 of 3 legs liquid. `compute_question_arb_edge` returns `None` when any leg's ask is missing. v1.6 correctly skipped. ✅

### Vol-selling evaluation (v2)

Realized vol estimated, opportunity evaluated, **filtered out** because:
- Spot: $80,999.5
- Strike: $80,950
- Moneyness: -0.06% (binary is slightly ITM)
- v2 requires moneyness > 1.5% (strike meaningfully ABOVE spot)

Without the OTM filter, the sizing math produces negative contracts (the trade structure is undefined at moneyness ≤ 0). v2 correctly skipped. ✅

## Bugs found and fixed in this run

1. **Config routing:** `HL_TESTNET=true` was not auto-routing `info_url` and `exchange_url` to testnet endpoints. Fixed in `config.py`.

2. **Hardcoded moneyness filter in `vol_selling.evaluate_opportunity`:** A `moneyness < 0.01` constant was screening before the configurable `VOL_SELLING_MIN_MONEYNESS` could apply. Replaced with `min(CONFIG.vol_selling_min_moneyness, 0.01)` so config relaxation works.

## Structural findings (not bugs)

### HL appears to list daily binaries near-the-money

Both testnet and mainnet binaries today are at-the-money:
- **Testnet:** strike $80,950, spot $80,999 → moneyness -0.06%
- **Mainnet:** strike $80,983, spot ~$80,500 → moneyness +0.60%

**Implication for v2 (vol-selling):** The strategy requires moneyness > +1.5% to fire. If HL consistently lists binaries near-the-money, v2 will only fire when:
- Spot drifts significantly away from strike during the binary's life (rare)
- HL eventually lists OTM strikes (not happening yet)

**This significantly limits v2's tradeability** on the current HIP-4 offering. The structural constraint wasn't obvious until we ran live evaluations.

### Question coverage is thin on testnet

Most testnet questions have illiquid legs. The full mechanical 3-leg arb (v1.6) likely won't fire on testnet often.

### Wide spreads on testnet

Outcome 9830 mids are coherent (~$1.00) but ask-side premium is 8%. Wide spreads on thin venues. Mainnet spreads are tighter (~1-2%) so mainnet is where v1 mechanical arb has any chance of firing.

## What v1/v2 captures vs what Henry's manual trading does

Henry's recent successful manual trade (May 13):
- 1800 YES @ $0.48260 (~$869 deployed)
- 850 NO @ $0.49850 (~$424 deployed)
- Net: directional long YES (more YES than NO), +$51 unrealized

**This is a directional accumulation, not a hedged arb.** Neither v1 (matched-pair arb) nor v2 (paired vol-sell) captures this strategy. The bot is structurally narrower than Henry's actual playbook.

The gap: Henry forms a directional view ("market is underpricing P(>strike)"), sizes asymmetric YES vs NO based on conviction, and can adjust over time. The bot's matched-pair execution model is one slice of what's possible.

**Recommended addition (v3):** Discretionary-alert mode that surfaces directional candidates (where binary mid diverges from a model fair value, or where Henry's external signal says one side has edge), with the bot doing detection + sizing recommendation but Henry doing execution. The bot's value is data + math; the human's value is the directional view.

Filed as a gap. Not blocking v1/v2 testing.

## What we cannot test without Henry's testnet credentials

- Order submission via `bulk_orders` (live execution path)
- Settlement reconciliation against actual filled positions
- Fill response parsing edge cases (partial fills, IOC behavior on outcomes)
- Telegram fill alerts (requires actual fills + telegram credentials)

To unblock live execution test:
```bash
export HL_PRIVATE_KEY=<testnet key, never commit>
export HL_ACCOUNT_ADDRESS=<testnet address>
export TELEGRAM_BOT_TOKEN=<vela admin bot>
export TELEGRAM_ADMIN_CHAT_ID=<your chat>
```

With those set, we could re-run with `PLAY_A_ENABLED=true` and `MAX_POSITION_SIZE_USD=10` for a smoke test of actual order submission.

But: given the current testnet state, even with execution enabled, v1 won't fire (sum_ask > 1) and v2 won't fire (moneyness too low). **Testing execution requires either an actual opportunity to appear OR a synthetic test case.**

## Decision points

1. **Wait for natural opportunities or construct synthetic test?**
   - Wait: continue running monitor in observation mode for 1-2 days, check what opportunities emerge naturally as binaries roll over and spot moves
   - Synthetic: build a mock-outcome path that lets us inject fake books to test the execution code without waiting

2. **v3 discretionary-alert mode**
   - Build it now? Or after we have testnet execution data on v1+v2?
   - My take: build after testnet execution validates v1+v2 paths work, then v3 layers on as a parallel alert generator using the same execution scaffolding.

3. **Mainnet read-only run**
   - We could also run the monitor on mainnet in read-only mode for a day or two to capture real opportunity frequency on the actual market. No capital risk.

## My recommendation

1. **Set Telegram credentials** so the bot can send alerts to you even from logs-only / observation runs. Free signal.
2. **Run monitor in mainnet read-only mode for 24-48h** (`PLAY_A_ENABLED=false`, mainnet). Captures real opportunity frequency. Decides whether v1 ever fires in practice.
3. **In parallel, scope v3 (discretionary-alert).** Spec the architecture: what alerts, what model, what decision points. ~1 hour scoping.
4. **Once mainnet observation data exists**, decide whether to:
   - Flip v1 live with small caps
   - Build v3 instead (if v1 never fires)
   - Wait for HL to expand HIP-4 offerings

Total time: ~2 days of passive observation + 1 hour of scoping. No capital deployed during this window.
