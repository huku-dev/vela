#!/usr/bin/env python3
"""
End-of-session automation script
- Summarizes recent git changes (Changelog auto-updates already)
- Prompts for important decisions to log
- Prompts for follow-up tasks to add
- Links everything to the Claude conversation
"""
import json
import sys
import subprocess
import requests
from datetime import datetime

# Load config
with open('.notion-config.json', 'r') as f:
    config = json.load(f)

NOTION_TOKEN = config['notion_token']
DECISIONS_DB_ID = config['decisions_db_id']
TASKS_DB_ID = config['tasks_db_id']
NOTION_VERSION = '2022-06-28'

headers = {
    'Authorization': f'Bearer {NOTION_TOKEN}',
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION
}

def get_conversation_url():
    """Try to get the current Claude conversation URL"""
    # This would need to be passed as an environment variable or argument
    # For now, we'll prompt for it
    return input("\n📎 Paste Claude conversation URL (or press Enter to skip): ").strip()

def get_recent_commits(count=5):
    """Get recent commit messages"""
    try:
        commits = subprocess.check_output(
            ['git', 'log', f'-{count}', '--pretty=format:%h - %s (%cr)'],
            stderr=subprocess.STDOUT,
            text=True
        )
        return commits
    except:
        return None

def create_decision(decision, why, alternatives='', context_url=''):
    """Create a decision entry in Notion"""
    url = 'https://api.notion.com/v1/pages'

    # Build the Why field with context link
    why_text = why
    if context_url:
        why_text += f"\n\nContext: {context_url}"

    data = {
        'parent': {'database_id': DECISIONS_DB_ID},
        'properties': {
            'Decision': {
                'title': [{'text': {'content': decision}}]
            },
            'Date': {
                'date': {'start': datetime.now().isoformat()}
            },
            'Why': {
                'rich_text': [{'text': {'content': why_text}}]
            },
            'Alternatives considered': {
                'rich_text': [{'text': {'content': alternatives}}] if alternatives else []
            },
            'Status': {
                'select': {'name': 'Active'}
            }
        }
    }

    response = requests.post(url, headers=headers, json=data)
    if response.status_code != 200:
        print(f"❌ Error creating decision: {response.text}")
        return False

    return True

def create_task(task, status='Backlog', area='Other', priority='Medium', description='', context_url=''):
    """Create a task in Notion"""
    url = 'https://api.notion.com/v1/pages'

    # Build description with context link
    desc_text = description
    if context_url:
        desc_text += f"\n\nContext: {context_url}"

    data = {
        'parent': {'database_id': TASKS_DB_ID},
        'properties': {
            'Task': {
                'title': [{'text': {'content': task}}]
            },
            'Status': {
                'select': {'name': status}
            },
            'Area': {
                'select': {'name': area}
            },
            'Priority': {
                'select': {'name': priority}
            },
            'Description': {
                'rich_text': [{'text': {'content': desc_text}}] if desc_text else []
            },
            'Source': {
                'select': {'name': 'Conversation'}
            }
        }
    }

    response = requests.post(url, headers=headers, json=data)
    if response.status_code != 200:
        print(f"❌ Error creating task: {response.text}")
        return False

    return True

def main():
    print("\n" + "="*60)
    print("🏁 END OF SESSION - Documentation Sync")
    print("="*60)

    # Get conversation URL
    conversation_url = get_conversation_url()

    # Show recent commits
    print("\n📝 Recent commits (Changelog auto-updated):")
    commits = get_recent_commits()
    if commits:
        print(commits)
    else:
        print("   No recent commits found")

    # Log decisions
    print("\n" + "-"*60)
    print("🧭 DECISIONS LOG")
    print("-"*60)
    print("Did you make any important decisions this session?")
    print("(Examples: Changed signal parameters, chose a library, picked a design pattern)")

    while True:
        decision = input("\nDecision (or press Enter to skip): ").strip()
        if not decision:
            break

        why = input("Why did you make this decision? ").strip()
        alternatives = input("What alternatives did you consider? (optional): ").strip()

        if create_decision(decision, why, alternatives, conversation_url):
            print("✓ Decision logged to Notion")

        another = input("\nLog another decision? (y/n): ").strip().lower()
        if another != 'y':
            break

    # Add follow-up tasks
    print("\n" + "-"*60)
    print("✅ FOLLOW-UP TASKS")
    print("-"*60)
    print("Any follow-up tasks for next session?")
    print("(Examples: Deploy to production, Add tests, Fix bug in X)")

    while True:
        task = input("\nTask (or press Enter to skip): ").strip()
        if not task:
            break

        # Quick inputs
        status = input("Status (Backlog/Next/In progress) [Backlog]: ").strip() or 'Backlog'
        area = input("Area (Signals/Data/UI/Infra/Product/Design/Other) [Other]: ").strip() or 'Other'
        priority = input("Priority (Low/Medium/High) [Medium]: ").strip() or 'Medium'
        description = input("Description (optional): ").strip()

        if create_task(task, status, area, priority, description, conversation_url):
            print(f"✓ Task added to Notion: {task}")

        another = input("\nAdd another task? (y/n): ").strip().lower()
        if another != 'y':
            break

    # Summary
    print("\n" + "="*60)
    print("✅ Session documentation complete!")
    print("="*60)
    print("\nWhat was updated:")
    print("  📝 Changelog - Auto-updated from git commits")
    print("  🧭 Decisions - Logged with context links")
    print("  ✅ Tasks - Added with context links")
    if conversation_url:
        print(f"\n  🔗 Linked to: {conversation_url}")
    print("\n👋 See you next session!")

if __name__ == '__main__':
    main()
