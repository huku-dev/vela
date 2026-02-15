#!/usr/bin/env python3
"""
Git hook script that automatically creates Notion changelog entries
from git commits using Claude API
"""
import json
import os
import sys
import subprocess
import requests
from datetime import datetime

# Load config
config_path = os.path.join(os.path.dirname(__file__), '..', '.notion-config.json')
with open(config_path, 'r') as f:
    config = json.load(f)

NOTION_TOKEN = config['notion_token']
CHANGELOG_DB_ID = config['changelog_db_id']
NOTION_VERSION = '2022-06-28'

notion_headers = {
    'Authorization': f'Bearer {NOTION_TOKEN}',
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION
}

def get_git_diff():
    """Get the diff of the last commit"""
    try:
        diff = subprocess.check_output(
            ['git', 'diff', 'HEAD~1', 'HEAD'],
            stderr=subprocess.STDOUT,
            text=True
        )
        return diff
    except subprocess.CalledProcessError:
        # If HEAD~1 doesn't exist (first commit), get all changes
        try:
            diff = subprocess.check_output(
                ['git', 'diff', '--cached'],
                stderr=subprocess.STDOUT,
                text=True
            )
            return diff
        except:
            return ""

def get_commit_message():
    """Get the last commit message"""
    try:
        msg = subprocess.check_output(
            ['git', 'log', '-1', '--pretty=%B'],
            stderr=subprocess.STDOUT,
            text=True
        )
        return msg.strip()
    except:
        return ""

def get_changed_files():
    """Get list of changed files"""
    try:
        files = subprocess.check_output(
            ['git', 'diff', '--name-only', 'HEAD~1', 'HEAD'],
            stderr=subprocess.STDOUT,
            text=True
        )
        return files.strip().split('\n')
    except:
        try:
            files = subprocess.check_output(
                ['git', 'diff', '--cached', '--name-only'],
                stderr=subprocess.STDOUT,
                text=True
            )
            return files.strip().split('\n')
        except:
            return []

def analyze_with_claude(commit_msg, diff, files):
    """Use Claude API to analyze the changes and generate changelog entry"""
    # Check for Claude API key
    claude_api_key = os.environ.get('ANTHROPIC_API_KEY')
    if not claude_api_key:
        # Fallback to simple parsing if no API key
        return create_simple_entry(commit_msg, files)

    try:
        # Truncate diff if too long
        max_diff_length = 8000
        if len(diff) > max_diff_length:
            diff = diff[:max_diff_length] + "\n\n... (truncated)"

        prompt = f"""Analyze this git commit and create a changelog entry.

Commit message: {commit_msg}

Changed files:
{chr(10).join(files)}

Git diff:
{diff}

Please respond with a JSON object containing:
- "summary": One-line summary (under 80 chars)
- "detail": 2-4 sentences explaining the change in plain English
- "area": One of: Signals, Data, UI, Infra, Risk controls, Other
- "impact": One of: User-facing, Internal, Breaking

Example response:
{{
  "summary": "Added real-time price updates to dashboard",
  "detail": "Implemented WebSocket connection to fetch live crypto prices every 5 seconds instead of polling every 15 minutes. Users will now see prices update in real-time without page refresh.",
  "area": "Data",
  "impact": "User-facing"
}}

Respond only with the JSON object, no other text."""

        response = requests.post(
            'https://api.anthropic.com/v1/messages',
            headers={
                'x-api-key': claude_api_key,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
            },
            json={
                'model': 'claude-3-5-sonnet-20241022',
                'max_tokens': 1024,
                'messages': [{
                    'role': 'user',
                    'content': prompt
                }]
            },
            timeout=30
        )

        if response.status_code != 200:
            print(f"⚠️  Claude API error: {response.text}")
            return create_simple_entry(commit_msg, files)

        result = response.json()
        content = result['content'][0]['text']

        # Extract JSON from response
        import re
        json_match = re.search(r'\{.*\}', content, re.DOTALL)
        if json_match:
            entry = json.loads(json_match.group())
            return entry
        else:
            return create_simple_entry(commit_msg, files)

    except Exception as e:
        print(f"⚠️  Error calling Claude API: {e}")
        return create_simple_entry(commit_msg, files)

def create_simple_entry(commit_msg, files):
    """Create a simple changelog entry without AI"""
    # Determine area based on file paths
    area = "Other"
    if any('src/components' in f or 'src/pages' in f for f in files):
        area = "UI"
    elif any('src/hooks' in f or 'src/lib' in f for f in files):
        area = "Data"
    elif any('package.json' in f or 'vite' in f or '.config' in f for f in files):
        area = "Infra"

    # Determine impact
    impact = "Internal"
    if area == "UI":
        impact = "User-facing"
    elif 'package.json' in files or any('.env' in f for f in files):
        impact = "Breaking"

    return {
        "summary": commit_msg[:80] if commit_msg else "Code update",
        "detail": f"Updated {len(files)} file(s): {', '.join([os.path.basename(f) for f in files[:3]])}{'...' if len(files) > 3 else ''}",
        "area": area,
        "impact": impact
    }

def create_notion_entry(entry):
    """Create a changelog entry in Notion"""
    url = 'https://api.notion.com/v1/pages'

    # Read package.json for version
    version = "0.2.0"  # default
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
                'title': [{'text': {'content': entry['summary']}}]
            },
            'Date': {
                'date': {'start': datetime.now().isoformat()}
            },
            'Area': {
                'select': {'name': entry['area']}
            },
            'Detail': {
                'rich_text': [{'text': {'content': entry['detail']}}]
            },
            'Version': {
                'rich_text': [{'text': {'content': version}}]
            },
            'Status': {
                'select': {'name': 'Deployed'}
            },
            'Impact': {
                'select': {'name': entry['impact']}
            }
        }
    }

    response = requests.post(url, headers=notion_headers, json=data)
    if response.status_code != 200:
        print(f"❌ Error creating Notion entry: {response.text}")
        return False

    print(f"✅ Changelog entry created: {entry['summary']}")
    return True

def main():
    # Check if we're in a git repo
    try:
        subprocess.check_output(['git', 'rev-parse', '--git-dir'], stderr=subprocess.STDOUT)
    except:
        print("Not in a git repository, skipping Notion update")
        sys.exit(0)

    print("📝 Generating changelog entry from commit...")

    commit_msg = get_commit_message()
    if not commit_msg:
        print("⚠️  No commit message found, skipping")
        sys.exit(0)

    # Skip if commit message starts with [skip-notion]
    if commit_msg.startswith('[skip-notion]'):
        print("ℹ️  Skipping Notion update (commit tagged [skip-notion])")
        sys.exit(0)

    diff = get_git_diff()
    files = get_changed_files()

    if not files or files == ['']:
        print("⚠️  No files changed, skipping")
        sys.exit(0)

    entry = analyze_with_claude(commit_msg, diff, files)
    success = create_notion_entry(entry)

    if success:
        print(f"🎉 Notion updated!")
    else:
        print("⚠️  Failed to update Notion, but commit succeeded")

    sys.exit(0)

if __name__ == '__main__':
    main()
