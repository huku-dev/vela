#!/usr/bin/env python3
"""
Read and write tasks to/from Notion Tasks & Roadmap database
"""
import json
import sys
import requests
from datetime import datetime

# Load config
with open('.notion-config.json', 'r') as f:
    config = json.load(f)

NOTION_TOKEN = config['notion_token']
TASKS_DB_ID = config['tasks_db_id']
NOTION_VERSION = '2022-06-28'

headers = {
    'Authorization': f'Bearer {NOTION_TOKEN}',
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION
}

def list_tasks(status_filter=None):
    """List all tasks, optionally filtered by status"""
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
        print(f"Error fetching tasks: {response.text}")
        return []

    results = response.json().get('results', [])

    tasks = []
    for page in results:
        props = page['properties']

        task = {
            'id': page['id'],
            'task': props.get('Task', {}).get('title', [{}])[0].get('text', {}).get('content', ''),
            'status': props.get('Status', {}).get('select', {}).get('name', ''),
            'area': props.get('Area', {}).get('select', {}).get('name', ''),
            'priority': props.get('Priority', {}).get('select', {}).get('name', ''),
            'description': props.get('Description', {}).get('rich_text', [{}])[0].get('text', {}).get('content', ''),
            'source': props.get('Source', {}).get('select', {}).get('name', ''),
        }
        tasks.append(task)

    return tasks

def create_task(task, status='Backlog', area='Other', priority='Medium', description='', source='Claude added'):
    """Create a new task in Notion"""
    url = 'https://api.notion.com/v1/pages'

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
                'rich_text': [{'text': {'content': description}}] if description else []
            },
            'Source': {
                'select': {'name': source}
            }
        }
    }

    response = requests.post(url, headers=headers, json=data)
    if response.status_code != 200:
        print(f"Error creating task: {response.text}")
        return None

    return response.json()

def update_task_status(task_id, new_status):
    """Update the status of a task"""
    url = f'https://api.notion.com/v1/pages/{task_id}'

    data = {
        'properties': {
            'Status': {
                'select': {'name': new_status}
            }
        }
    }

    response = requests.patch(url, headers=headers, json=data)
    if response.status_code != 200:
        print(f"Error updating task: {response.text}")
        return None

    return response.json()

def main():
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python3 notion_tasks.py list [status]")
        print("  python3 notion_tasks.py add 'Task name' [status] [area] [priority] [description]")
        print("  python3 notion_tasks.py update <task_id> <new_status>")
        sys.exit(1)

    command = sys.argv[1]

    if command == 'list':
        status_filter = sys.argv[2] if len(sys.argv) > 2 else None
        tasks = list_tasks(status_filter)

        if not tasks:
            print("No tasks found")
            return

        # Print as JSON for Claude to parse
        print(json.dumps(tasks, indent=2))

    elif command == 'add':
        if len(sys.argv) < 3:
            print("Error: Task name required")
            sys.exit(1)

        task_name = sys.argv[2]
        status = sys.argv[3] if len(sys.argv) > 3 else 'Backlog'
        area = sys.argv[4] if len(sys.argv) > 4 else 'Other'
        priority = sys.argv[5] if len(sys.argv) > 5 else 'Medium'
        description = sys.argv[6] if len(sys.argv) > 6 else ''

        result = create_task(task_name, status, area, priority, description)
        if result:
            print(f"✓ Created task: {task_name}")
            print(f"  Status: {status}, Area: {area}, Priority: {priority}")

    elif command == 'update':
        if len(sys.argv) < 4:
            print("Error: task_id and new_status required")
            sys.exit(1)

        task_id = sys.argv[2]
        new_status = sys.argv[3]

        result = update_task_status(task_id, new_status)
        if result:
            print(f"✓ Updated task to: {new_status}")

    else:
        print(f"Unknown command: {command}")
        sys.exit(1)

if __name__ == '__main__':
    main()
