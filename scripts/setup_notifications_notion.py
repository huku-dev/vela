#!/usr/bin/env python3
"""
Create a Notion database for Vela notification templates.

This sets up a "Notification Templates" database under the Content page,
pre-populated with all current notification types and their editable content.

Run once:
    python3 scripts/setup_notifications_notion.py
"""

import json
import requests

# ── Config ──────────────────────────────────────────────────────────────

with open(".notion-config.json", "r") as f:
    config = json.load(f)

NOTION_TOKEN = config["notion_token"]
CONTENT_PAGE_ID = config["content_page_id"]
NOTION_VERSION = "2022-06-28"

headers = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Content-Type": "application/json",
    "Notion-Version": NOTION_VERSION,
}

# ── Create database ─────────────────────────────────────────────────────


def create_notifications_db() -> str:
    """Create the Notification Templates database and return its ID."""
    url = "https://api.notion.com/v1/databases"
    data = {
        "parent": {"page_id": CONTENT_PAGE_ID},
        "icon": {"type": "emoji", "emoji": "🔔"},
        "title": [{"type": "text", "text": {"content": "Notification Templates"}}],
        "properties": {
            "Name": {"title": {}},
            "Type": {
                "select": {
                    "options": [
                        {"name": "Signal Change", "color": "green"},
                        {"name": "Daily Digest", "color": "blue"},
                        {"name": "System", "color": "gray"},
                    ]
                }
            },
            "Channel": {
                "multi_select": {
                    "options": [
                        {"name": "Telegram", "color": "blue"},
                        {"name": "Email", "color": "purple"},
                    ]
                }
            },
            "Status": {
                "select": {
                    "options": [
                        {"name": "Active", "color": "green"},
                        {"name": "Draft", "color": "yellow"},
                        {"name": "Disabled", "color": "red"},
                    ]
                }
            },
            "Signal": {
                "select": {
                    "options": [
                        {"name": "BUY (green)", "color": "green"},
                        {"name": "SELL (red)", "color": "red"},
                        {"name": "WAIT (grey)", "color": "gray"},
                        {"name": "All", "color": "default"},
                    ]
                }
            },
            "Last Synced": {"date": {}},
        },
    }

    resp = requests.post(url, headers=headers, json=data)
    if resp.status_code not in (200, 201):
        print(f"Error creating database: {resp.status_code}")
        print(resp.text[:500])
        raise SystemExit(1)

    db_id = resp.json()["id"]
    print(f"  Created database: {db_id}")
    return db_id


# ── Populate templates ──────────────────────────────────────────────────

