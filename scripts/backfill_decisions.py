#!/usr/bin/env python3
"""
Backfill the Notion Decisions database with all major project decisions
identified from the codebase, git history, and CLAUDE.md.

Run once:
    python3 scripts/backfill_decisions.py
"""

import json
import requests

with open(".notion-config.json", "r") as f:
    config = json.load(f)

NOTION_TOKEN = config["notion_token"]
DECISIONS_DB_ID = config["decisions_db_id"]
NOTION_VERSION = "2022-06-28"

headers = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Content-Type": "application/json",
    "Notion-Version": NOTION_VERSION,
}

# First, clean up the junk entries (the "y", "Decisions Made" ones from Feb 16)
def cleanup_junk():
    """Delete the 4 junk entries from accidental vela-end input."""
    url = f"https://api.notion.com/v1/databases/{DECISIONS_DB_ID}/query"
    resp = requests.post(url, headers=headers, json={
        "filter": {
            "property": "Date",
            "date": {"equals": "2026-02-16"}
        }
    })
    if resp.status_code != 200:
        print(f"  Error querying: {resp.status_code}")
        return

    pages = resp.json().get("results", [])
    for page in pages:
        title = "".join(r["plain_text"] for r in page["properties"]["Decision"]["title"])
        if title in ("y", "Decisions Made"):
            # Archive (soft delete)
            r = requests.patch(
                f"https://api.notion.com/v1/pages/{page['id']}",
                headers=headers,
                json={"archived": True}
            )
            status = "✓ archived" if r.status_code == 200 else f"✗ {r.status_code}"
            print(f"  {status}: \"{title}\"")


