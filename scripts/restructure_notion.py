#!/usr/bin/env python3
"""
Restructure Notion workspace into proper hierarchy with subpages
"""
import json
import requests

# Load config
with open('.notion-config.json', 'r') as f:
    config = json.load(f)

NOTION_TOKEN = config['notion_token']
VELA_PAGE_ID = config['vela_page_id']
NOTION_VERSION = '2022-06-28'

headers = {
    'Authorization': f'Bearer {NOTION_TOKEN}',
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION
}

def create_page(parent_id, title, emoji='📄', icon_type='emoji'):
    """Create a new page in Notion"""
    url = 'https://api.notion.com/v1/pages'

    icon_data = {'type': icon_type}
    if icon_type == 'emoji':
        icon_data['emoji'] = emoji

    data = {
        'parent': {'page_id': parent_id},
        'icon': icon_data,
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

def divider():
    return {'object': 'block', 'type': 'divider', 'divider': {}}

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

def clear_page_content(page_id):
    """Get and archive all blocks in a page"""
    url = f'https://api.notion.com/v1/blocks/{page_id}/children'
    response = requests.get(url, headers=headers)

    if response.status_code != 200:
        print(f"Warning: Could not fetch blocks: {response.text}")
        return

    blocks = response.json().get('results', [])

    # Archive each block
    for block in blocks:
        archive_url = f"https://api.notion.com/v1/blocks/{block['id']}"
        requests.patch(archive_url, headers=headers, json={'archived': True})

def main():
    print("🔄 Restructuring Notion workspace into proper hierarchy...\n")

    # Clear existing content from main page
    print("1. Clearing existing content from main Vela page...")
    clear_page_content(VELA_PAGE_ID)

    # Create home page structure
    print("2. Creating new home page structure...")

    home_blocks = [
        callout('👋', 'Welcome to Vela - your crypto trading signal system documentation hub. Everything you need to know about the project is organized below.'),
        divider(),
        heading(2, '📑 Documentation Structure'),
        paragraph('This workspace is organized by function:'),
        bulleted_list_item('📊 Product - Product vision, roadmap, metrics, and user insights'),
        bulleted_list_item('🎨 Design - Design system, UI patterns, and visual guidelines'),
        bulleted_list_item('⚙️ Engineering - Technical architecture, code structure, and development'),
        bulleted_list_item('✍️ Content - Messaging, copy guidelines, and content calendar'),
        bulleted_list_item('🚀 Operations - Deployment, monitoring, and incident response'),
        bulleted_list_item('📝 Activity Log - Changelog, decisions, and task tracking'),
        divider(),
        heading(2, '⚡ Quick Links'),
    ]

    add_blocks(VELA_PAGE_ID, home_blocks)

    # Create Product subpage
    print("3. Creating Product subpage...")
    product_page = create_page(VELA_PAGE_ID, 'Product', '📊')
    if product_page:
        config['product_page_id'] = product_page['id'].replace('-', '')

        product_blocks = [
            heading(1, 'Product Overview'),
            callout('🎯', 'Vela is a crypto trading signal dashboard that helps traders make informed decisions by translating complex technical indicators into clear, actionable signals.'),

            heading(2, 'Product Vision'),
            paragraph('Transform crypto trading from stressful chart-watching into confident, data-driven decision making through automated signal monitoring and AI-powered explanations.'),

            heading(2, 'Target Users'),
            bulleted_list_item('Crypto traders who understand basic TA but want automated signal monitoring'),
            bulleted_list_item('Busy professionals who can\'t watch charts 24/7'),
            bulleted_list_item('People who want to understand *why* signals change, not just *what* changed'),

            heading(2, 'Core Value Propositions'),
            bulleted_list_item('AI-generated briefs explain signals in plain English'),
            bulleted_list_item('Multi-asset monitoring in one dashboard'),
            bulleted_list_item('Paper trading track record shows strategy performance'),
            bulleted_list_item('Real-time prices + technical indicators in one view'),

            heading(2, 'Success Metrics'),
            paragraph('Key metrics we track to measure product success:'),
            bulleted_list_item('Signal accuracy: % of profitable signals from paper trades'),
            bulleted_list_item('Win rate: Ratio of winning trades to total trades'),
            bulleted_list_item('Max drawdown: Largest peak-to-trough decline'),
            bulleted_list_item('User engagement: Daily active users, session duration'),

            heading(2, 'Current State'),
            paragraph('Version: 0.2.0'),
            paragraph('Status: MVP in development'),
            paragraph('Assets tracked: BTC, ETH, HYPE'),
            paragraph('Users: Internal testing only'),

            heading(2, 'Roadmap Themes'),
            bulleted_list_item('Phase 1 (Current): Dashboard with signals, briefs, and paper trades'),
            bulleted_list_item('Phase 2: Real-time notifications (Telegram, email, push)'),
            bulleted_list_item('Phase 3: Customizable signal parameters per user'),
            bulleted_list_item('Phase 4: Integration with exchanges for real trading'),

            heading(2, 'Known Risks'),
            paragraph('Risk: False signals in choppy markets'),
            paragraph('→ Mitigation: ADX filter for trend strength'),
            paragraph(''),
            paragraph('Risk: Over-trading from too many signals'),
            paragraph('→ Mitigation: Position sizing limits'),
            paragraph(''),
            paragraph('Risk: Users blindly follow signals'),
            paragraph('→ Mitigation: Educational briefs explain "why"'),
        ]

        add_blocks(product_page['id'], product_blocks)
        print("   ✓ Product page created")

    # Create Design subpage
    print("4. Creating Design subpage...")
    design_page = create_page(VELA_PAGE_ID, 'Design', '🎨')
    if design_page:
        config['design_page_id'] = design_page['id'].replace('-', '')

        design_blocks = [
            heading(1, 'Design System'),
            paragraph('Visual design standards and component patterns for Vela.'),

            heading(2, 'Color Palette'),
            callout('🟢', 'Green (Bullish): #4CAF50 - Buy signals, positive P&L'),
            callout('🔴', 'Red (Bearish): #F44336 - Sell signals, negative P&L'),
            callout('⚫', 'Grey (Neutral): #9E9E9E - Hold/neutral signals'),
            callout('🔵', 'Primary Blue: Material-UI default - Interactive elements'),
            paragraph('Background: Dark theme (#121212 base)'),

            heading(2, 'Typography'),
            bulleted_list_item('Font Family: Roboto (Material-UI)'),
            bulleted_list_item('Headings: Medium weight (500)'),
            bulleted_list_item('Body: Regular (400), 16px base'),
            bulleted_list_item('Numbers: Monospace for prices'),

            heading(2, 'Component Patterns'),
            paragraph('Signal Cards: Card with colored left border'),
            paragraph('Price Display: Large price + colored 24h change chip'),
            paragraph('Briefs: Collapsible accordion with headline'),
            paragraph('Gauges: Circular progress for metrics'),

            heading(2, 'Spacing & Layout'),
            bulleted_list_item('Card Padding: 16px'),
            bulleted_list_item('Section Margins: 24px'),
            bulleted_list_item('Grid: 12-column responsive'),
            bulleted_list_item('Mobile: Stacks vertically'),

            heading(2, 'Icons'),
            bulleted_list_item('Library: Material Icons'),
            bulleted_list_item('Arrows: TrendingUp/Down for direction'),
            bulleted_list_item('Status: Circle/chip badges'),
        ]

        add_blocks(design_page['id'], design_blocks)

        # Add Design Decisions database to Design page
        design_db = create_database(
            design_page['id'],
            'Design Decisions',
            {
                'Decision': {'title': {}},
                'Date': {'date': {}},
                'Category': {
                    'select': {
                        'options': [
                            {'name': 'UI/UX', 'color': 'purple'},
                            {'name': 'Color', 'color': 'pink'},
                            {'name': 'Typography', 'color': 'blue'},
                            {'name': 'Layout', 'color': 'green'},
                            {'name': 'Accessibility', 'color': 'orange'},
                        ]
                    }
                },
                'Why': {'rich_text': {}},
                'Alternatives': {'rich_text': {}},
                'Status': {
                    'select': {
                        'options': [
                            {'name': 'Active', 'color': 'green'},
                            {'name': 'Deprecated', 'color': 'red'},
                        ]
                    }
                }
            }
        )
        if design_db:
            config['design_decisions_db_id'] = design_db['id'].replace('-', '')

        print("   ✓ Design page created")

    # Create Engineering subpage
    print("5. Creating Engineering subpage...")
    eng_page = create_page(VELA_PAGE_ID, 'Engineering', '⚙️')
    if eng_page:
        config['engineering_page_id'] = eng_page['id'].replace('-', '')

        eng_blocks = [
            heading(1, 'Engineering Documentation'),
            paragraph('Technical architecture, development guides, and code reference.'),

            heading(2, 'System Architecture'),
            paragraph('Three main components:'),
            bulleted_list_item('Backend Signal Generator: Technical analysis → signals'),
            bulleted_list_item('Supabase Database: Data storage (PostgreSQL)'),
            bulleted_list_item('Frontend Dashboard: React app displaying signals'),
            paragraph('Data flow: Backend → Supabase → Frontend → Browser'),

            heading(2, 'Tech Stack'),
            paragraph('Frontend:'),
            bulleted_list_item('React 19 + TypeScript'),
            bulleted_list_item('Vite (build tool)'),
            bulleted_list_item('Material-UI (components)'),
            bulleted_list_item('React Router (navigation)'),
            paragraph(''),
            paragraph('Backend:'),
            bulleted_list_item('Supabase (database + API)'),
            bulleted_list_item('CoinGecko API (price data)'),

            heading(2, 'File Structure'),
            paragraph('📁 src/'),
            bulleted_list_item('components/ - Reusable UI components'),
            bulleted_list_item('pages/ - Route pages (Home, AssetDetail, TrackRecord)'),
            bulleted_list_item('hooks/ - Data fetching (useData.ts)'),
            bulleted_list_item('lib/ - Utilities (supabase.ts, helpers.ts)'),
            bulleted_list_item('types.ts - TypeScript type definitions'),
            bulleted_list_item('theme.ts - Material-UI theme config'),

            heading(2, 'Signal Logic'),
            paragraph('Technical indicators used:'),
            bulleted_list_item('EMA-9 & EMA-21: Moving average crossovers (4h candles)'),
            bulleted_list_item('RSI-14: Overbought/oversold levels (4h)'),
            bulleted_list_item('SMA-50: Long-term trend (daily)'),
            bulleted_list_item('ADX: Trend strength (4h)'),
            paragraph(''),
            paragraph('Signal Colors:'),
            bulleted_list_item('🟢 Green: Bullish (buy/hold)'),
            bulleted_list_item('🔴 Red: Bearish (sell/avoid)'),
            bulleted_list_item('⚪ Grey: Neutral (no clear signal)'),

            heading(2, 'Environment Variables'),
            paragraph('Required in .env:'),
            bulleted_list_item('VITE_SUPABASE_URL'),
            bulleted_list_item('VITE_SUPABASE_ANON_KEY'),

            heading(2, 'Development Commands'),
            paragraph('npm run dev - Start dev server'),
            paragraph('npm run build - Build for production'),
            paragraph('npm run preview - Preview production build'),

            heading(2, 'Database Schema'),
            paragraph('Key tables in Supabase:'),
            bulleted_list_item('assets - Cryptocurrency assets being tracked'),
            bulleted_list_item('signals - Historical signal data'),
            bulleted_list_item('latest_signals - View of most recent signal per asset'),
            bulleted_list_item('briefs - AI-generated explanations'),
            bulleted_list_item('latest_briefs - View of most recent brief per asset'),
            bulleted_list_item('paper_trades - Simulated trade records'),
            bulleted_list_item('paper_trade_stats - Aggregated performance metrics'),

            heading(2, 'Data Refresh'),
            bulleted_list_item('Live prices: Every 15 minutes (CoinGecko)'),
            bulleted_list_item('Frontend auto-refresh: Every 15 minutes'),
            bulleted_list_item('Signals: Generated by backend (frequency TBD)'),

            heading(2, 'Key Links'),
            paragraph('GitHub: https://github.com/huku-dev/vela'),
            paragraph('Supabase: https://memyqgdqcwrrybjpszuw.supabase.co'),
        ]

        add_blocks(eng_page['id'], eng_blocks)
        print("   ✓ Engineering page created")

    # Create Content subpage
    print("6. Creating Content subpage...")
    content_page = create_page(VELA_PAGE_ID, 'Content', '✍️')
    if content_page:
        config['content_page_id'] = content_page['id'].replace('-', '')

        content_blocks = [
            heading(1, 'Content & Messaging'),
            paragraph('Guidelines for all user-facing content, messaging, and communications.'),

            heading(2, 'Tone & Voice'),
            bulleted_list_item('Clear, not clever: Explain simply'),
            bulleted_list_item('Confident, not arrogant: Data-driven insights, not guarantees'),
            bulleted_list_item('Educational, not preachy: Help users understand'),

            heading(2, 'Key Messages'),
            callout('💡', 'Vela translates technical indicators into plain English so you can trade smarter.'),
            callout('📈', 'See what\'s happening AND understand why with AI-generated briefs.'),
            callout('🧪', 'Track strategy performance with paper trades before risking capital.'),

            heading(2, 'Signal Brief Style Guide'),
            paragraph('Structure: What changed → Why it matters → What to watch'),
            paragraph('Length: 2-4 sentences, avoid walls of text'),
            paragraph('Jargon: Define terms on first use'),
            paragraph('Numbers: Always include indicator values'),

            heading(2, 'Glossary'),
            paragraph('EMA: Exponential Moving Average - trend direction indicator'),
            paragraph('RSI: Relative Strength Index - overbought/oversold measure'),
            paragraph('SMA: Simple Moving Average - overall trend'),
            paragraph('ADX: Average Directional Index - trend strength'),
            paragraph('Paper Trade: Simulated trade with no real money'),
            paragraph('Brief: AI-generated plain-English explanation'),

            heading(2, 'Notification Templates (Future)'),
            paragraph('🟢 Bullish: "[ASSET] turned green: [REASON]"'),
            paragraph('🔴 Bearish: "[ASSET] turned red: [REASON]"'),
            paragraph('⚠️ Caution: "[ASSET] showing caution: [INDICATOR]"'),
            paragraph('📊 Digest: "Today: [X] green, [Y] red. [TOP MOVER]"'),
        ]

        add_blocks(content_page['id'], content_blocks)

        # Add Content Calendar to Content page
        content_db = create_database(
            content_page['id'],
            'Content Calendar',
            {
                'Content': {'title': {}},
                'Date': {'date': {}},
                'Type': {
                    'select': {
                        'options': [
                            {'name': 'Brief Template', 'color': 'blue'},
                            {'name': 'Notification', 'color': 'green'},
                            {'name': 'Help Text', 'color': 'purple'},
                            {'name': 'Error Message', 'color': 'red'},
                            {'name': 'Marketing', 'color': 'yellow'},
                        ]
                    }
                },
                'Copy': {'rich_text': {}},
                'Status': {
                    'select': {
                        'options': [
                            {'name': 'Draft', 'color': 'gray'},
                            {'name': 'Review', 'color': 'yellow'},
                            {'name': 'Live', 'color': 'green'},
                        ]
                    }
                }
            }
        )
        if content_db:
            config['content_calendar_db_id'] = content_db['id'].replace('-', '')

        print("   ✓ Content page created")

    # Create Operations subpage
    print("7. Creating Operations subpage...")
    ops_page = create_page(VELA_PAGE_ID, 'Operations', '🚀')
    if ops_page:
        config['operations_page_id'] = ops_page['id'].replace('-', '')

        ops_blocks = [
            heading(1, 'Operations & Deployment'),
            paragraph('Deployment procedures, monitoring, and incident response.'),

            heading(2, 'Deployment Process'),
            paragraph('1. Run tests: npm run test'),
            paragraph('2. Build: npm run build'),
            paragraph('3. Preview: npm run preview'),
            paragraph('4. Deploy: (platform TBD - Vercel/Netlify)'),
            paragraph('5. Verify: Check production URL'),

            heading(2, 'Monitoring (To Set Up)'),
            bulleted_list_item('Uptime: Ping production every 5 min'),
            bulleted_list_item('Errors: Sentry or similar'),
            bulleted_list_item('Database: Monitor Supabase dashboard'),
            bulleted_list_item('API: Track CoinGecko rate limits'),

            heading(2, 'Incident Response'),
            paragraph('If signals stop:'),
            bulleted_list_item('Check Supabase dashboard'),
            bulleted_list_item('Verify CoinGecko API'),
            bulleted_list_item('Check backend logs'),
            paragraph(''),
            paragraph('If frontend breaks:'),
            bulleted_list_item('Check browser console'),
            bulleted_list_item('Rollback to last good commit'),
            bulleted_list_item('Verify env variables'),

            heading(2, 'Backups'),
            bulleted_list_item('Code: GitHub repo'),
            bulleted_list_item('Database: Supabase auto-backups'),
            bulleted_list_item('Config: Local .env (not in git)'),
        ]

        add_blocks(ops_page['id'], ops_blocks)
        print("   ✓ Operations page created")

    # Create Activity Log subpage
    print("8. Creating Activity Log subpage...")
    activity_page = create_page(VELA_PAGE_ID, 'Activity Log', '📝')
    if activity_page:
        config['activity_page_id'] = activity_page['id'].replace('-', '')

        activity_blocks = [
            heading(1, 'Activity Log'),
            paragraph('Track changes, decisions, and tasks across the entire project.'),

            heading(2, 'How This Works'),
            callout('🤖', 'Changelog updates automatically via git hook - every commit creates an entry!'),
            callout('✍️', 'Decisions are logged manually when you make important choices.'),
            callout('✅', 'Tasks can be added by you OR by Claude based on conversations.'),

            divider(),

            heading(2, '📊 Databases'),
            paragraph('All activity is tracked in three databases below:'),
        ]

        add_blocks(activity_page['id'], activity_blocks)

        # Move/recreate databases under Activity Log
        print("   • Creating Changelog database...")
        changelog_db = create_database(
            activity_page['id'],
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

        print("   • Creating Decisions database...")
        decisions_db = create_database(
            activity_page['id'],
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

        print("   • Creating Tasks & Roadmap database...")
        tasks_db = create_database(
            activity_page['id'],
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
                            {'name': 'Product', 'color': 'pink'},
                            {'name': 'Design', 'color': 'yellow'},
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
                },
                'Description': {'rich_text': {}},
                'Source': {
                    'select': {
                        'options': [
                            {'name': 'User added', 'color': 'blue'},
                            {'name': 'Claude added', 'color': 'purple'},
                            {'name': 'Conversation', 'color': 'green'}
                        ]
                    }
                }
            }
        )
        if tasks_db:
            config['tasks_db_id'] = tasks_db['id'].replace('-', '')

        print("   ✓ Activity Log page created with databases")

    # Save updated config
    with open('.notion-config.json', 'w') as f:
        json.dump(config, f, indent=2)

    print("\n✅ Restructure complete!")
    print(f"\n📝 Your Vela workspace: https://notion.so/{VELA_PAGE_ID}")
    print("\nNew structure:")
    print("├── 📊 Product")
    print("├── 🎨 Design")
    print("├── ⚙️ Engineering")
    print("├── ✍️ Content")
    print("├── 🚀 Operations")
    print("└── 📝 Activity Log")
    print("    ├── Changelog (auto-updates)")
    print("    ├── Decisions")
    print("    └── Tasks & Roadmap")

if __name__ == '__main__':
    main()
