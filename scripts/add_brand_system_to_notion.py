#!/usr/bin/env python3
"""
Add Vela Brand System V2.0 documentation to Notion Design page
"""
import json
import requests

# Load config
with open('.notion-config.json', 'r') as f:
    config = json.load(f)

NOTION_TOKEN = config['notion_token']
DESIGN_PAGE_ID = config.get('design_page_id')
NOTION_VERSION = '2022-06-28'

headers = {
    'Authorization': f'Bearer {NOTION_TOKEN}',
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION
}

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

def code_block(text, language='css'):
    return {
        'object': 'block',
        'type': 'code',
        'code': {
            'rich_text': [{'text': {'content': text}}],
            'language': language
        }
    }

def toggle(title, children_blocks):
    """Create a toggle block with children"""
    return {
        'object': 'block',
        'type': 'toggle',
        'toggle': {
            'rich_text': [{'text': {'content': title}}],
            'children': children_blocks
        }
    }

def main():
    print("📝 Adding Vela Brand System V2.0 to Notion Design page...\n")

    if not DESIGN_PAGE_ID:
        print("❌ Design page ID not found in config")
        return

    brand_blocks = [
        divider(),
        heading(1, '✨ Vela Brand System V2.0'),
        callout('✅', 'Status: Ready for Implementation | Timeline: 6-8 days'),

        heading(2, '📦 What\'s Complete'),
        bulleted_list_item('Enhanced CSS Design System (20KB) - Semantic tokens, dark mode, WCAG AA+'),
        bulleted_list_item('TypeScript Component Library (15KB) - Full type safety + ARIA'),
        bulleted_list_item('Brand Voice Framework - Three-pillar story + trust language'),
        bulleted_list_item('Complete Documentation - Guidelines, implementation guide, templates'),

        heading(2, '🎯 Three-Pillar Brand Story'),
        callout('1️⃣', 'Always Watching: Vela monitors your rules 24/7 and flags only what matters'),
        callout('2️⃣', 'You Stay in Control: You approve every trade; Vela brings you the right moments'),
        callout('3️⃣', 'Plain English, No Noise: Every alert has a one-sentence explanation'),
        paragraph('Every feature maps to one of these three pillars.'),

        heading(2, '🎨 Design System Highlights'),

        heading(3, 'Semantic Token Architecture'),
        code_block('/* Primitive */\n--blue-primary: #2563eb;\n\n/* Semantic */\n--color-action-primary: var(--blue-primary);\n\n/* Component */\n.btn-primary { background: var(--color-action-primary); }', 'css'),
        paragraph('Benefit: Easy to remap for themes without touching components'),

        heading(3, 'Color Strategy'),
        bulleted_list_item('Foundation: Cream (#f5f1e8), White, Black'),
        bulleted_list_item('Pastels: Lavender, Mint (friendly backgrounds)'),
        bulleted_list_item('Status: Blue=WAIT, Green=BUY, Red=SELL, Amber=HOLD'),
        bulleted_list_item('Brand: Purple (Vela moments only)'),
        bulleted_list_item('Action: Blue (general interactions)'),

        heading(3, 'Typography'),
        bulleted_list_item('Display: Space Grotesk (headlines)'),
        bulleted_list_item('Body: Inter (UI, content)'),
        bulleted_list_item('Mono: JetBrains Mono (prices, numbers)'),

        heading(3, 'Neobrutalist Elements'),
        bulleted_list_item('Thick borders (3-4px black)'),
        bulleted_list_item('Solid shadows (no blur, 4-8px offset)'),
        bulleted_list_item('Rounded corners (8-16px)'),
        bulleted_list_item('High contrast (WCAG AA+ compliant)'),

        heading(2, '📝 Brand Voice'),

        heading(3, 'Updated Taglines'),
        paragraph('Primary: "Always watching the markets for you"'),
        paragraph('Secondary: "Always watching, you stay in control"'),

        heading(3, 'Trust & Safety Language'),
        callout('🔐', 'Control Statement: Vela never moves your real money without your explicit approval. Paper trading first. You can change or pause any rule instantly.'),
        callout('⚠️', 'Risk Disclaimer: Does Vela guarantee profits? No. Markets are risky. Vela helps you stay informed, disciplined, and less reactive—not promise outcomes.'),

        heading(3, 'Reusable Copy Patterns'),
        toggle('Alert Pattern', [
            paragraph('Title: "BTC hit your [rule]"'),
            paragraph('Body: "Here\'s what changed in plain English"'),
            paragraph('Close: "You can [do X] or [do Y]"')
        ]),
        toggle('"Why we think this" Pattern', [
            paragraph('Summary: "We\'re cautious because..."'),
            bulleted_list_item('Price action detail'),
            bulleted_list_item('Trend context'),
            bulleted_list_item('Risk note')
        ]),

        heading(2, '🚀 Implementation Plan'),

        heading(3, 'Phase 1: Foundation (1 day)'),
        bulleted_list_item('Import vela-design-system.css in main.tsx'),
        bulleted_list_item('Add Google Fonts to index.html'),
        bulleted_list_item('Test fonts load correctly'),
        bulleted_list_item('Verify CSS variables work'),

        heading(3, 'Phase 2: Components (2-3 days)'),
        bulleted_list_item('Replace buttons with Vela buttons'),
        bulleted_list_item('Update card styling'),
        bulleted_list_item('Migrate to SignalCard component'),
        bulleted_list_item('Apply badge system for price changes'),

        heading(3, 'Phase 3: Pages (2 days)'),
        bulleted_list_item('Update Home page'),
        bulleted_list_item('Update AssetDetail page'),
        bulleted_list_item('Update TrackRecord page'),
        bulleted_list_item('Add PageHeader components'),

        heading(3, 'Phase 4: Polish (1-2 days)'),
        bulleted_list_item('Test dark mode'),
        bulleted_list_item('Test accessibility (keyboard, screen reader)'),
        bulleted_list_item('Add loading states'),
        bulleted_list_item('Refine animations'),

        paragraph('Total: 6-8 days'),

        heading(2, '💻 Quick Start'),
        code_block('// In src/main.tsx\nimport \'./styles/vela-design-system.css\';', 'typescript'),
        code_block('<!-- In index.html -->\n<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;900&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">', 'html'),

        heading(3, 'Use Components'),
        code_block('import { Button, SignalCard, PageHeader } from \'./components/VelaComponents\';\n\n<PageHeader\n  title="Vela"\n  subtitle="Always watching the markets for you"\n/>\n\n<SignalCard\n  asset="Bitcoin"\n  signal="BUY"\n  price="$45,230"\n  priceChange="+2.3%"\n  reason="Price broke above resistance"\n/>\n\n<Button variant="buy" onClick={handleBuy}>\n  Execute Trade\n</Button>', 'typescript'),

        heading(2, '🎯 Key Design Decisions'),

        toggle('Why Semantic Tokens?', [
            bulleted_list_item('Remap for themes without touching components'),
            bulleted_list_item('Clear intent vs arbitrary hex codes'),
            bulleted_list_item('Future-proof for multi-theme support')
        ]),

        toggle('Why Three-Pillar Story?', [
            bulleted_list_item('Every feature maps to a clear value'),
            bulleted_list_item('Maintains consistency'),
            bulleted_list_item('Prevents messaging feature creep')
        ]),

        toggle('Why Trust Language?', [
            bulleted_list_item('Trading apps need explicit trust-building'),
            bulleted_list_item('Users worry about automation'),
            bulleted_list_item('Transparency reduces anxiety')
        ]),

        toggle('Why Dark Mode?', [
            bulleted_list_item('User preference for 24/7 tools'),
            bulleted_list_item('Reduces eye strain'),
            bulleted_list_item('Expected feature in 2026'),
            bulleted_list_item('"Free" with semantic tokens')
        ]),

        heading(2, '📂 File Locations'),
        paragraph('/Users/henry/crypto-agent-frontend/'),
        bulleted_list_item('VELA-README.md - Quick start guide'),
        bulleted_list_item('VELA-BRAND-SYSTEM-V2.md - Complete details'),
        bulleted_list_item('NOTION-UPDATE.md - Full Notion version'),
        bulleted_list_item('NOTION-CONDENSED.md - Condensed version'),
        bulleted_list_item('src/styles/vela-design-system.css - Enhanced CSS'),
        bulleted_list_item('src/components/VelaComponents.tsx - TypeScript components'),

        heading(2, '🎨 Data Visualization Colors'),
        paragraph('Each color has semantic meaning, not just sequencing:'),
        bulleted_list_item('Purple (data-1): Brand/Vela signals'),
        bulleted_list_item('Blue (data-2): Trend strength'),
        bulleted_list_item('Green (data-3): Profitability'),
        bulleted_list_item('Amber (data-4): Volatility'),
        bulleted_list_item('Red (data-5): Risk/drawdown'),
        bulleted_list_item('Pink (data-6): Sentiment'),

        heading(2, '✅ What Makes This Special'),
        bulleted_list_item('Cohesive & Complete - Everything speaks same design language'),
        bulleted_list_item('Implementation-Ready - Working code, not just concepts'),
        bulleted_list_item('Grounded Voice - Plain language people understand'),
        bulleted_list_item('Trust-First - Emphasizes control, honest about risks'),
        bulleted_list_item('Accessible & Modern - Dark mode, WCAG AA+, reduced motion'),
        bulleted_list_item('Future-Proof - Semantic tokens enable easy theming'),

        heading(2, '💡 Future Opportunities'),

        heading(3, 'Dynamic State Theming'),
        paragraph('Background shifts based on portfolio:'),
        bulleted_list_item('Mint tint = positive days'),
        bulleted_list_item('Lavender = neutral'),
        bulleted_list_item('Amber = volatile'),

        heading(3, 'Motion Identity'),
        bulleted_list_item('Star fades in at boot'),
        bulleted_list_item('Cards pop with stagger'),
        bulleted_list_item('"Alive but not hectic"'),

        heading(3, 'Star as Brand Signature'),
        bulleted_list_item('Pulses on new signal'),
        bulleted_list_item('Data marker in charts'),
        bulleted_list_item('Recognizable motion element'),

        heading(2, '✅ Brand Checklist'),
        paragraph('Before publishing, ensure:'),

        paragraph('Visual:'),
        bulleted_list_item('Uses semantic tokens'),
        bulleted_list_item('Works in dark mode'),
        bulleted_list_item('Meets WCAG AA+'),
        bulleted_list_item('Respects reduced-motion'),

        paragraph('Voice:'),
        bulleted_list_item('Maps to three pillars'),
        bulleted_list_item('Includes trust language'),
        bulleted_list_item('Active voice'),
        bulleted_list_item('Plain English'),

        paragraph('Message:'),
        bulleted_list_item('Emphasizes control'),
        bulleted_list_item('Emphasizes clarity'),
        bulleted_list_item('Includes safety language'),
        bulleted_list_item('Honest about limitations'),

        divider(),
        callout('🎉', 'The system works with your existing neobrutalist design, adds strategic color for meaning, and is ready to implement today.'),
        paragraph('Philosophy: "Would a smart, helpful friend say it this way? Does this emphasize user control and trust?"'),
        paragraph('Version: 2.0 | Status: ✅ Ready | Date: Feb 15, 2026'),
    ]

    print("Adding brand system blocks to Design page...")
    result = add_blocks(DESIGN_PAGE_ID, brand_blocks)

    if result:
        print("✅ Brand System V2.0 added to Notion Design page!")
    else:
        print("❌ Failed to add brand system")

if __name__ == '__main__':
    main()
