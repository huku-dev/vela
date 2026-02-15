#!/usr/bin/env python3
"""
Add User Feedback database and Metrics Dashboard page to Notion
"""
import json
import requests

# Load config
with open('.notion-config.json', 'r') as f:
    config = json.load(f)

NOTION_TOKEN = config['notion_token']
VELA_PAGE_ID = config['vela_page_id']
PRODUCT_PAGE_ID = config.get('product_page_id')
NOTION_VERSION = '2022-06-28'

headers = {
    'Authorization': f'Bearer {NOTION_TOKEN}',
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION
}

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

def create_page(parent_id, title, emoji='📄'):
    """Create a new page in Notion"""
    url = 'https://api.notion.com/v1/pages'

    data = {
        'parent': {'page_id': parent_id},
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

def add_blocks(page_id, blocks):
    """Add multiple blocks to a page"""
    url = f'https://api.notion.com/v1/blocks/{page_id}/children'

    # Notion API limits to 100 blocks per request
    for i in range(0, len(blocks), 100):
        chunk = blocks[i:i+100]
        data = {'children': chunk}
        response = requests.patch(url, headers=headers, json=data)
        if response.status_code != 200:
            print(f"Error adding blocks: {response.text}")
            return None

    return True

def heading(level, text):
    heading_type = f'heading_{level}'
    return {
        'object': 'block',
        'type': heading_type,
        heading_type: {'rich_text': [{'text': {'content': text}}]}
    }

def paragraph(text):
    return {
        'object': 'block',
        'type': 'paragraph',
        'paragraph': {'rich_text': [{'text': {'content': text}}]}
    }

def bulleted_list_item(text):
    return {
        'object': 'block',
        'type': 'bulleted_list_item',
        'bulleted_list_item': {'rich_text': [{'text': {'content': text}}]}
    }

def callout(emoji, text):
    return {
        'object': 'block',
        'type': 'callout',
        'callout': {
            'icon': {'type': 'emoji', 'emoji': emoji},
            'rich_text': [{'text': {'content': text}}]
        }
    }

def main():
    print("📝 Adding User Feedback database and Metrics Dashboard...\n")

    # 1. Add User Feedback database to Product page
    if PRODUCT_PAGE_ID:
        print("1. Creating User Feedback database in Product page...")
        user_feedback_db = create_database(
            PRODUCT_PAGE_ID,
            'User Feedback',
            {
                'Feedback': {'title': {}},
                'Date': {'date': {}},
                'User': {'rich_text': {}},
                'Category': {
                    'select': {
                        'options': [
                            {'name': 'Feature Request', 'color': 'blue'},
                            {'name': 'Bug Report', 'color': 'red'},
                            {'name': 'UX Improvement', 'color': 'purple'},
                            {'name': 'Signal Accuracy', 'color': 'green'},
                            {'name': 'Performance', 'color': 'orange'},
                            {'name': 'General', 'color': 'gray'}
                        ]
                    }
                },
                'Priority': {
                    'select': {
                        'options': [
                            {'name': 'Critical', 'color': 'red'},
                            {'name': 'High', 'color': 'orange'},
                            {'name': 'Medium', 'color': 'yellow'},
                            {'name': 'Low', 'color': 'gray'},
                            {'name': 'Nice to have', 'color': 'blue'}
                        ]
                    }
                },
                'Status': {
                    'select': {
                        'options': [
                            {'name': 'New', 'color': 'gray'},
                            {'name': 'Reviewing', 'color': 'yellow'},
                            {'name': 'Planned', 'color': 'blue'},
                            {'name': 'In Progress', 'color': 'purple'},
                            {'name': 'Implemented', 'color': 'green'},
                            {'name': 'Wont Fix', 'color': 'red'}
                        ]
                    }
                },
                'Details': {'rich_text': {}},
                'Impact': {
                    'select': {
                        'options': [
                            {'name': 'High - Many users', 'color': 'red'},
                            {'name': 'Medium - Some users', 'color': 'yellow'},
                            {'name': 'Low - Few users', 'color': 'gray'}
                        ]
                    }
                }
            }
        )

        if user_feedback_db:
            config['user_feedback_db_id'] = user_feedback_db['id'].replace('-', '')
            print("   ✓ User Feedback database created")

    # 2. Create Metrics Dashboard page
    print("2. Creating Metrics Dashboard page...")
    metrics_page = create_page(VELA_PAGE_ID, 'Metrics Dashboard', '📈')

    if metrics_page:
        config['metrics_page_id'] = metrics_page['id'].replace('-', '')

        metrics_blocks = [
            heading(1, 'Metrics Dashboard'),
            callout('📊', 'Track key performance indicators for Vela\'s trading signals and product health.'),

            heading(2, 'Signal Performance Metrics'),
            paragraph('Updated: Manual entry from Supabase paper_trade_stats table'),
            paragraph(''),
            paragraph('🎯 Win Rate: __%'),
            paragraph('📈 Total Trades: __'),
            paragraph('💰 Average P&L: __%'),
            paragraph('📉 Max Drawdown: __%'),
            paragraph('⏱️ Average Hold Time: __ hours'),
            paragraph(''),

            heading(2, 'Per-Asset Performance'),
            paragraph('Break down by cryptocurrency:'),
            paragraph(''),
            paragraph('BTC:'),
            bulleted_list_item('Win rate: __%'),
            bulleted_list_item('Total trades: __'),
            bulleted_list_item('Avg P&L: __%'),
            paragraph(''),
            paragraph('ETH:'),
            bulleted_list_item('Win rate: __%'),
            bulleted_list_item('Total trades: __'),
            bulleted_list_item('Avg P&L: __%'),
            paragraph(''),
            paragraph('HYPE:'),
            bulleted_list_item('Win rate: __%'),
            bulleted_list_item('Total trades: __'),
            bulleted_list_item('Avg P&L: __%'),

            heading(2, 'Product Usage Metrics (Future)'),
            paragraph('To be implemented once we have user tracking:'),
            bulleted_list_item('Daily Active Users (DAU)'),
            bulleted_list_item('Weekly Active Users (WAU)'),
            bulleted_list_item('Average session duration'),
            bulleted_list_item('Pages per session'),
            bulleted_list_item('Signal detail views'),
            bulleted_list_item('Notification click-through rate'),

            heading(2, 'Technical Health'),
            paragraph('Infrastructure and performance metrics:'),
            paragraph(''),
            paragraph('⏱️ Frontend Load Time: __ seconds'),
            paragraph('🔄 Data Refresh Latency: __ seconds'),
            paragraph('❌ Error Rate: __%'),
            paragraph('🌐 API Success Rate: __%'),
            paragraph('📡 CoinGecko API Calls: __ / day'),

            heading(2, 'How to Update This Dashboard'),
            callout('💡', 'Run SQL queries in Supabase to get these metrics, then manually update this page. Future: automate with Supabase functions or scheduled scripts.'),

            paragraph('Example query for win rate:'),
            paragraph(''),
            paragraph('SELECT'),
            paragraph('  COUNT(*) FILTER (WHERE pnl_pct > 0) * 100.0 / COUNT(*) as win_rate,'),
            paragraph('  COUNT(*) as total_trades,'),
            paragraph('  AVG(pnl_pct) as avg_pnl'),
            paragraph('FROM paper_trades'),
            paragraph('WHERE status = \'closed\';'),
        ]

        add_blocks(metrics_page['id'], metrics_blocks)
        print("   ✓ Metrics Dashboard page created")

    # Save updated config
    with open('.notion-config.json', 'w') as f:
        json.dump(config, f, indent=2)

    print("\n✅ User Feedback database and Metrics Dashboard added!")
    print("\nWhat was created:")
    print("├── Product page")
    print("│   └── User Feedback database")
    print("└── Metrics Dashboard page (top level)")

if __name__ == '__main__':
    main()
