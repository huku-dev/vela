# Brief Fallback Chain & LLM Patterns

## Architecture (as of 2026-05-25)

`brief-generator.ts` generates asset briefs via **direct Anthropic API calls** — it does NOT route through the shared `llm/` registry layer (`llmComplete`). The registry entries for `brief_generate` are dead code.

Key module-level non-exported functions: `BRIEF_SYSTEM_PROMPT`, `buildAssetBriefPrompt`, `parseBriefResponse`, `callFreeTierBriefFallback`.

## Fallback chain

Anthropic (3 retries, 5s/15s/30s backoff) → Groq llama-3.3-70b-versatile → NVIDIA meta/llama-3.3-70b-instruct → static template (`buildFallbackBrief`).

Free-tier fallback fires only on Anthropic outage. Primary path (Sonnet for signal_change, Haiku for notable_update) unchanged.

## NVIDIA model selection

Use `meta/llama-3.3-70b-instruct` (~2.5s) for latency-sensitive paths on NIM.  
`qwen/qwen3.5-122b-a10b` times out at 120s consistently — unusable as a fallback.

## Benchmark pattern (when keys are in Supabase secrets)

Deploy a temporary edge function inline via `deploy_edge_function` MCP (accepts `files: [{name, content}]`) → invoke via curl → tombstone with 410 response. No local script or disk writes needed.

## Sentry attribution

Backend and frontend share `SENTRY_DSN`. Backend errors appear in the `vela-react` Sentry project. Not a bug.

## Incident: 2026-05-25 Sentry alerts

Cause: Anthropic 529 overload during 9:10 AM `run-signals-4h` batch. 2 retries with 5s/15s backoff both fell within a ~3-min degradation window. 9/11 assets got static fallback briefs. Fix: retry 2→3 + free-tier fallback chain.
