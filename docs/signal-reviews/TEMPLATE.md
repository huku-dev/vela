# SCR-XXXX: [Change Title]

> **Author:** [name]
> **Date:** [YYYY-MM-DD]
> **Status:** Draft | Under Review | Approved | Rejected
> **Backtest Config:** [config name in backtest.py, e.g. `V4_COMBINED`]

---

## Hypothesis

**Market behavior this change exploits or protects against:**
- [Describe the specific market pattern or failure mode]

**Specific failure of the current model it addresses:**
- [Reference real incidents — e.g., "HYPE SELL signal on 2026-02-22 fired 4h after the core selloff"]

**Expected outcome:**
- [Quantify: "Should reduce average loss on late exits by X%" or "Should catch Y% of sharp moves within 1 cycle"]

---

## Logical Consistency Check

For **each** threshold or rule proposed, answer ALL of the following:

### Rule 1: [Name, e.g., "Confirmation-based entry gate (2 consecutive signals)"]

| Check | Answer |
|---|---|
| At extreme values (RSI=5, RSI=95, ADX=0, ADX=50), does this still make sense? | |
| What happens to EXISTING open positions when this fires? | |
| What happens to NEW position entries? | |
| Does this conflict with any existing rule? List all interactions. | |
| **Inversion test:** Would the OPPOSITE rule also seem reasonable? If yes, why is THIS direction correct? | |
| What market regime would make this rule HARMFUL? (trending, ranging, crash, squeeze) | |

### Rule 2: [Name]

| Check | Answer |
|---|---|
| At extreme values, does this still make sense? | |
| What happens to EXISTING open positions? | |
| What happens to NEW position entries? | |
| Conflicts with existing rules? | |
| Inversion test | |
| Harmful regime? | |

*(Repeat for each rule/threshold in the proposal)*

---

## Backtest Results

> **REQUIRED — no exceptions.** Every signal change must include A/B backtest data.
> Run: `python scripts/backtest.py --compare --days 365 --config-a current --config-b [your_config]`

### Per-Asset Comparison

*(Paste full terminal output from `--compare` mode)*

```
[paste here]
```

### Aggregate Summary

| Metric | Current (Live) | Proposed | Delta |
|---|---|---|---|
| Total P&L (all assets) | | | |
| Win rate | | | |
| Max single loss | | | |
| Avg trade duration | | | |

### Volatile Period Analysis

> Identify the 5 worst drawdown periods in the 365-day window.
> For each, show how the proposed config performed vs current.
> Run: `python scripts/validate-signal-change.py --config-name [your_config] --days 365`

| Period | Dates | BTC Drawdown | Current P&L | Proposed P&L | Delta |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |

### Buy-and-Hold Comparison

| Asset | Buy & Hold Return | Current Model Return | Proposed Model Return |
|---|---|---|---|
| BTC | | | |
| ETH | | | |
| HYPE | | | |

---

## Adversarial Review

| Threat | Severity | Assessment |
|---|---|---|
| Can this change be exploited? (amplification, race conditions, stacking) | | |
| What's the worst-case loss if this change has a bug? | | |
| Does this interact with circuit breakers or tier limits? | | |
| Could auto-mode abuse this? (e.g., rapid cycling) | | |

---

## Rollback Plan

- **Can this be reverted without data migration?** [yes/no + explanation]
- **What signals/positions would be affected mid-flight?** [list scenarios]
- **Rollback command:** [e.g., "Revert config to SIGNAL_CONFIG in signal-rules.ts"]

---

## Approval Checklist

- [ ] Backtest shows improvement in >=2 of 3 assets without regression in the third
- [ ] No logical contradictions identified in consistency check
- [ ] Inversion test passed for all rules (clear reason why THIS direction is correct)
- [ ] Volatile period analysis shows improvement (or at minimum no regression) during crashes
- [ ] Worst-case loss scenario is bounded and documented
- [ ] Rollback path confirmed — can revert without migration
- [ ] No harmful interactions with existing rules identified

**Reviewer sign-off:** _______________
**Date approved:** _______________
