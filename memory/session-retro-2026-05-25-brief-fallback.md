# Session Retro 2026-05-25: Brief-generator Groq+NVIDIA fallback chain

## What was accomplished

**Sentry incident investigation and fix.** Root cause: Anthropic returned 529 overload errors during the 9:10 AM `run-signals-4h` batch on 2026-05-25. With only 2 retries (5s + 15s backoff), both retries fell within the ~3-minute degradation window. 9/11 assets in the batch got static fallback briefs. Sentry alerts appeared in `vela-react` (frontend) project because backend and frontend share `SENTRY_DSN` — not a frontend issue.

**Changes shipped to staging (commit `07fe713`):**

| File | Change |
|---|---|
| `brief-generator.ts` | Retry 2→3 (backoff 5s/15s/30s). New `callFreeTierBriefFallback()`. Groq → NVIDIA fallback chain after Anthropic exhaustion. |
| `llm/cost.ts` | Pricing entry for `claude-sonnet-4-6` ($3/$15 per 1M, same as 4.5) |
| `llm/registry.ts` | `claude-sonnet-4-5-20250929` → `claude-sonnet-4-6` across 5 entries (dead code — no behavioral change) |
| `content-generator.ts` | Model version bump only |
| `breaking-news/index.ts` | Model version bump at 2 direct call sites |
| `run-signals/index.ts` | Label string bump |
| `digest-shadow.ts` | Comment update |
| `brief-generator.test.ts` | Assertions updated for new retry count + model string |
| `circuit-breakers.test.ts` | Model string assertion updated |
| `scripts/brief-compare.ts` | New benchmark script used during investigation |

**Benchmark results (run via temporary staging edge function):**

| Model | Latency | Quality |
|---|---|---|
| Sonnet 4.6 | ~9-10s | High. Specific numbers, natural language, educational summaries. |
| Groq llama-3.3-70b | ~0.9s | Medium. Generic headlines ("SOL: Short Opportunity"), thin summaries, no numbers. Structurally complete. |
| NVIDIA qwen3.5-122b | DNF (>120s) | Unusable. Consistently timed out. |
| NVIDIA llama-3.3-70b-instruct | ~2.5s | Medium. Similar to Groq. |

NVIDIA fallback model changed from `qwen/qwen3.5-122b-a10b` → `meta/llama-3.3-70b-instruct`.

Phase 1 QA: clean pass, no must-fix items. 73/73 tests. 10/10 E2E trade pipeline + 13/13 testnet. Deployed to staging.

**NOT deployed to prod this session** — awaiting Henry's explicit go-ahead.

---

## Prompting feedback

- **"run the script yourself man"** — fair and correct. `deploy_edge_function` MCP was available the entire time and I should have reached for it before writing a local script and asking for API keys.
- **"continue"** after Write rejection — ambiguous but I correctly inferred the constraint (no writes to `supabase/functions/`).
- Henry's cost concerns were stated clearly and should have been acknowledged more directly: "I will be very upset if we have an unintended spike in Sonnet costs." The brief-generator fallback doesn't increase Sonnet costs (Sonnet stays primary, free-tier only fires on outage). This should have been confirmed explicitly upfront, not through benchmarking.

---

## Efficiency feedback

**Wasted steps:**
1. Wrote `scripts/brief-compare.ts` before checking MCP tools. Cost: ~3 round trips. Should have done `ToolSearch` for `deploy_edge_function` immediately.
2. Used wrong NVIDIA model (`qwen/qwen3-235b-a22b` → 404, then `qwen/qwen3.5-122b-a10b` → timeout at 120s). Correct model `meta/llama-3.3-70b-instruct` was in the registry all along. Should have checked existing NVIDIA usage in `registry.ts` first.
3. Ran benchmark function 5 versions (wrong model → parallel resource limit → sequential per-case → NVIDIA-only test with 60s → 120s timeout). Should have used sequential from the start.
4. `supabase secrets list` detour — knew hashes aren't values, should have gone straight to MCP deploy.
5. `git stash --keep-index` error on untracked migration file. Non-fatal but created a confusing error message.

---

## Learnings

- **`deploy_edge_function` MCP tool** accepts inline `files: [{name, content}]` — no disk writes needed. Use this immediately when API keys are in Supabase secrets and you need to run code against them.
- **NVIDIA qwen models are slow.** `qwen3.5-122b-a10b` timed out at 120s on every test. `meta/llama-3.3-70b-instruct` is the right NVIDIA model for latency-sensitive paths (~2.5s).
- **Benchmark pattern:** deploy temp edge function → curl → tombstone it. No local script needed.
- **Sentry shared DSN:** backend and frontend share `SENTRY_DSN`. Backend errors appear in `vela-react` Sentry project. Not a bug.
- **`brief-generator.ts` bypass:** generates briefs via direct Anthropic API calls, does NOT route through the shared `llm/` registry layer. Free-tier fallback therefore imports `GroqProvider`/`NvidiaProvider` directly.
- **`git stash --keep-index`** with explicit paths doesn't handle untracked files. Use `git add <our files>` then `git stash --keep-index` (no paths) to split staged/unstaged cleanly.

---

## Open items

- **Production deploy not done** — staging verified, awaiting explicit prod go-ahead from Henry.
- **Other-session working tree changes** still uncommitted: `notify.ts` (+268 lines, batch proposal email/HMAC), `trade-webhook/index.ts` (+76 lines, `handleBatchEmailAction`), `proposal-generator.ts` (+83 lines, deferred batch email), `news-fetcher.ts`, `supabase/migrations/20260522000001_reenable_daily_digest_cron.sql`. These need QA and a separate deploy.
- **brief-compare staging function** still exists as a tombstone (returns 410). Should be deleted from Supabase dashboard.
- **Sentry noise:** when Anthropic degrades but Groq fallback succeeds, Sentry still fires `Claude API exhausted retries` at error level (11 events during an incident). Accepted as conservative alerting — could downgrade to warning if it becomes noisy.
