#!/usr/bin/env python3
"""
Add initial changelog entry documenting the Notion integration setup
"""
import json
import requests
from datetime import datetime

# Load config
with open('.notion-config.json', 'r') as f:
    config = json.load(f)

NOTION_TOKEN = config['notion_token']
CHANGELOG_DB_ID = config['changelog_db_id']
NOTION_VERSION = '2022-06-28'

headers = {
    'Authorization': f'Bearer {NOTION_TOKEN}',
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION
}

def create_changelog_entry(summary, detail, area, impact, status='Deployed'):
    """Create a changelog entry in Notion"""
    url = 'https://api.notion.com/v1/pages'

    # Read package.json for version
    version = "0.2.0"
    try:
        with open('package.json', 'r') as f:
            pkg = json.load(f)
            version = pkg.get('version', version)
    except:
        pass

    data = {
        'parent': {'database_id': CHANGELOG_DB_ID},
        'properties': {
            'Summary': {
                'title': [{'text': {'content': summary}}]
            },
            'Date': {
                'date': {'start': datetime.now().isoformat()}
            },
            'Area': {
                'select': {'name': area}
            },
            'Detail': {
                'rich_text': [{'text': {'content': detail}}]
            },
            'Version': {
                'rich_text': [{'text': {'content': version}}]
            },
            'Status': {
                'select': {'name': status}
            },
            'Impact': {
                'select': {'name': impact}
            }
        }
    }

    response = requests.post(url, headers=headers, json=data)
    if response.status_code != 200:
        print(f"Error creating entry: {response.text}")
        return False

    print(f"✓ Created: {summary}")
    return True

def main():
    print("📝 Adding initial changelog entries...\n")

    # Entry 1: Notion integration
    create_changelog_entry(
        summary="Automated Notion documentation system",
        detail="Set up automated documentation workspace in Notion with Changelog, Decisions, and Tasks databases. Created git post-commit hook that uses Claude API to automatically generate plain-English changelog entries from code changes. Overview section populated with system architecture and glossary.",
        area="Infra",
        impact="Internal",
        status="Deployed"
    )

    # Entry 2: Initial setup
    create_changelog_entry(
        summary="Initial Vela frontend setup",
        detail="React + TypeScript frontend built with Vite and Material-UI. Displays crypto trading signals from Supabase database with real-time price data from CoinGecko. Shows signal cards, briefs, and paper trade performance tracking.",
        area="UI",
        impact="User-facing",
        status="Deployed"
    )

    print("\n✅ Initial changelog entries created!")

if __name__ == '__main__':
    main()
