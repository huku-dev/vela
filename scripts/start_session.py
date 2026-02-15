#!/usr/bin/env python3
"""
Start-of-session automation script
- Reads pending/next tasks from Notion
- Checks for Agentation annotations (future integration)
- Gives a quick status update
"""
import json
import sys
import subprocess
import requests
from datetime import datetime, timedelta

# Load config
with open('.notion-config.json', 'r') as f:
    config = json.load(f)

NOTION_TOKEN = config['notion_token']
TASKS_DB_ID = config['tasks_db_id']
CHANGELOG_DB_ID = config['changelog_db_id']
NOTION_VERSION = '2022-06-28'

headers = {
    'Authorization': f'Bearer {NOTION_TOKEN}',
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION
}

def get_tasks(status_filter=None):
    """Get tasks from Notion"""
    url = f'https://api.notion.com/v1/databases/{TASKS_DB_ID}/query'

    filter_obj = {}
    if status_filter:
        filter_obj = {
            'property': 'Status',
            'select': {'equals': status_filter}
        }

    data = {'filter': filter_obj} if status_filter else {}

    response = requests.post(url, headers=headers, json=data)
    if response.status_code != 200:
        return []

    results = response.json().get('results', [])

    tasks = []
    for page in results:
        props = page['properties']
        task = {
            'task': props.get('Task', {}).get('title', [{}])[0].get('text', {}).get('content', ''),
            'status': props.get('Status', {}).get('select', {}).get('name', ''),
            'area': props.get('Area', {}).get('select', {}).get('name', ''),
            'priority': props.get('Priority', {}).get('select', {}).get('name', ''),
        }
        tasks.append(task)

    return tasks

def get_recent_changelog_entries(days=7):
    """Get recent changelog entries"""
    url = f'https://api.notion.com/v1/databases/{CHANGELOG_DB_ID}/query'

    # Get entries from last N days
    since_date = (datetime.now() - timedelta(days=days)).isoformat()

    data = {
        'filter': {
            'property': 'Date',
            'date': {
                'after': since_date
            }
        },
        'sorts': [
            {
                'property': 'Date',
                'direction': 'descending'
            }
        ],
        'page_size': 5
    }

    response = requests.post(url, headers=headers, json=data)
    if response.status_code != 200:
        return []

    results = response.json().get('results', [])

    entries = []
    for page in results:
        props = page['properties']
        entry = {
            'summary': props.get('Summary', {}).get('title', [{}])[0].get('text', {}).get('content', ''),
            'area': props.get('Area', {}).get('select', {}).get('name', ''),
            'date': props.get('Date', {}).get('date', {}).get('start', ''),
        }
        entries.append(entry)

    return entries

def get_git_status():
    """Get current git branch and uncommitted changes"""
    try:
        branch = subprocess.check_output(
            ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
            stderr=subprocess.STDOUT,
            text=True
        ).strip()

        status = subprocess.check_output(
            ['git', 'status', '--short'],
            stderr=subprocess.STDOUT,
            text=True
        ).strip()

        return branch, status
    except:
        return None, None

def main():
    print("\n" + "="*60)
    print("🚀 START OF SESSION - Status Update")
    print("="*60)

    # Git status
    branch, git_status = get_git_status()
    if branch:
        print(f"\n📌 Current branch: {branch}")
        if git_status:
            print(f"⚠️  Uncommitted changes:")
            for line in git_status.split('\n')[:5]:
                print(f"   {line}")
            if len(git_status.split('\n')) > 5:
                print(f"   ... and {len(git_status.split('\n')) - 5} more")
        else:
            print("✓ Working directory clean")

    # Recent changes
    print("\n" + "-"*60)
    print("📝 RECENT CHANGES (last 7 days)")
    print("-"*60)

    recent_changes = get_recent_changelog_entries()
    if recent_changes:
        for entry in recent_changes:
            area = entry.get('area', 'Other')
            summary = entry.get('summary', 'No summary')
            print(f"  [{area}] {summary}")
    else:
        print("  No recent changes")

    # Tasks status
    print("\n" + "-"*60)
    print("✅ YOUR TASKS")
    print("-"*60)

    # In Progress tasks
    in_progress = get_tasks('In progress')
    if in_progress:
        print("\n🔄 IN PROGRESS:")
        for task in in_progress:
            priority = task.get('priority', 'Medium')
            area = task.get('area', 'Other')
            print(f"  [{area}] {task['task']} (Priority: {priority})")
    else:
        print("\n🔄 IN PROGRESS: None")

    # Next tasks
    next_tasks = get_tasks('Next')
    if next_tasks:
        print("\n⏭️  NEXT (ready to work on):")
        for task in next_tasks:
            priority = task.get('priority', 'Medium')
            area = task.get('area', 'Other')
            print(f"  [{area}] {task['task']} (Priority: {priority})")
    else:
        print("\n⏭️  NEXT: None")

    # Backlog count
    backlog = get_tasks('Backlog')
    if backlog:
        print(f"\n📋 BACKLOG: {len(backlog)} tasks")
        high_priority = [t for t in backlog if t.get('priority') == 'High']
        if high_priority:
            print(f"   ⚠️  {len(high_priority)} high-priority items in backlog")

    # Agentation check (future)
    print("\n" + "-"*60)
    print("🎨 AGENTATION ANNOTATIONS")
    print("-"*60)
    print("  (Check browser when running 'npm run dev')")
    print("  Annotations will appear in the toolbar context automatically")

    # Summary
    print("\n" + "="*60)
    print("💡 WHAT TO WORK ON?")
    print("="*60)

    if in_progress:
        print("\n👉 Continue with in-progress tasks, or...")

    if next_tasks:
        print("👉 Start one of the 'Next' tasks, or...")

    print("👉 Tell me what you'd like to build!")

    print("\n" + "="*60)
    print("Ready to code! 🚀")
    print("="*60 + "\n")

if __name__ == '__main__':
    main()