TEMPLATES = [
    {
        "name": "Signal Change — BUY (Telegram)",
        "type": "Signal Change",
        "channel": ["Telegram"],
        "status": "Active",
        "signal": "BUY (green)",
        "body": [
            {
                "heading_2": "Message Format"
            },
            {
                "code": '🟢 *{asset_symbol}: BUY* at ${price}\n\n{headline}\n\n[View full brief →]({app_url}/{asset_id})',
                "language": "markdown",
            },
            {
                "heading_2": "Inline Buttons"
            },
            {
                "paragraph": "Row 1: ✅ Accept BUY | ❌ Decline"
            },
            {
                "paragraph": "Row 2: View full brief → (links to product)"
            },
            {
                "heading_2": "Variables"
            },
            {
                "bulleted_list": [
                    "{asset_symbol} — e.g. BTC, ETH, HYPE",
                    "{price} — current price, formatted with commas, no decimals",
                    "{headline} — one-line Plain English summary from the brief",
                    "{asset_id} — Supabase asset ID (used in product URL)",
                    "{app_url} — product base URL (currently localhost, will be production)",
                ]
            },
            {
                "heading_2": "Notes"
            },
            {
                "paragraph": "Keep the headline under 100 characters. Should be Plain English per the Three Pillars — no jargon like EMA or RSI. Example: \"Price broke above $95,000 — trend is turning up\""
            },
        ],
    },
    {
        "name": "Signal Change — SELL (Telegram)",
        "type": "Signal Change",
        "channel": ["Telegram"],
        "status": "Active",
        "signal": "SELL (red)",
        "body": [
            {
                "heading_2": "Message Format"
            },
            {
                "code": '🔴 *{asset_symbol}: SELL* at ${price}\n\n{headline}\n\n[View full brief →]({app_url}/{asset_id})',
                "language": "markdown",
            },
            {
                "heading_2": "Inline Buttons"
            },
            {
                "paragraph": "Row 1: ✅ Accept SELL | ❌ Decline"
            },
            {
                "paragraph": "Row 2: View full brief → (links to product)"
            },
            {
                "heading_2": "Notes"
            },
            {
                "paragraph": "Identical structure to BUY but with red emoji and SELL label. Headlines should explain WHY the signal changed — e.g. \"Selling pressure increasing as price drops below $90,000\""
            },
        ],
    },
    {
        "name": "Signal Change — WAIT (Telegram)",
        "type": "Signal Change",
        "channel": ["Telegram"],
        "status": "Active",
        "signal": "WAIT (grey)",
        "body": [
            {
                "heading_2": "Message Format"
            },
            {
                "code": '⚪ *{asset_symbol}: WAIT* at ${price}\n\n{headline}\n\n[View full brief →]({app_url}/{asset_id})',
                "language": "markdown",
            },
            {
                "heading_2": "Inline Buttons"
            },
            {
                "paragraph": "Row 1: View full brief → (no accept/decline — WAIT is not actionable)"
            },
            {
                "heading_2": "Notes"
            },
            {
                "paragraph": "WAIT signals don't have accept/decline buttons since they aren't actionable. The message just links to the full brief for context."
            },
        ],
    },
    {
        "name": "Signal Change — Email",
        "type": "Signal Change",
        "channel": ["Email"],
        "status": "Active",
        "signal": "All",
        "body": [
            {
                "heading_2": "Subject Line"
            },
            {
                "code": "Vela: {asset_symbol} → {label} at ${price}",
                "language": "plain text",
            },
            {
                "heading_2": "Email Body"
            },
            {
                "paragraph": "Neobrutalist card layout (cream #FFFBF5 background, 3px black border, Inter font):"
            },
            {
                "bulleted_list": [
                    "Accent-colored left border (green for BUY, red for SELL, grey for WAIT)",
                    "Header: \"{asset_symbol}: {label} at ${price}\"",
                    "Body: {headline} — one-line Plain English summary",
                    "CTA buttons (BUY/SELL only): ✅ ACCEPT {label} | ❌ DECLINE",
                    "Footer link: \"View full brief →\"",
                    "Brand footer: \"Vela — Smarter trading starts here\"",
                ]
            },
            {
                "heading_2": "Accept/Decline Button URLs"
            },
            {
                "code": "Accept: {app_url}/{asset_id}?action=accept&signal={signal_color}\nDecline: {app_url}/{asset_id}?action=decline&signal={signal_color}",
                "language": "plain text",
            },
            {
                "heading_2": "Color System"
            },
            {
                "bulleted_list": [
                    "BUY accent: #00D084 (green) — white text on button",
                    "SELL accent: #FF4757 (red) — white text on button",
                    "WAIT accent: #EBEBEB (grey) — no action buttons",
                    "Decline button: cream background, black text, black border",
                ]
            },
        ],
    },
    {
        "name": "Daily Digest — Telegram",
        "type": "Daily Digest",
        "channel": ["Telegram"],
        "status": "Active",
        "signal": "All",
        "body": [
            {
                "heading_2": "Message Format"
            },
            {
                "code": '📰 *Vela Daily Digest — {date}*\n\n{summary_truncated}\n\n[Read full digest →]({app_url})',
                "language": "markdown",
            },
            {
                "heading_2": "Inline Buttons"
            },
            {
                "paragraph": "Row 1: Read full digest → (links to product home)"
            },
            {
                "heading_2": "Variables"
            },
            {
                "bulleted_list": [
                    "{date} — formatted as \"Feb 19\" (short month + day)",
                    "{summary_truncated} — first 150 characters of the digest summary, with \"...\" if truncated",
                    "{app_url} — product base URL",
                ]
            },
            {
                "heading_2": "Notes"
            },
            {
                "paragraph": "The digest is intentionally condensed — the full version lives on the product. Goal is to drive users back to the app, not deliver everything via Telegram."
            },
        ],
    },
    {
        "name": "Daily Digest — Email",
        "type": "Daily Digest",
        "channel": ["Email"],
        "status": "Active",
        "signal": "All",
        "body": [
            {
                "heading_2": "Subject Line"
            },
            {
                "code": "Vela Daily Digest — {date}",
                "language": "plain text",
            },
            {
                "heading_2": "Email Body"
            },
            {
                "paragraph": "Same neobrutalist card layout as signal emails:"
            },
            {
                "bulleted_list": [
                    "Header: \"📰 Daily Digest — {date}\"",
                    "Body: {summary_truncated} — first 200 characters of digest",
                    "CTA button: \"Read full digest →\" (black background, cream text)",
                    "Brand footer: \"Vela — Smarter trading starts here\"",
                ]
            },
            {
                "heading_2": "Notes"
            },
            {
                "paragraph": "Email shows 200 chars (vs 150 for Telegram) since email has more visual space. The CTA should be the most prominent element — goal is click-through to the product."
            },
        ],
    },
    {
        "name": "Configuration & Pre-Launch Checklist",
        "type": "System",
        "channel": ["Telegram", "Email"],
        "status": "Active",
        "signal": "All",
        "body": [
            {
                "heading_2": "Environment Variables"
            },
            {
                "bulleted_list": [
                    "TELEGRAM_BOT_TOKEN — Bot API token from @BotFather",
                    "TELEGRAM_CHAT_ID — Target chat ID (currently: 950571987)",
                    "RESEND_API_KEY — Resend.com API key",
                    "NOTIFICATION_EMAIL — Recipient email (currently: henry.uku@gmail.com)",
                ]
            },
            {
                "heading_2": "Pre-Launch TODO"
            },
            {
                "bulleted_list": [
                    "[ ] Replace APP_BASE_URL in notify.ts (Edge Function) with production URL",
                    "[ ] Replace APP_BASE_URL in notify.py (Python) with production URL",
                    "[ ] Set up Resend custom domain (replace onboarding@resend.dev with signals@vela.app)",
                    "[ ] Set up Telegram webhook for accept/decline callback handling",
                    "[ ] Build frontend handler for ?action=accept/decline query params",
                    "[ ] Test inline buttons with production HTTPS URL",
                ]
            },
            {
                "heading_2": "Where Notifications Are Sent From"
            },
            {
                "bulleted_list": [
                    "Live signals: Supabase Edge Function (run-signals) → notify.ts",
                    "Backtest/dev: Python script (backtest.py --notify) → notify.py",
                    "Both modules mirror the same templates and logic",
                ]
            },
            {
                "heading_2": "Callback Data Format (Accept/Decline)"
            },
            {
                "code": "Telegram callback_data:\n  accept_{asset_id}_{signal_color}   e.g. accept_bitcoin_green\n  decline_{asset_id}_{signal_color}  e.g. decline_bitcoin_green\n\nEmail query params:\n  ?action=accept&signal={signal_color}\n  ?action=decline&signal={signal_color}",
                "language": "plain text",
            },
        ],
    },
]


