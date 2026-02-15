#!/usr/bin/env python3
"""
Setup script to create Vela documentation structure in Notion
"""
import json
import os
import sys
import requests
from datetime import datetime

# Load config
with open('.notion-config.json', 'r') as f:
    config = json.load(f)

NOTION_TOKEN = config['notion_token']
NOTION_VERSION = '2022-06-28'

headers = {
    'Authorization': f'Bearer {NOTION_TOKEN}',
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION
}

def create_page(parent_id, title, emoji='📄'):
    """Create a new page in Notion"""
    url = 'https://api.notion.com/v1/pages'
    data = {
        'parent': {'page_id': parent_id} if parent_id else {'workspace': True},
        'icon': {'type': 'emoji', 'emoji': emoji},
        'properties': {
            'title': {
                'title': [{'text': {'content': title}}]
            }
        }
    }

    response = requests.post(url, headers=headers, json=data)
    if response.status_code != 200:
        print(f"Error creating page '{title}': {response.text}")
        return None
    return response.json()

def add_heading(page_id, text, level=2):
    """Add a heading block to a page"""
    url = 'https://api.notion.com/v1/blocks/{}/children'.format(page_id)
    heading_type = f'heading_{level}'
    data = {
        'children': [{
            'object': 'block',
            'type': heading_type,
            heading_type: {
                'rich_text': [{'text': {'content': text}}]
            }
        }]
    }

    response = requests.patch(url, headers=headers, json=data)
    return response.json()

def add_paragraph(page_id, text):
    """Add a paragraph block to a page"""
    url = f'https://api.notion.com/v1/blocks/{page_id}/children'
    data = {
        'children': [{
            'object': 'block',
            'type': 'paragraph',
            'paragraph': {
                'rich_text': [{'text': {'content': text}}]
            }
        }]
    }

    response = requests.patch(url, headers=headers, json=data)
    return response.json()

def create_database(parent_id, title, properties):
    """Create a database in Notion"""
    url = 'https://api.notion.com/v1/databases'
    data = {
        'parent': {'page_id': parent_id},
        'title': [{'text': {'content': title}}],
        'properties': properties
    }

    response = requests.post(url, headers=headers, json=data)
    if response.status_code != 200:
        print(f"Error creating database '{title}': {response.text}")
        return None
    return response.json()

def search_pages(query):
    """Search for pages in Notion"""
    url = 'https://api.notion.com/v1/search'
    data = {
        'query': query,
        'filter': {'property': 'object', 'value': 'page'}
    }

    response = requests.post(url, headers=headers, json=data)
    if response.status_code != 200:
        print(f"Error searching: {response.text}")
        return None
    return response.json()

