# Product Brief: Post-Onboarding UX

**Status:** Design exploration
**Origin:** Yele onboarding call (2026-04-03). User completed subscription but was unclear on how to fund wallet and how the trading system works.
**Goal:** Reduce friction between "I just subscribed" and "I understand how Vela works and my wallet is funded."

---

## Problem Statement

New users who complete onboarding and land on the dashboard face two gaps:

1. **Deposit gap.** The path from subscription to funded wallet requires navigating to Account > Deposit. There's no prompt on the Home page. Users don't know they need to fund before Vela can trade. 33% of paid users (1 of 3, all high intent) subscribe but never deposit.

2. **Mental model gap.** Users expect a brokerage (I see an asset, I click buy). Vela is signal-driven (Vela watches, proposes, you approve). When nothing is immediately actionable, users think the product is broken rather than working as designed. Explanation screens don't solve this: Yele skipped 4 onboarding panels. Users learn by doing, not reading.

---

## Part 1: Deposit UX Fix

### 1A. Post-checkout interstitial

**When:** Shown once, immediately after first Stripe checkout completes.
**What:** A single screen that surfaces the deposit sheet directly, framed as the natural next step.
**Tone:** Not instructional. Celebratory + action-oriented. "You're in. Let's fund your wallet so Vela can start trading for you."
**Behavior:** Opens the DepositSheet component inline. User can deposit right there or dismiss to Home.
**Persistence:** One-time only. If dismissed, the persistent banner on Home catches them.

### 1B. Banner priority system

**Problem:** Multiple banners compete for the same space on Home (fund wallet, connect Telegram, upgrade plan, pending proposals). Stacking them creates UI bloat.

**Solution:** Single-banner slot at the top of Home. One banner at a time, selected by priority:

| Priority | Banner | Condition | Dismissible? |
|----------|--------|-----------|-------------|
| 1 | **Fund your wallet** | Paid user, $0 balance, no open positions | No (persists until funded) |
| 2 | **Pending trade proposal** | Has an actionable proposal | No (existing behavior) |
| 3 | **Connect Telegram** | Paid user, Telegram not connected | Yes (permanent dismiss) |
| 4 | **Upgrade plan** | Free user | Yes (session dismiss) |

Only one banner shows at a time. The highest-priority applicable one wins.

---

## Part 2: Teaching Through Experience

Core challenge: how do users learn "Vela watches, you approve" through the product experience itself, not through explanation screens?

Key constraint: Telegram can't be the primary teaching channel. Not all users will connect it, and TG isn't ubiquitous. Teaching has to work in-app first.

### Channel priority
1. **In-app** (primary, reaches 100% of users)
2. **Email** (reaches 100%, users opted in at signup)
3. **Telegram** (bonus for connected users)

---

## Part 3: First Trade Guided Moments

The primary teaching mechanism is the first trade experience itself. Every user hits this moment. The treatment differs by mode and outcome.

### First trade: Auto-execute users

One-time celebratory card on Home after the first trade executes. Leads with excitement, not mechanics. Separate from the trade notification itself (which stays standard).

Tone example: "Congrats on your first Vela trade! When Vela spots an opportunity, based on your settings, we execute the trade instantly, and set profit or stop-loss targets to maximize your upside and limit any downside."

Don't teach the architecture. Celebrate the outcome.

### First trade: Manual approval users

The first proposal card gets a one-time expanded visual treatment with a warm intro. Not a tooltip overlay. A natural extension of the card that frames it as their first opportunity.

### First decline

After a user passes on their first proposal:

"You got your first Vela trade proposal! We noticed you passed on it, and that's completely fine. Vela will keep watching and send another opportunity when conditions are right. If something about the proposal didn't feel right, we'd love to hear about it. You can reach us anytime via Support in the app."

Key principles: no guilt, no urgency, genuine care, feedback loop. The product should feel calm.

### First expiry (ignored proposal, high churn risk)

User didn't approve or decline, proposal expired. This group is most at risk of churning.

"Your first Vela trade proposal expired. No worries, these happen regularly as Vela monitors your assets. Next time, you'll get a notification with the details and can approve or pass with one tap. Another opportunity will come."

Teaches the time-limited nature of proposals since the user may not have understood it.

### Email treatment

First trade email (proposal or execution) gets a slightly different template with the same celebratory framing. One-time only, subsequent emails use standard template.

### Telegram welcome message (for connected users)

State-aware based on trading mode:
- **Manual approval:** Includes "I won't execute anything without your say-so."
- **Auto-execute:** "I'll execute trades automatically based on your settings. You'll get a notification after each one, and you can pause or override anytime."

Includes the last winning trade as an example (real, credible, shows full lifecycle). Pulled from closed_positions table.

---

## Resolved Decisions

| Question | Decision |
|----------|----------|
| Empty state teaching (Idea 1) | Reframed. Home already shows signal cards. Teaching happens through first trade moment, not empty states. |
| Tooltip vs expanded state (Idea 2) | Expanded card state with warm intro, not tooltips. |
| Applies to Telegram/email? | Yes, both. First trade notification gets special treatment across all channels. |
| Wait signal guided treatment? | No. Guided treatment on first Buy/Short only (no proposals on Wait). |
| Auto-execute first signal? | Separate celebratory message after execution, not embedded in trade notification. |
| Telegram welcome per mode? | Yes, state-aware. Different copy for manual vs auto. |
| Example signal in welcome? | Last winning trade (real, shows lifecycle and outcome). |
| 24h follow-up if no signal? | Skip for v1. Most signals fire within 24h of signup. |
| Users who subscribe but don't deposit | 1 of 3 (33% drop-off). Confirms deposit gap is real. |

---

## Out of Scope

- **User-initiated trades.** Debated and decided against. Vela remains signal-driven. The fix is making the signal-driven model intuitive, not adding manual trading.
- **Redesigning the full onboarding flow.** The 4-panel onboarding exists. These improvements target users who skip it.
- **Deposit flow mechanics.** Privy/MoonPay integration works fine. The problem is discoverability, not functionality.

---

## Next Steps

1. Wireframe the banner priority system (Part 1B)
2. Wireframe the post-checkout interstitial (Part 1A)
3. Wireframe the first-trade guided card (auto-execute and manual approval variants)
4. Draft first-decline and first-expiry notification copy
5. Draft Telegram welcome message (both mode variants)

## Open Data Questions

- ~~How many users complete subscription but never deposit?~~ **Answered: 1 of 3 (33%)**
- What % connect Telegram during onboarding vs later?
- ~~Average time between signup and first signal firing?~~ **Answered: Most within 24h**