def build_block(item: dict) -> dict:
    """Convert a simple template dict to a Notion block."""
    if "heading_2" in item:
        return {
            "object": "block",
            "type": "heading_2",
            "heading_2": {
                "rich_text": [
                    {"type": "text", "text": {"content": item["heading_2"]}}
                ]
            },
        }
    elif "paragraph" in item:
        return {
            "object": "block",
            "type": "paragraph",
            "paragraph": {
                "rich_text": [
                    {"type": "text", "text": {"content": item["paragraph"]}}
                ]
            },
        }
    elif "code" in item:
        return {
            "object": "block",
            "type": "code",
            "code": {
                "rich_text": [
                    {"type": "text", "text": {"content": item["code"]}}
                ],
                "language": item.get("language", "plain text"),
            },
        }
    elif "bulleted_list" in item:
        # Return multiple blocks — one per bullet
        return [
            {
                "object": "block",
                "type": "bulleted_list_item",
                "bulleted_list_item": {
                    "rich_text": [{"type": "text", "text": {"content": bullet}}]
                },
            }
            for bullet in item["bulleted_list"]
        ]
    return {}


def create_template_page(db_id: str, template: dict) -> None:
    """Create a single template page in the database."""
    url = "https://api.notion.com/v1/pages"

    # Build page body blocks
    children = []
    for item in template["body"]:
        block = build_block(item)
        if isinstance(block, list):
            children.extend(block)
        elif block:
            children.append(block)

    data = {
        "parent": {"database_id": db_id},
        "properties": {
            "Name": {
                "title": [
                    {"type": "text", "text": {"content": template["name"]}}
                ]
            },
            "Type": {"select": {"name": template["type"]}},
            "Channel": {
                "multi_select": [{"name": ch} for ch in template["channel"]]
            },
            "Status": {"select": {"name": template["status"]}},
            "Signal": {"select": {"name": template["signal"]}},
        },
        "children": children,
    }

    resp = requests.post(url, headers=headers, json=data)
    if resp.status_code in (200, 201):
        print(f"  ✓ {template['name']}")
    else:
        print(f"  ✗ {template['name']}: {resp.status_code}")
        print(f"    {resp.text[:300]}")


# ── Main ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("Setting up Notification Templates in Notion...\n")

    # 1. Create the database
    db_id = create_notifications_db()

    # 2. Populate with templates
    print("\nCreating template pages:")
    for tmpl in TEMPLATES:
        create_template_page(db_id, tmpl)

    # 3. Save DB ID to config
    config["notifications_db_id"] = db_id
    with open(".notion-config.json", "w") as f:
        json.dump(config, f, indent=2)
    print(f"\n  Saved notifications_db_id to .notion-config.json")

    print("\n✅ Done! Open Notion to view and edit your notification templates.")
    print(f"   Database ID: {db_id}")
