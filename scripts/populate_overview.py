#!/usr/bin/env python3
"""
Populate the Overview section with initial Vela documentation
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
    """Add multiple blocks to a page"""
    url = f'https://api.notion.com/v1/blocks/{page_id}/children'
    data = {'children': blocks}

    response = requests.patch(url, headers=headers, json=data)
    if response.status_code != 200:
        print(f"Error adding blocks: {response.text}")
        return None
    return response.json()

def heading(level, text):
    """Create a heading block"""
    heading_type = f'heading_{level}'
    return {
        'object': 'block',
        'type': heading_type,
        heading_type: {
            'rich_text': [{'text': {'content': text}}]
        }
    }

def paragraph(text):
    """Create a paragraph block"""
    return {
        'object': 'block',
        'type': 'paragraph',
        'paragraph': {
            'rich_text': [{'text': {'content': text}}]
        }
    }

def bulleted_list_item(text):
    """Create a bulleted list item"""
    return {
        'object': 'block',
        'type': 'bulleted_list_item',
        'bulleted_list_item': {
            'rich_text': [{'text': {'content': text}}]
        }
    }

def toggle(title, children_text_list):
    """Create a toggle block with children"""
    return {
        'object': 'block',
        'type': 'toggle',
        'toggle': {
            'rich_text': [{'text': {'content': title}}],
            'children': [paragraph(text) for text in children_text_list]
        }
    }

def main():
    print("📝 Populating Overview section...")

    overview_blocks = [
        heading(2, 'What Vela Does'),
        paragraph('Vela is a crypto trading signal system that helps you make informed trading decisions by analyzing technical indicators across multiple cryptocurrencies.'),

        bulleted_list_item('Tracks trading signals for Bitcoin, Ethereum, Hyperliquid, and other cryptocurrencies'),
        bulleted_list_item('Analyzes technical indicators in real-time to generate buy/hold/sell signals'),
        bulleted_list_item('Provides plain-English explanations (called "briefs") for why signals change'),
        bulleted_list_item('Displays live prices and 24-hour price changes'),
        bulleted_list_item('Tracks paper trades (simulated trades) to measure strategy performance'),

        heading(2, 'Assets Covered'),
        paragraph('Currently tracking: BTC (Bitcoin), ETH (Ethereum), HYPE (Hyperliquid), and other enabled assets.'),
        paragraph('Live prices are fetched from CoinGecko API every 15 minutes.'),

        heading(2, 'Signal Logic (Plain Language)'),
        paragraph('Vela uses five technical indicators to determine when to buy or sell:'),

        bulleted_list_item('EMA-9 & EMA-21: Fast and slow moving averages. When the fast crosses above the slow, it\'s bullish (potential buy). When it crosses below, it\'s bearish (potential sell).'),
        bulleted_list_item('RSI-14: Measures if an asset is "oversold" (potentially cheap, RSI < 30) or "overbought" (potentially expensive, RSI > 70).'),
        bulleted_list_item('SMA-50 Daily: A longer-term moving average that shows the overall trend direction.'),
        bulleted_list_item('ADX 4H: Measures trend strength. Higher ADX means a stronger trend (more confidence in the signal).'),

        paragraph('Signals are color-coded:'),
        bulleted_list_item('🟢 Green: Bullish signal (consider buying or holding)'),
        bulleted_list_item('🔴 Red: Bearish signal (consider selling or staying out)'),
        bulleted_list_item('⚪ Grey: Neutral (no clear signal)'),

        heading(2, 'How Signals Reach You'),
        paragraph('Currently, signals are viewed through the web dashboard at the frontend URL. The system refreshes data every 15 minutes automatically.'),
        paragraph('(Future: Telegram/email notifications can be added)'),

        heading(2, 'Current Limitations & Known Quirks'),
        bulleted_list_item('Data refresh: Live prices update every 15 minutes, not real-time'),
        bulleted_list_item('No automated notifications yet (Telegram/email integration planned)'),
        bulleted_list_item('Paper trades are simulated only - no real money trading'),
        bulleted_list_item('Signal generation happens on the backend (separate from this frontend)'),

        heading(2, 'System Architecture'),
        paragraph('Vela consists of three main parts:'),

        bulleted_list_item('Backend Signal Generator: Runs technical analysis and writes signals to the database (not in this repo)'),
        bulleted_list_item('Supabase Database: Stores signals, briefs, assets, and paper trades'),
        bulleted_list_item('Frontend Dashboard (this repo): React app that displays signals and briefs'),

        paragraph('Data flows like this: Backend generates signals → Supabase stores them → Frontend reads and displays → You see them in your browser'),

        heading(2, 'Glossary'),
        toggle('EMA (Exponential Moving Average)', [
            'A type of moving average that gives more weight to recent prices. Used to identify trend direction. EMA-9 is "fast" (reacts quickly), EMA-21 is "slower" (smoother).'
        ]),
        toggle('RSI (Relative Strength Index)', [
            'Measures whether an asset is oversold (RSI < 30, potentially cheap) or overbought (RSI > 70, potentially expensive). Range: 0-100.'
        ]),
        toggle('SMA (Simple Moving Average)', [
            'Average price over a period. SMA-50 daily uses the last 50 days of closing prices to show the overall trend.'
        ]),
        toggle('ADX (Average Directional Index)', [
            'Measures trend strength (not direction). ADX > 25 = strong trend, ADX < 20 = weak/choppy market.'
        ]),
        toggle('Supabase', [
            'Cloud database service (built on PostgreSQL) that stores all our signals, briefs, and trading data.'
        ]),
        toggle('Vite + React', [
            'Vite is the build tool, React is the UI framework. Together they create the web dashboard you see in your browser.'
        ]),
        toggle('Paper Trade', [
            'A simulated trade (no real money). Used to test if the signal strategy would have been profitable.'
        ]),
        toggle('Brief', [
            'A plain-English explanation generated by AI that explains why a signal changed or what\'s happening with an asset.'
        ]),
    ]

    add_blocks(VELA_PAGE_ID, overview_blocks)

    print("✅ Overview populated!")

if __name__ == '__main__':
    main()
