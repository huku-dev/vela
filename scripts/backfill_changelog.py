#!/usr/bin/env python3
"""
Backfill missing Notion changelog entries for commits that were missed
when the post-commit hook was in .git/hooks/ instead of .husky/.

Run once:
    python3 scripts/backfill_changelog.py
"""

import json
import os
import subprocess
import requests
from datetime import datetime

# Load config
with open(".notion-config.json", "r") as f:
    config = json.load(f)

NOTION_TOKEN = config["notion_token"]
CHANGELOG_DB_ID = config["changelog_db_id"]
NOTION_VERSION = "2022-06-28"

headers = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Content-Type": "application/json",
    "Notion-Version": NOTION_VERSION,
}

# Commits that were missed (between Feb 18 and today)
# Skipping ae262ba since git_to_notion.py was just run manually for it
MISSED_COMMITS = [
    {
        "hash": "2259969",
        "date": "2026-02-19",
        "summary": "feat: add Telegram + email notification system",
        "detail": "Built notification dispatch for signal changes and daily digests via Telegram Bot API and Resend email. Includes formatted messages with Vela branding, configurable via .env, and --notify flag on backtest.py.",
        "area": "Infra",
        "impact": "User-facing",
    },
    {
        "hash": "b46ca94",
        "date": "2026-02-18",
        "summary": "feat: add paginated 'View more' to Your Trades page",
        "detail": "Track Record page now loads 50 trades at a time with a 'View more' button for pagination. Prevents slow loading when trade count grows.",
        "area": "UI",
        "impact": "User-facing",
    },
    {
        "hash": "8595c75",
        "date": "2026-02-18",
        "summary": "fix: use Enhanced v3 config for backtest, disable dark mode overrides",
        "detail": "Switched backtest from SIGNAL_CONFIG (v1) to IMPROVED_CONFIG (Enhanced v3) which includes volume confirmation, ATR dynamic stop-loss, and BTC crash filter. Also fixed dark mode CSS overrides that were breaking light mode.",
        "area": "Signals",
        "impact": "Internal",
    },
    {
        "hash": "1d48bdb",
        "date": "2026-02-18",
        "summary": "fix: align paper_trades column name to opened_at across frontend",
        "detail": "Fixed column name mismatch — Supabase table uses opened_at but frontend was querying created_at. Updated all queries and types to use opened_at consistently.",
        "area": "Data",
        "impact": "Internal",
    },
    {
        "hash": "630909e",
        "date": "2026-02-18",
        "summary": "chore: gitignore reference docs and Python cache",
        "detail": "Added reference docs directory and __pycache__ to .gitignore to keep repo clean.",
        "area": "Infra",
        "impact": "Internal",
    },
    {
        "hash": "24d62ed",
        "date": "2026-02-18",
        "summary": "feat: consolidate asset detail UX — signal history, plain English, price highlights",
        "detail": "Redesigned asset detail page: signal history folded into Key Signal card, briefs grouped by signal state, price highlights in What Would Change section, and indicator trend deltas with timeframe context.",
        "area": "UI",
        "impact": "User-facing",
    },
]


def create_entry(entry: dict) -> bool:
    url = "https://api.notion.com/v1/pages"
    data = {
        "parent": {"database_id": CHANGELOG_DB_ID},
        "properties": {
            "Summary": {"title": [{"text": {"content": entry["summary"]}}]},
            "Date": {"date": {"start": entry["date"]}},
            "Area": {"select": {"name": entry["area"]}},
            "Detail": {"rich_text": [{"text": {"content": entry["detail"]}}]},
            "Version": {"rich_text": [{"text": {"content": "0.2.0"}}]},
            "Status": {"select": {"name": "Deployed"}},
            "Impact": {"select": {"name": entry["impact"]}},
        },
    }

    resp = requests.post(url, headers=headers, json=data)
    if resp.status_code in (200, 201):
        return True
    print(f"  Error: {resp.status_code} {resp.text[:200]}")
    return False


if __name__ == "__main__":
    print("Backfilling missing Notion changelog entries...\n")
    for entry in MISSED_COMMITS:
        ok = create_entry(entry)
        status = "✓" if ok else "✗"
        print(f"  {status} {entry['hash']} — {entry['summary'][:60]}")
    print("\n✅ Backfill complete.")
