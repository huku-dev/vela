#!/usr/bin/env python3
"""
Update stale Notion pages with current project state.
Appends new sections to existing pages rather than replacing content.

Run once after significant project milestones:
    python3 scripts/update_notion_pages.py
"""

import json
import requests
from datetime import datetime, timezone

# ── Config ──────────────────────────────────────────────────────────────

with open(".notion-config.json", "r") as f:
    config = json.load(f)

NOTION_TOKEN = config["notion_token"]
NOTION_VERSION = "2022-06-28"

headers = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Content-Type": "application/json",
    "Notion-Version": NOTION_VERSION,
}

TODAY = datetime.now(timezone.utc).strftime("%b %d, %Y")


def append_blocks(page_id: str, blocks: list[dict]) -> bool:
    """Append blocks to a Notion page."""
    url = f"https://api.notion.com/v1/blocks/{page_id}/children"
    resp = requests.patch(url, headers=headers, json={"children": blocks})
    if resp.status_code == 200:
        return True
    print(f"  Error appending blocks: {resp.status_code}")
    print(f"  {resp.text[:300]}")
    return False


def h2(text: str) -> dict:
    return {
        "object": "block",
        "type": "heading_2",
        "heading_2": {
            "rich_text": [{"type": "text", "text": {"content": text}}]
        },
    }


def h3(text: str) -> dict:
    return {
        "object": "block",
        "type": "heading_3",
        "heading_3": {
            "rich_text": [{"type": "text", "text": {"content": text}}]
        },
    }


def para(text: str) -> dict:
    return {
        "object": "block",
        "type": "paragraph",
        "paragraph": {
            "rich_text": [{"type": "text", "text": {"content": text}}]
        },
    }


def bullet(text: str) -> dict:
    return {
        "object": "block",
        "type": "bulleted_list_item",
        "bulleted_list_item": {
            "rich_text": [{"type": "text", "text": {"content": text}}]
        },
    }


def callout(text: str, emoji: str = "📌") -> dict:
    return {
        "object": "block",
        "type": "callout",
        "callout": {
            "rich_text": [{"type": "text", "text": {"content": text}}],
            "icon": {"type": "emoji", "emoji": emoji},
        },
    }


def divider() -> dict:
    return {"object": "block", "type": "divider", "divider": {}}


def code_block(text: str, language: str = "plain text") -> dict:
    return {
        "object": "block",
        "type": "code",
        "code": {
            "rich_text": [{"type": "text", "text": {"content": text}}],
            "language": language,
        },
    }


# ── Product Page Updates ────────────────────────────────────────────────


def update_product_page():
    """Add current feature status and recent milestones to Product page."""
    page_id = config["product_page_id"]
    print("Updating Product page...")

    blocks = [
        divider(),
        callout(f"Updated: {TODAY}", "🔄"),
        h2("Current Feature Status (Feb 2026)"),
        para("Status: Pre-launch MVP — all core features functional, iterating on polish."),
        h3("Completed Features"),
        bullet("Signal dashboard — live BUY/SELL/WAIT signals for BTC, ETH, HYPE"),
        bullet("Asset detail pages — full brief with Plain English analysis, indicator breakdown"),
        bullet("Paper trading — automated position management with entry/exit/P&L tracking"),
        bullet("Track record page — full trade history with per-asset stats, win rate, total P&L"),
        bullet("Daily market digest — AI-generated market summary via Claude API"),
        bullet("Notifications (Telegram + Email) — signal changes and daily digests"),
        bullet("Accept/decline signal actions — inline buttons in notifications for trade confirmation"),
        bullet("Dark mode — full theme support with WCAG AA+ contrast"),
        bullet("Neobrutalist design system — VelaComponents library with semantic tokens"),
        h3("In Progress"),
        bullet("Notification content polish — templates editable in Notion (bidirectional sync)"),
        bullet("Production deployment prep — Vercel, custom domain, Resend custom sender"),
        bullet("Accept/decline callback handling — frontend + Telegram webhook"),
        h3("Next Up"),
        bullet("User authentication — accounts, saved preferences"),
        bullet("Customizable signal parameters — user-adjustable thresholds"),
        bullet("Real-time price updates — WebSocket or Supabase real-time"),
        bullet("Mobile responsive polish — 375px breakpoint optimization"),
        h2("Signal Performance (Enhanced v3 Backtest)"),
        para("365-day backtest results using the current Enhanced v3 signal configuration:"),
        bullet("Total trades: 23 across BTC, ETH, HYPE"),
        bullet("Win rate: 50% (v1 was 25%)"),
        bullet("Total P&L: +$1,648 on $1,000 positions"),
        bullet("Strategy: Volume-confirmed entries, ATR dynamic stop-loss, BTC crash filter, portfolio circuit breaker"),
        h2("Notification System"),
        para("Two-channel notification system dispatches signal changes and daily digests:"),
        bullet("Telegram: Condensed message + inline accept/decline buttons + link to full brief"),
        bullet("Email (Resend): Neobrutalist HTML card with CTA buttons, matching brand styling"),
        para("Notifications are intentionally condensed — they surface the headline and drive users back to the product for the full brief. This supports the 'You Stay in Control' pillar."),
        para("Templates are managed in the Notification Templates database under Content."),
    ]

    if append_blocks(page_id, blocks):
        print("  ✓ Product page updated")
    else:
        print("  ✗ Product page update failed")