DECISIONS = [
    # ── Product ─────────────────────────────────────────────
    {
        "decision": "Paper trading before real money",
        "date": "2026-02-15",
        "why": "Build trust and prove signal accuracy before risking capital. Users must see a transparent track record with real P&L data. No real-money integration until paper trading demonstrates consistent profitability.",
        "alternatives": "Launch with real trading immediately (too risky for trust); Manual trade logging (too much friction); Demo mode with fake data (not transparent enough)",
        "status": "Active",
    },
    {
        "decision": "Three Pillar brand framework: Always Watching / You Stay in Control / Plain English",
        "date": "2026-02-15",
        "why": "Differentiates Vela from jargon-heavy crypto tools. Every UI string, notification, and brief must align with one pillar. plainEnglish() helper strips EMA/RSI/ADX from user-facing text. Brief generator prompt explicitly forbids technical jargon.",
        "alternatives": "Generic finance-app branding (undifferentiated); Technical-first approach (alienates newcomers); No brand framework (inconsistent messaging)",
        "status": "Active",
    },
    {
        "decision": "User approval required for every trade — no auto-trading",
        "date": "2026-02-15",
        "why": "Trust and liability. Vela surfaces signals but the user makes every decision. Notification accept/decline buttons reinforce this. Critical for the 'You Stay in Control' pillar.",
        "alternatives": "Auto-execute trades on signal change (too risky, trust-breaking); One-click execute without confirmation (insufficient control)",
        "status": "Active",
    },
    {
        "decision": "Condensed notifications that link back to the product",
        "date": "2026-02-19",
        "why": "Notifications should tease, not replace the product. Headline + link to full brief drives engagement back into the app. Telegram truncated to 150 chars, email to 200 chars.",
        "alternatives": "Full brief in notification (too long, no reason to visit product); Notification with no link (dead end); No notifications (users forget about Vela)",
        "status": "Active",
    },
    {
        "decision": "Tiered information architecture: Key Signal → What's Happening → Why We Think This",
        "date": "2026-02-18",
        "why": "Progressive disclosure — beginners see plain headlines, experienced users drill into technical detail. Reduces information overload. Tier 3 is collapsible.",
        "alternatives": "All information at once (overwhelming); Technical-only view (alienates newcomers); Simplified-only view (insufficient for experienced traders)",
        "status": "Active",
    },
    # ── Engineering ─────────────────────────────────────────
    {
        "decision": "Supabase as backend (vs. custom API)",
        "date": "2026-02-15",
        "why": "Managed Postgres + real-time subscriptions + Edge Functions + auth in one service. Reduces ops burden for a solo developer. Database views (latest_signals, latest_briefs) simplify frontend queries.",
        "alternatives": "Custom Express/Fastify API (more ops overhead); Firebase (less SQL-friendly for financial data); PlanetScale (no Edge Functions)",
        "status": "Active",
    },
    {
        "decision": "Supabase Edge Functions (Deno) for the signal engine",
        "date": "2026-02-17",
        "why": "Runs close to the database, serverless, no infrastructure to manage. Cron-triggered every 4H. TypeScript shared modules for indicators, signal rules, brief generation, and notifications.",
        "alternatives": "Vercel Serverless Functions (separate from database); AWS Lambda (overkill ops); Local cron job (not reliable, needs always-on machine)",
        "status": "Active",
    },
    {
        "decision": "Claude API (Anthropic) for brief generation with deterministic fallback",
        "date": "2026-02-17",
        "why": "AI generates plain-English briefs from raw indicator data. Avoids hardcoded templates, produces context-aware analysis. buildFallbackBrief() ensures signal engine never crashes on API failure.",
        "alternatives": "Template-based briefs (too rigid); GPT-4 (more expensive, similar quality); No briefs, just signals (loses the Plain English pillar)",
        "status": "Active",
    },
    {
        "decision": "React + TypeScript + Vite for frontend",
        "date": "2026-02-15",
        "why": "Type safety critical for financial data display (P&L calculations, signal status rendering). Vite for fast dev builds. Strict mode enabled, no-explicit-any enforced by ESLint.",
        "alternatives": "Next.js (SSR overkill for dashboard app); Vue (smaller ecosystem for finance); Plain JS (too risky for P&L calculations)",
        "status": "Active",
    },
    {
        "decision": "Vercel for frontend deployment with auto-deploy on main",
        "date": "2026-02-16",
        "why": "Zero-config deployment from git push. SPA rewrite rules in vercel.json for client-side routing. Frontend-only hosting since backend is Supabase.",
        "alternatives": "Netlify (similar, but less Next.js ecosystem); Self-hosted (ops overhead); GitHub Pages (no server-side redirects)",
        "status": "Active",
    },
    {
        "decision": "5-step pre-commit quality gate (secrets + tsc + eslint + prettier + vitest)",
        "date": "2026-02-17",
        "why": "Catches secrets, type errors, lint violations, format issues, and test failures before any commit reaches the repo. Prevents leaked API keys and broken builds.",
        "alternatives": "CI-only checks (too late, already committed); Manual review (unreliable); No checks (too risky for financial app)",
        "status": "Active",
    },
    {
        "decision": "Telegram + Resend email for notifications (dual implementation: Python + Edge Function)",
        "date": "2026-02-19",
        "why": "Telegram for instant mobile alerts, Resend for email record. Two parallel implementations: Python (notify.py) for backtest/dev, TypeScript (notify.ts) for live Edge Function. Both mirror the same templates.",
        "alternatives": "Telegram only (no email record); Email only (slow for real-time signals); Push notifications (needs mobile app); Single implementation (can't test without live pipeline)",
        "status": "Active",
    },
    # ── Design ──────────────────────────────────────────────
    {
        "decision": "Neobrutalist design system (V2.0) with semantic color tokens",
        "date": "2026-02-15",
        "why": "Bold, high-contrast, distinctive visual identity. Three-layer token system: primitives → semantics → components. Green=BUY only, Red=SELL only. WCAG AA+ target (7.8:1 contrast). Prevents hardcoded colors throughout codebase.",
        "alternatives": "Material Design (generic); Tailwind utility-first (less semantic); Custom minimal (less distinctive)",
        "status": "Active",
    },
    {
        "decision": "Light mode only — dark mode deliberately disabled",
        "date": "2026-02-18",
        "why": "Cream neobrutalist design does not translate well to dark mode. Disabled until properly designed and tested. CSS uses color-scheme: light only. Better to ship a polished light mode than a broken dark mode.",
        "alternatives": "Ship both modes (risk broken dark mode UX); Dark mode first (doesn't match brand identity); System preference detection (breaks if dark mode looks bad)",
        "status": "Active",
    },
    {
        "decision": "Vela Component Library over raw MUI",
        "date": "2026-02-18",
        "why": "Ensure design consistency. Raw MUI components drift from the neobrutalist style. VelaComponents.tsx provides branded wrappers (Button, Card, Badge, SignalCard). Migrate MUI to Vela when editing pages.",
        "alternatives": "Raw MUI everywhere (inconsistent styling); No component library (too much duplication); Shadcn/ui (different aesthetic)",
        "status": "Active",
    },
    # ── Signals ─────────────────────────────────────────────
    {
        "decision": "EMA 9/21 crossover as primary signal trigger with 5-gate confirmation",
        "date": "2026-02-17",
        "why": "Simple, well-understood trend-following signal. All other indicators (ADX ≥ 20, RSI range, SMA-50 trend, anti-whipsaw 12h window) serve as confirmation gates to reject false signals in choppy markets.",
        "alternatives": "MACD crossover (laggier); RSI-only (too many false signals); Multi-indicator scoring (too complex, harder to explain in Plain English)",
        "status": "Active",
    },
    {
        "decision": "4-hour candle timeframe for signal evaluation",
        "date": "2026-02-17",
        "why": "Balance between noise and latency. 1H has too many false EMA crosses, daily misses intraday moves. 4H is standard for swing trading. CoinGecko provides 4H OHLC with days=30.",
        "alternatives": "1H candles (too noisy); Daily candles (too slow); 15-min candles (noise + rate limit issues)",
        "status": "Active",
    },
    {
        "decision": "Enhanced v3 signal config: volume + ATR stop + BTC crash filter + circuit breaker + RSI BB",
        "date": "2026-02-18",
        "why": "Backtested over 365 days: 23 trades, 50% win rate, +$1,648 total P&L on $1K positions. Outperforms v1 (17 trades, 25% win rate, +$1,617). Fewer but higher-quality trades. Each parameter individually A/B tested.",
        "alternatives": "Keep v1 config (lower win rate); Aggressive v3 with lower volume threshold (blocked HYPE's best trade); No stop-loss (catastrophic drawdown risk)",
        "status": "Active",
    },
    {
        "decision": "Quality over quantity — fewer trades at higher win rate",
        "date": "2026-02-18",
        "why": "v3 produces 23 trades vs. v1's 17, but both significantly fewer than the 62 from an earlier looser analysis. Accepted because total P&L and win rate are what matter, not trade count. Users trust consistency over activity.",
        "alternatives": "Relax volume threshold to generate more trades (lower quality); Add more complementary signals (complexity risk); Keep v1 for higher trade count (worse P&L)",
        "status": "Active",
    },
    # ── Operations ──────────────────────────────────────────
    {
        "decision": "Notion as project management system with git-integrated automation",
        "date": "2026-02-15",
        "why": "Centralized documentation, task tracking, decision logging, and changelog. Post-commit hook auto-generates changelog entries. vela-start/vela-end scripts maintain session context. Bidirectional notification template sync.",
        "alternatives": "GitHub Issues (less flexible for docs); Linear (another tool to learn); Plain markdown files (no automation, no views)",
        "status": "Active",
    },
    {
        "decision": "Notification templates managed in Notion with bidirectional sync",
        "date": "2026-02-19",
        "why": "Non-technical stakeholders can edit notification copy in Notion. sync_notifications.py pulls changes to local JSON. Enables content iteration without code deploys.",
        "alternatives": "Hardcode all templates in code (requires developer for every copy change); CMS like Contentful (overkill); Google Sheets (no rich text, no versioning)",
        "status": "Active",
    },
]


