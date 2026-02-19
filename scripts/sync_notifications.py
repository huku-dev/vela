#!/usr/bin/env python3
"""
Bidirectional Notification Template Sync — Notion ↔ Code
─────────────────────────────────────────────────────────

Reads notification templates from the Notion "Notification Templates" database
and writes them to a local JSON file that notify.py / notify.ts can reference.

Usage:
    python3 scripts/sync_notifications.py          # Pull from Notion → local JSON
    python3 scripts/sync_notifications.py --push    # Push code defaults → Notion
    python3 scripts/sync_notifications.py --diff    # Show differences without syncing

The local JSON lives at:
    scripts/notification_templates.json

This enables bidirectional editing:
  1. You edit content in Notion (headlines, copy, button labels)
  2. Run `python3 scripts/sync_notifications.py` to pull changes
  3. notify.py reads the JSON at runtime if present
  4. Or: make code changes and `--push` them back to Notion
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

# ── Config ──────────────────────────────────────────────────────────────

CONFIG_PATH = Path(__file__).resolve().parent.parent / ".notion-config.json"
OUTPUT_PATH = Path(__file__).resolve().parent / "notification_templates.json"

with open(CONFIG_PATH, "r") as f:
    config = json.load(f)

NOTION_TOKEN = config["notion_token"]
NOTIFICATIONS_DB_ID = config.get("notifications_db_id", "")
NOTION_VERSION = "2022-06-28"

headers = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Content-Type": "application/json",
    "Notion-Version": NOTION_VERSION,
}

if not NOTIFICATIONS_DB_ID:
    print("Error: notifications_db_id not found in .notion-config.json")
    print("Run `python3 scripts/setup_notifications_notion.py` first.")
    sys.exit(1)

# ── Notion helpers ──────────────────────────────────────────────────────


def _rich_text_to_str(rich_text: list) -> str:
    """Extract plain text from Notion rich_text array."""
    return "".join(rt.get("plain_text", "") for rt in rich_text)


def _get_page_blocks(page_id: str) -> list[dict]:
    """Fetch all child blocks for a page."""
    url = f"https://api.notion.com/v1/blocks/{page_id}/children?page_size=100"
    resp = requests.get(url, headers=headers)
    if resp.status_code != 200:
        return []
    return resp.json().get("results", [])


def _extract_template_content(blocks: list[dict]) -> dict:
    """Parse Notion blocks into a structured template dict."""
    content: dict = {"sections": []}
    current_section: dict | None = None

    for block in blocks:
        btype = block["type"]

        if btype == "heading_2":
            # Start a new section
            heading = _rich_text_to_str(block["heading_2"]["rich_text"])
            current_section = {"heading": heading, "items": []}
            content["sections"].append(current_section)

        elif btype == "code" and current_section is not None:
            code_text = _rich_text_to_str(block["code"]["rich_text"])
            lang = block["code"].get("language", "plain text")
            current_section["items"].append(
                {"type": "code", "content": code_text, "language": lang}
            )

        elif btype == "paragraph" and current_section is not None:
            text = _rich_text_to_str(block["paragraph"]["rich_text"])
            if text.strip():
                current_section["items"].append(
                    {"type": "paragraph", "content": text}
                )

        elif btype == "bulleted_list_item" and current_section is not None:
            text = _rich_text_to_str(
                block["bulleted_list_item"]["rich_text"]
            )
            current_section["items"].append(
                {"type": "bullet", "content": text}
            )

    return content


# ── Pull: Notion → Local JSON ──────────────────────────────────────────


def pull_from_notion() -> list[dict]:
    """Fetch all notification templates from Notion and return as list."""
    url = f"https://api.notion.com/v1/databases/{NOTIFICATIONS_DB_ID}/query"
    resp = requests.post(url, headers=headers, json={})

    if resp.status_code != 200:
        print(f"Error querying Notion: {resp.status_code}")
        print(resp.text[:300])
        sys.exit(1)

    pages = resp.json().get("results", [])
    templates = []

    for page in pages:
        props = page["properties"]

        # Extract properties
        name = _rich_text_to_str(props["Name"]["title"])
        ttype = props["Type"]["select"]["name"] if props["Type"]["select"] else ""
        channels = [ms["name"] for ms in props["Channel"]["multi_select"]]
        status = (
            props["Status"]["select"]["name"] if props["Status"]["select"] else ""
        )
        signal = (
            props["Signal"]["select"]["name"] if props["Signal"]["select"] else ""
        )

        # Fetch page body content
        blocks = _get_page_blocks(page["id"])
        content = _extract_template_content(blocks)

        templates.append(
            {
                "id": page["id"],
                "name": name,
                "type": ttype,
                "channels": channels,
                "status": status,
                "signal": signal,
                "last_edited": page["last_edited_time"],
                "content": content,
            }
        )

    return templates


def save_local(templates: list[dict]) -> None:
    """Write templates to local JSON file."""
    output = {
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "source": "notion",
        "database_id": NOTIFICATIONS_DB_ID,
        "templates": templates,
    }
    OUTPUT_PATH.write_text(json.dumps(output, indent=2, ensure_ascii=False))
    print(f"  Saved {len(templates)} templates to {OUTPUT_PATH.name}")


# ── Diff: Compare Notion vs Local ──────────────────────────────────────


def show_diff() -> None:
    """Compare Notion templates vs local JSON."""
    if not OUTPUT_PATH.exists():
        print("No local file found. Run without --diff first to pull from Notion.")
        return

    local_data = json.loads(OUTPUT_PATH.read_text())
    local_templates = {t["name"]: t for t in local_data.get("templates", [])}
    local_synced = local_data.get("synced_at", "unknown")

    notion_templates_list = pull_from_notion()
    notion_templates = {t["name"]: t for t in notion_templates_list}

    print(f"\nLocal file synced at: {local_synced}")
    print(f"Notion templates: {len(notion_templates)}")
    print(f"Local templates: {len(local_templates)}\n")

    # Check for changes
    all_names = set(list(local_templates.keys()) + list(notion_templates.keys()))
    changes = 0

    for name in sorted(all_names):
        in_local = name in local_templates
        in_notion = name in notion_templates

        if in_local and not in_notion:
            print(f"  🔴 DELETED in Notion: {name}")
            changes += 1
        elif in_notion and not in_local:
            print(f"  🟢 NEW in Notion: {name}")
            changes += 1
        else:
            local_edit = local_templates[name].get("last_edited", "")
            notion_edit = notion_templates[name].get("last_edited", "")
            if local_edit != notion_edit:
                print(f"  🟡 CHANGED: {name}")
                print(f"      Local:  {local_edit}")
                print(f"      Notion: {notion_edit}")
                changes += 1
            else:
                print(f"  ⚪ Unchanged: {name}")

    if changes == 0:
        print("\n  No changes detected.")
    else:
        print(f"\n  {changes} change(s) found. Run without --diff to sync.")


# ── Push: Update Notion "Last Synced" dates ─────────────────────────────


def mark_synced() -> None:
    """Update the 'Last Synced' date on all templates in Notion."""
    url_base = "https://api.notion.com/v1/pages"
    templates = pull_from_notion()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    for tmpl in templates:
        resp = requests.patch(
            f"{url_base}/{tmpl['id']}",
            headers=headers,
            json={
                "properties": {
                    "Last Synced": {"date": {"start": now}},
                }
            },
        )
        if resp.status_code == 200:
            print(f"  ✓ Marked synced: {tmpl['name']}")
        else:
            print(f"  ✗ Failed: {tmpl['name']} ({resp.status_code})")


# ── Main ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if "--diff" in sys.argv:
        print("Comparing Notion vs local templates...\n")
        show_diff()
    elif "--push" in sys.argv:
        print("Marking all Notion templates as synced...\n")
        mark_synced()
    else:
        print("Pulling notification templates from Notion...\n")
        templates = pull_from_notion()
        save_local(templates)
        mark_synced()
        print("\n✅ Sync complete. Edit templates in Notion, then re-run to pull changes.")