# ── Engineering Page Updates ────────────────────────────────────────────


def update_engineering_page():
    """Add backend architecture, Edge Functions, and notification system docs."""
    page_id = config["engineering_page_id"]
    print("Updating Engineering page...")

    blocks = [
        divider(),
        callout(f"Updated: {TODAY}", "🔄"),
        h2("Backend Architecture (Supabase Edge Functions)"),
        para("The live signal pipeline runs as a Supabase Edge Function in a separate repo:"),
        code_block(
            "Repo: /Users/henry/crypto-agent/\n"
            "Entry: supabase/functions/run-signals/index.ts\n"
            "Schedule: Every 4 hours via cron\n"
            "Runtime: Deno (Supabase Edge Functions)",
            "plain text",
        ),
        h3("Signal Pipeline Flow"),
        bullet("1. Fetch 4H candles + daily closes from CoinGecko for each enabled asset"),
        bullet("2. Compute technical indicators (EMA-9, EMA-21, RSI-14, SMA-50, ADX-4H)"),
        bullet("3. Evaluate signal via rule engine (signal-rules.ts) → BUY / SELL / WAIT"),
        bullet("4. Compare to previous signal — if changed, generate brief via Claude API"),
        bullet("5. Write signal + brief to Supabase"),
        bullet("6. Send notification (Telegram + Email) via notify.ts"),
        bullet("7. Manage paper trades (open/close positions based on signal changes)"),
        h3("Key Shared Modules"),
        bullet("signal-rules.ts — Signal evaluation logic, anti-whipsaw filter, yellow event detection"),
        bullet("brief-generator.ts — Claude API integration for Plain English briefs"),
        bullet("data-fetcher.ts — CoinGecko API wrapper (4H candles, daily closes, market context)"),
        bullet("indicators.ts — Technical indicator calculations (EMA, RSI, SMA, ADX)"),
        bullet("notify.ts — Notification dispatch (Telegram + Email with inline buttons)"),
        h3("Signal Configuration (Enhanced v3)"),
        para("Current production config — IMPROVED_CONFIG from backtest.py:"),
        bullet("Volume confirmation: entry_threshold 0.8, exit_threshold 0.6"),
        bullet("Dynamic stop-loss: ATR multiplier 2.0, trailing activation at +3%"),
        bullet("BTC crash filter: blocks altcoin longs when BTC drops >5% in 24h"),
        bullet("Portfolio circuit breaker: halts new trades after 3 consecutive losses"),
        bullet("RSI Bollinger Band complementary trades for range-bound markets"),
        h2("Notification System Architecture"),
        h3("Two Parallel Implementations"),
        bullet("TypeScript (notify.ts) — runs in Supabase Edge Function for live signals"),
        bullet("Python (notify.py) — runs locally for backtest --notify mode"),
        para("Both modules mirror the same template logic and formatting."),
        h3("Telegram Integration"),
        bullet("Bot API: sendMessage with Markdown parse_mode"),
        bullet("Inline keyboard buttons for accept/decline (requires HTTPS URLs)"),
        bullet("callback_data format: accept_{assetId}_{signalColor} / decline_{assetId}_{signalColor}"),
        bullet("Graceful fallback: skip inline buttons when APP_BASE_URL is localhost"),
        h3("Email Integration (Resend)"),
        bullet("REST API at https://api.resend.com/emails"),
        bullet("Neobrutalist HTML templates matching Vela design system"),
        bullet("Accept/decline CTA buttons with deep links back to product"),
        bullet("Free tier: sends to verified email only (upgrade for custom domain)"),
        h3("Environment Variables"),
        bullet("TELEGRAM_BOT_TOKEN — set via supabase secrets set"),
        bullet("TELEGRAM_CHAT_ID — target chat ID"),
        bullet("RESEND_API_KEY — Resend API key"),
        bullet("NOTIFICATION_EMAIL — recipient email address"),
        h2("Paper Trading System"),
        para("Automated paper trade management integrated into the signal pipeline:"),
        bullet("Opens position when signal changes to BUY (long) or SELL (short)"),
        bullet("Closes position when signal changes away from current direction"),
        bullet("Tracks entry price, exit price, P&L percentage, holding period"),
        bullet("Stats aggregated in paper_trade_stats view (per-asset win rate, avg P&L)"),
        h2("Database Schema (Current)"),
        para("Key Supabase tables:"),
        bullet("assets — enabled crypto assets with CoinGecko IDs"),
        bullet("signals — all signal snapshots with indicator values"),
        bullet("briefs — AI-generated analysis (signal_change + notable_update + daily_digest)"),
        bullet("paper_trades — trade history (opened_at, closed_at, entry_price, exit_price, pnl_pct)"),
        bullet("paper_trade_stats — materialized view of per-asset trading statistics"),
        para("Views:"),
        bullet("latest_signals — most recent signal per asset"),
        bullet("latest_briefs — most recent brief per asset"),
        bullet("latest_digest — most recent daily digest"),
        h2("Testing"),
        para("60 frontend tests via Vitest + React Testing Library:"),
        bullet("helpers.test.tsx — plainEnglish(), formatters, price segment parsing"),
        bullet("VelaComponents.test.tsx — SignalCard, Button, StatCard, Alert, Badge components"),
        para("Pre-commit hooks enforce: secrets check → tsc → eslint → prettier → vitest"),
    ]

    if append_blocks(page_id, blocks):
        print("  ✓ Engineering page updated")
    else:
        print("  ✗ Engineering page update failed")


