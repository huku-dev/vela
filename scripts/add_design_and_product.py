#!/usr/bin/env python3
"""
Add Design System and Product/Business sections to Vela
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

def add_blocks(page_id, blocks):
    url = f'https://api.notion.com/v1/blocks/{page_id}/children'
    data = {'children': blocks}
    response = requests.patch(url, headers=headers, json=data)
    return response.json()

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

def create_database(parent_id, title, properties):
    url = 'https://api.notion.com/v1/databases'
    data = {
        'parent': {'page_id': parent_id},
        'title': [{'text': {'content': title}}],
        'properties': properties
    }
    response = requests.post(url, headers=headers, json=data)
    if response.status_code != 200:
        print(f"Error creating database: {response.text}")
        return None
    return response.json()

def main():
    print("📝 Adding Design System and Product sections...\n")

    # Design System Section
    design_blocks = [
        heading(1, '🎨 Design System'),

        heading(2, 'Color Palette'),
        callout('🟢', 'Green (Bullish): RGB(76, 175, 80) - Used for buy signals, positive P&L'),
        callout('🔴', 'Red (Bearish): RGB(244, 67, 54) - Used for sell signals, negative P&L'),
        callout('⚫', 'Grey (Neutral): RGB(158, 158, 158) - Used for neutral/hold signals'),
        callout('🔵', 'Primary Blue: Material-UI default - Used for interactive elements, links'),
        paragraph('Background: Dark theme with grey-900 (#121212) base'),

        heading(2, 'Typography'),
        paragraph('Font Family: Roboto (Material-UI default)'),
        paragraph('Headings: Medium weight (500), varied sizes'),
        paragraph('Body: Regular weight (400), 16px base'),
        paragraph('Code/Numbers: Monospace for price displays'),

        heading(2, 'Component Patterns'),
        paragraph('Signal Cards: Card with colored left border indicating signal direction'),
        paragraph('Price Display: Large price with 24h change percentage in colored chip'),
        paragraph('Briefs: Collapsible accordion with headline and expandable details'),
        paragraph('Gauges: Circular progress indicators for metrics like Fear & Greed index'),

        heading(2, 'Spacing & Layout'),
        paragraph('Card Spacing: 16px padding, 24px margins between sections'),
        paragraph('Grid: Responsive grid with 12-column layout (Material-UI)'),
        paragraph('Mobile-first: Stacks vertically on small screens, multi-column on desktop'),

        heading(2, 'Icons & Visuals'),
        paragraph('Icon Library: Material Icons (@mui/icons-material)'),
        paragraph('Arrows: TrendingUp/TrendingDown for price direction'),
        paragraph('Status Indicators: Circle or chip badges for signal colors'),
    ]

    print("• Adding Design System section...")
    add_blocks(VELA_PAGE_ID, design_blocks)

    # Product/Business Section
    product_blocks = [
        heading(1, '📊 Product & Business'),

        heading(2, 'Product Vision'),
        paragraph('Vela is a crypto trading signal dashboard that helps traders make informed decisions by translating complex technical indicators into clear, actionable signals with plain-English explanations.'),

        heading(2, 'Target Users'),
        bulleted_list_item('Crypto traders who understand basic TA but want automated signal monitoring'),
        bulleted_list_item('Busy professionals who can\'t watch charts 24/7'),
        bulleted_list_item('People who want to understand *why* signals change, not just *what* changed'),

        heading(2, 'Core Value Propositions'),
        bulleted_list_item('AI-generated briefs explain signals in plain English (no jargon overload)'),
        bulleted_list_item('Multi-asset monitoring in one dashboard (BTC, ETH, HYPE, etc.)'),
        bulleted_list_item('Paper trading track record shows strategy performance'),
        bulleted_list_item('Real-time prices + technical indicators in one view'),

        heading(2, 'Success Metrics (To Be Tracked)'),
        paragraph('• Signal accuracy: % of profitable signals from paper trades'),
        paragraph('• Win rate: Ratio of winning trades to total trades'),
        paragraph('• Max drawdown: Largest peak-to-trough decline'),
        paragraph('• User engagement: Daily active users, session duration'),
        paragraph('• Notification click-through: % of users acting on signals'),

        heading(2, 'Roadmap Themes'),
        bulleted_list_item('Phase 1 (Current): Dashboard with signals, briefs, and paper trades'),
        bulleted_list_item('Phase 2: Real-time notifications (Telegram, email, push)'),
        bulleted_list_item('Phase 3: Customizable signal parameters per user'),
        bulleted_list_item('Phase 4: Integration with exchanges for real trading'),

        heading(2, 'Known Risks & Mitigations'),
        paragraph('Risk: False signals in choppy markets → Mitigation: ADX filter for trend strength'),
        paragraph('Risk: Over-trading from too many signals → Mitigation: Position sizing limits'),
        paragraph('Risk: Users blindly follow signals → Mitigation: Educational briefs explain "why"'),
    ]

    print("• Adding Product & Business section...")
    add_blocks(VELA_PAGE_ID, product_blocks)

    # Content/Messaging Section
    content_blocks = [
        heading(1, '✍️ Content & Messaging'),

        heading(2, 'Tone & Voice'),
        paragraph('Clear, not clever: Explain complex concepts simply'),
        paragraph('Confident, not arrogant: Present signals as data-driven insights, not guarantees'),
        paragraph('Educational, not preachy: Help users understand, don\'t talk down'),

        heading(2, 'Key Messages'),
        callout('💡', 'Vela translates technical indicators into plain English so you can trade smarter, not harder.'),
        callout('📈', 'See what\'s happening AND understand why with AI-generated signal briefs.'),
        callout('🧪', 'Track strategy performance with paper trades before risking real capital.'),

        heading(2, 'Signal Brief Style Guide'),
        paragraph('Structure: Start with "what changed", then "why it matters", then "what to watch"'),
        paragraph('Length: 2-4 sentences per brief, avoid walls of text'),
        paragraph('Jargon: Define technical terms on first use (e.g., "RSI (oversold indicator)")'),
        paragraph('Numbers: Always include the actual indicator values for reference'),

        heading(2, 'Notification Templates (Future)'),
        paragraph('🟢 Bullish Signal: "[ASSET] turned green: [ONE-LINE REASON]"'),
        paragraph('🔴 Bearish Signal: "[ASSET] turned red: [ONE-LINE REASON]"'),
        paragraph('⚠️ Yellow Alert: "[ASSET] showing caution: [SPECIFIC INDICATOR THRESHOLD]"'),
        paragraph('📊 Daily Digest: "Today\'s signals: [X] green, [Y] red. [TOP MOVER]"'),
    ]

    print("• Adding Content & Messaging section...")
    add_blocks(VELA_PAGE_ID, content_blocks)

    # Operations Section
    ops_blocks = [
        heading(1, '⚙️ Operations & Deployment'),

        heading(2, 'Deployment Process'),
        paragraph('1. Run tests locally: npm run test (when tests are added)'),
        paragraph('2. Build: npm run build'),
        paragraph('3. Preview: npm run preview'),
        paragraph('4. Deploy: (deployment target TBD - Vercel/Netlify/AWS)'),
        paragraph('5. Verify: Check production URL, test signal loading'),

        heading(2, 'Environment Setup'),
        paragraph('Development: .env file with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY'),
        paragraph('Production: Same variables set in hosting platform (Vercel/Netlify env vars)'),
        paragraph('API Keys: ANTHROPIC_API_KEY for Claude (backend signal generation)'),

        heading(2, 'Monitoring (To Be Set Up)'),
        paragraph('• Uptime monitoring: Ping production URL every 5 minutes'),
        paragraph('• Error tracking: Sentry or similar for frontend errors'),
        paragraph('• Supabase dashboard: Monitor database query performance'),
        paragraph('• CoinGecko API limits: Track daily API calls (free tier = 10-50/min)'),

        heading(2, 'Incident Response'),
        paragraph('If signals stop updating:'),
        bulleted_list_item('Check Supabase dashboard for backend errors'),
        bulleted_list_item('Verify CoinGecko API is responding (test in browser)'),
        bulleted_list_item('Check backend signal generator logs (separate service)'),
        paragraph('If frontend breaks:'),
        bulleted_list_item('Check browser console for errors'),
        bulleted_list_item('Rollback to last known good commit if needed'),
        bulleted_list_item('Verify .env variables are set correctly'),

        heading(2, 'Backup & Recovery'),
        paragraph('Code: Git repository on GitHub (https://github.com/huku-dev/vela)'),
        paragraph('Database: Supabase has automatic backups (check their retention policy)'),
        paragraph('Config: .notion-config.json backed up locally (DO NOT commit to git)'),
    ]

    print("• Adding Operations & Deployment section...")
    add_blocks(VELA_PAGE_ID, ops_blocks)

    # Create Design Decisions database
    print("• Creating Design Decisions database...")
    design_decisions_db = create_database(
        VELA_PAGE_ID,
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

    if design_decisions_db:
        config['design_decisions_db_id'] = design_decisions_db['id'].replace('-', '')

    # Create Content Calendar database
    print("• Creating Content Calendar database...")
    content_calendar_db = create_database(
        VELA_PAGE_ID,
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

    if content_calendar_db:
        config['content_calendar_db_id'] = content_calendar_db['id'].replace('-', '')

    # Save updated config
    with open('.notion-config.json', 'w') as f:
        json.dump(config, f, indent=2)

    print("\n✅ Design System, Product, Content, and Operations sections added!")
    print("✅ Created Design Decisions and Content Calendar databases!")

if __name__ == '__main__':
    main()
