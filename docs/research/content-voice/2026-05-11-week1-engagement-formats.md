# Content Voice Research — Week 1 (Engagement Formats)

**Date:** 2026-05-11
**Cycle topic:** Week 1 — "finance investing social media content what gets engagement 2026"
**Source mandate:** Reddit only (r/investing, r/socialmediamarketing, r/personalfinance, r/financialindependence)
**Result:** Run failed — no usable Reddit data this cycle.

## Key findings

Nothing to report. The Reddit search backend returned **0 posts** for this query. See post-mortem.

The /last30days script auto-fell-back to X/Twitter (30 posts) and tried HN (SSL failure). Per the scheduled-task spec ("Ignore X, TikTok, Instagram, YouTube, HN, Polymarket, and web results entirely"), I'm not summarizing those.

## Actionable content ideas

None this cycle. The whole point of this rotation is to get fresh, dated Reddit signal we don't already have — padding with X or web would just re-surface noise we already know.

## Language / voice observations

N/A this cycle.

## Meme / cultural reference to adapt this week

N/A this cycle.

## Post-Mortem

**Did Reddit return on-topic results?** No. **Zero** results returned.

**Why it failed:**
1. The /last30days script uses ScrapeCreators API for Reddit search. API returned **HTTP 402 Payment Required** — the SCRAPECREATORS_API_KEY credits are exhausted (free tier capped at 100 credits, then PAYG).
2. Verbatim error from the script:
   ```
   [Reddit] Global search error: 402 Client Error: Payment Required for url:
   https://api.scrapecreators.com/v1/reddit/search?query=...
   ```
3. Secondary issue: the query I passed jammed all four subreddit names into a single global search string (`r/investing r/socialmediamarketing r/personalfinance r/financialindependence`). Even if credits weren't exhausted, ScrapeCreators' global search treats those tokens as keywords, not subreddit filters — it would have returned noisy global results.

**Did Reddit return on-topic results from the targeted subreddits?** No — the script never actually drilled into the four targeted subreddits. The current /last30days script does subreddit *discovery* from a global search but doesn't accept a `--subreddit` filter argument. Verified by inspecting `last30days.py --help` (only `--x-handle`, no Reddit-specific scoping flags).

**What would improve next run:**

1. **Top up SCRAPECREATORS_API_KEY credits** — without this, every future Week 1/2/3/4 run will fail the same way. Or switch the Reddit backend to free public JSON (`reddit.com/r/<sub>/search.json`) which has no auth.
2. **Per-subreddit queries instead of a single global query.** Run four separate /last30days invocations, one per subreddit, with a tighter topic string. Pseudocode:
   ```
   for sub in investing socialmediamarketing personalfinance financialindependence:
     /last30days "<sub topic>" site:reddit.com/r/$sub
   ```
   Or, more pragmatically, write a small wrapper that hits Reddit's public JSON directly (`https://www.reddit.com/r/<sub>/top.json?t=month`) and bypasses the script entirely. That's actually a better fit for this scheduled task — it's a deterministic input we control, with no API-key dependency.
3. **Narrow the topic per week.** "Finance investing social media content what gets engagement 2026" is too broad. For Week 1 specifically, more targeted phrasings: "what posts blew up on r/investing this month", "creator income r/socialmediamarketing", "best finance threads April 2026".
4. **Date filter enforcement.** Even when the script returns results, it doesn't reliably exclude undated posts — we'd need to filter the JSON output ourselves before synthesis.

**Cost of not fixing this:** the scheduled task fires weekly and produces an empty brief. Three more cycles of this and the task should be paused or rewritten.

**Suggested next action:** before next Monday's run (2026-05-18, Week 2 — subscription/pricing landscape), either (a) top up the ScrapeCreators credit, or (b) rewrite the scheduled-task SKILL to call Reddit's public JSON directly per targeted subreddit. Option (b) is preferable: no recurring API cost, deterministic data shape, native date filtering.