# ── Operations Page Updates ─────────────────────────────────────────────


def update_operations_page():
    """Add Vercel deployment, Edge Function ops, and notification ops docs."""
    page_id = config["operations_page_id"]
    print("Updating Operations page...")

    blocks = [
        divider(),
        callout(f"Updated: {TODAY}", "🔄"),
        h2("Current Deployment Stack"),
        h3("Frontend — Vercel"),
        bullet("Auto-deploys from main branch on push"),
        bullet("Build: npm run build (Vite)"),
        bullet("Environment: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY"),
        h3("Backend — Supabase Edge Functions"),
        bullet("Project: memyqgdqcwrrybjpszuw"),
        bullet("Function: run-signals (scheduled every 4H)"),
        bullet("Deploy: supabase functions deploy run-signals --project-ref memyqgdqcwrrybjpszuw"),
        bullet("Secrets: supabase secrets set KEY=VALUE --project-ref memyqgdqcwrrybjpszuw"),
        bullet("Dashboard: https://supabase.com/dashboard/project/memyqgdqcwrrybjpszuw/functions"),
        h3("Notifications"),
        bullet("Telegram Bot: @VelaNotifBot (token in Supabase secrets)"),
        bullet("Email: Resend API (currently onboarding@resend.dev sender)"),
        bullet("Both channels configured via Supabase Edge Function environment"),
        h2("Edge Function Management"),
        h3("Deploying Updates"),
        code_block(
            "# From the crypto-agent repo:\n"
            "cd /Users/henry/crypto-agent\n"
            "supabase functions deploy run-signals --project-ref memyqgdqcwrrybjpszuw\n\n"
            "# Set/update secrets:\n"
            "supabase secrets set TELEGRAM_BOT_TOKEN=xxx --project-ref memyqgdqcwrrybjpszuw\n\n"
            "# View logs:\n"
            "supabase functions logs run-signals --project-ref memyqgdqcwrrybjpszuw",
            "bash",
        ),
        h3("Monitoring Signal Runs"),
        bullet("Check Supabase dashboard → Functions → run-signals for invocation logs"),
        bullet("Each run logs: assets processed, signals evaluated, briefs generated, notifications sent"),
        bullet("Failed notifications log errors but don't block signal processing"),
        h2("Notification Operations"),
        h3("Testing Notifications Locally"),
        code_block(
            "# Test all channels:\n"
            "python3 scripts/notify.py --test\n\n"
            "# Check Notion templates vs code:\n"
            "python3 scripts/sync_notifications.py --diff\n\n"
            "# Pull latest templates from Notion:\n"
            "python3 scripts/sync_notifications.py",
            "bash",
        ),
        h3("Pre-Launch Checklist"),
        bullet("[ ] Replace APP_BASE_URL with production URL in notify.ts AND notify.py"),
        bullet("[ ] Set up Resend custom domain for branded sender address"),
        bullet("[ ] Test Telegram inline buttons with HTTPS production URL"),
        bullet("[ ] Set up Telegram webhook endpoint for accept/decline callbacks"),
        bullet("[ ] Verify email deliverability from custom domain"),
        h2("Automation Scripts"),
        para("Key scripts in scripts/ directory:"),
        bullet("notify.py — Notification dispatch (Telegram + Email) with --test mode"),
        bullet("sync_notifications.py — Bidirectional Notion ↔ code template sync"),
        bullet("backtest.py — Signal backtest with --notify and --compare flags"),
        bullet("start_session.py (vela-start) — Session status check"),
        bullet("end_session.py (vela-end) — Log decisions and tasks to Notion"),
        bullet("notion_tasks.py (vela-tasks) — Task management CLI"),
        bullet("git_to_notion.py — Auto-changelog on git commit (post-commit hook)"),
    ]

    if append_blocks(page_id, blocks):
        print("  ✓ Operations page updated")
    else:
        print("  ✗ Operations page update failed")


# ── Main ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"Updating Notion pages ({TODAY})...\n")
    update_product_page()
    update_engineering_page()
    update_operations_page()
    print("\n✅ All pages updated. Check Notion to review.")