def main():
    print("🚀 Setting up Vela documentation in Notion...")

    # Search for existing Vela page
    print("\n1. Searching for 'Vela' page...")
    search_results = search_pages('Vela')

    vela_page = None
    if search_results and search_results.get('results'):
        # Check if any result is titled "Vela"
        for result in search_results['results']:
            if result.get('properties', {}).get('title', {}).get('title'):
                title_text = result['properties']['title']['title'][0]['text']['content']
                if title_text == 'Vela':
                    vela_page = result
                    print(f"   ✓ Found existing 'Vela' page: {result['id']}")
                    break

    if not vela_page:
        print("   ℹ️  No 'Vela' page found. Please create a page called 'Vela' in your Notion workspace")
        print("   and share it with your integration, then run this script again.")
        sys.exit(1)

    vela_page_id = vela_page['id'].replace('-', '')

    # Save page ID for future use
    config['vela_page_id'] = vela_page_id
    with open('.notion-config.json', 'w') as f:
        json.dump(config, f, indent=2)

    print(f"\n2. Creating structure in Vela page...")

    # Add Overview section
    print("   • Adding Overview section...")
    add_heading(vela_page_id, '📋 Overview', 1)
    add_paragraph(vela_page_id, 'This is your central reference for the Vela crypto trading signal system.')

    # Create Changelog database
    print("   • Creating Changelog database...")
    changelog_db = create_database(
        vela_page_id,
        'Changelog',
        {
            'Summary': {'title': {}},
            'Date': {'date': {}},
            'Area': {
                'select': {
                    'options': [
                        {'name': 'Signals', 'color': 'blue'},
                        {'name': 'Data', 'color': 'green'},
                        {'name': 'UI', 'color': 'purple'},
                        {'name': 'Infra', 'color': 'orange'},
                        {'name': 'Risk controls', 'color': 'red'},
                        {'name': 'Other', 'color': 'gray'}
                    ]
                }
            },
            'Detail': {'rich_text': {}},
            'Version': {'rich_text': {}},
            'Status': {
                'select': {
                    'options': [
                        {'name': 'Deployed', 'color': 'green'},
                        {'name': 'Testing', 'color': 'yellow'},
                        {'name': 'Rolled back', 'color': 'red'}
                    ]
                }
            },
            'Impact': {
                'select': {
                    'options': [
                        {'name': 'User-facing', 'color': 'blue'},
                        {'name': 'Internal', 'color': 'gray'},
                        {'name': 'Breaking', 'color': 'red'}
                    ]
                }
            }
        }
    )

    if changelog_db:
        config['changelog_db_id'] = changelog_db['id'].replace('-', '')
        print(f"   ✓ Changelog database created")

    # Create Decisions database
    print("   • Creating Decisions database...")
    decisions_db = create_database(
        vela_page_id,
        'Decisions',
        {
            'Decision': {'title': {}},
            'Date': {'date': {}},
            'Why': {'rich_text': {}},
            'Alternatives considered': {'rich_text': {}},
            'Status': {
                'select': {
                    'options': [
                        {'name': 'Active', 'color': 'green'},
                        {'name': 'Replaced', 'color': 'yellow'},
                        {'name': 'Deprecated', 'color': 'red'}
                    ]
                }
            }
        }
    )

    if decisions_db:
        config['decisions_db_id'] = decisions_db['id'].replace('-', '')
        print(f"   ✓ Decisions database created")

    # Create Tasks database
    print("   • Creating Tasks database...")
    tasks_db = create_database(
        vela_page_id,
        'Tasks & Roadmap',
        {
            'Task': {'title': {}},
            'Status': {
                'select': {
                    'options': [
                        {'name': 'Backlog', 'color': 'gray'},
                        {'name': 'Next', 'color': 'blue'},
                        {'name': 'In progress', 'color': 'yellow'},
                        {'name': 'Blocked', 'color': 'red'},
                        {'name': 'Done', 'color': 'green'}
                    ]
                }
            },
            'Area': {
                'select': {
                    'options': [
                        {'name': 'Signals', 'color': 'blue'},
                        {'name': 'Data', 'color': 'green'},
                        {'name': 'UI', 'color': 'purple'},
                        {'name': 'Infra', 'color': 'orange'},
                        {'name': 'Risk controls', 'color': 'red'},
                        {'name': 'Other', 'color': 'gray'}
                    ]
                }
            },
            'Priority': {
                'select': {
                    'options': [
                        {'name': 'Low', 'color': 'gray'},
                        {'name': 'Medium', 'color': 'yellow'},
                        {'name': 'High', 'color': 'red'}
                    ]
                }
            }
        }
    )

    if tasks_db:
        config['tasks_db_id'] = tasks_db['id'].replace('-', '')
        print(f"   ✓ Tasks database created")

    # Save all database IDs
    with open('.notion-config.json', 'w') as f:
        json.dump(config, f, indent=2)

    print(f"\n✅ Notion setup complete!")
    print(f"\n📝 Your Vela page: https://notion.so/{vela_page_id}")
    print(f"\n💾 Configuration saved to .notion-config.json")

if __name__ == '__main__':
    main()