def create_decision(d: dict) -> bool:
    url = "https://api.notion.com/v1/pages"
    data = {
        "parent": {"database_id": DECISIONS_DB_ID},
        "properties": {
            "Decision": {"title": [{"text": {"content": d["decision"]}}]},
            "Date": {"date": {"start": d["date"]}},
            "Why": {"rich_text": [{"text": {"content": d["why"]}}]},
            "Alternatives considered": {
                "rich_text": [{"text": {"content": d.get("alternatives", "")}}]
            },
            "Status": {"select": {"name": d["status"]}},
        },
    }
    resp = requests.post(url, headers=headers, json=data)
    if resp.status_code in (200, 201):
        return True
    print(f"    Error: {resp.status_code} {resp.text[:200]}")
    return False


if __name__ == "__main__":
    print("Backfilling Notion Decisions database...\n")

    # Clean up junk entries first
    print("Cleaning up junk entries from Feb 16:")
    cleanup_junk()

    # Check for existing decisions to avoid duplicates
    url = f"https://api.notion.com/v1/databases/{DECISIONS_DB_ID}/query"
    resp = requests.post(url, headers=headers, json={})
    existing = set()
    if resp.status_code == 200:
        for p in resp.json().get("results", []):
            title = "".join(r["plain_text"] for r in p["properties"]["Decision"]["title"])
            existing.add(title.lower().strip())

    print(f"\n  {len(existing)} existing entries (after cleanup)")
    print(f"  {len(DECISIONS)} decisions to backfill\n")

    created = 0
    skipped = 0
    for d in DECISIONS:
        if d["decision"].lower().strip() in existing:
            print(f"  ⚪ Already exists: {d['decision'][:60]}")
            skipped += 1
            continue

        ok = create_decision(d)
        status = "✓" if ok else "✗"
        print(f"  {status} {d['decision'][:70]}")
        if ok:
            created += 1

    print(f"\n✅ Done: {created} created, {skipped} skipped (already existed)")
