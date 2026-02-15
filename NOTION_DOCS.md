# Vela Notion Documentation System

## Overview

Your Vela project now has an **automated documentation workspace in Notion** that updates whenever you commit code. This system helps you stay oriented with what's happening in the project, even if you're not technical.

## What's in Your Notion Workspace

Your Notion page (https://notion.so/3088414f7d9b80cc855ad59086a39823) contains:

### 📋 Overview
Plain-English explanation of:
- What Vela does
- How the signal logic works
- Current assets covered
- System architecture
- Glossary of technical terms

### ⚡ Quick Reference
Your dashboard for:
- Key links (Supabase, GitHub, deployment URL)
- Current signal parameters (EMA, RSI, etc.)
- Asset coverage
- Data refresh intervals
- Quick commands and file structure

### 🎨 Design System
Visual design decisions:
- Color palette (green/red/grey for signals)
- Typography standards
- Component patterns
- Spacing and layout rules
- Icon usage

### 📊 Product & Business
Strategic context:
- Product vision
- Target users
- Success metrics (win rate, accuracy)
- Roadmap themes
- Known risks and mitigations

### ✍️ Content & Messaging
Communication guidelines:
- Tone and voice (clear, confident, educational)
- Key messages
- Signal brief style guide
- Notification templates

### ⚙️ Operations & Deployment
Practical operations:
- Deployment process
- Environment setup
- Monitoring checklist
- Incident response steps
- Backup and recovery

## Databases (Your Living Records)

### 📝 Changelog
Every code change automatically creates an entry here with:
- **Summary**: One-line description
- **Detail**: Plain-English explanation
- **Area**: Signals / Data / UI / Infra / Risk controls
- **Impact**: User-facing / Internal / Breaking
- **Date**, **Version**, **Status**

### 🧭 Decisions
Log important choices you make:
- Why you picked certain parameters
- Which approach you chose and why
- What alternatives you considered
- Current status (Active / Replaced / Deprecated)

### ✅ Tasks & Roadmap
Kanban board for tracking work:
- **Backlog**: Ideas and future work
- **Next**: Your current focus (3-5 items)
- **In Progress**: What you're actively working on
- **Blocked**: Stuck items
- **Done**: Completed work

### 🎨 Design Decisions
Track visual and UX choices:
- UI/UX patterns you standardize on
- Color and typography choices
- Layout decisions
- Accessibility considerations

### 📅 Content Calendar
Manage all written content:
- Brief templates
- Notification copy
- Help text
- Error messages
- Marketing copy

## How the Automation Works

### Git Hook Magic
Every time you (or Claude) makes a git commit:

1. **Post-commit hook fires** (`.git/hooks/post-commit`)
2. **Python script runs** (`scripts/git_to_notion.py`)
3. **Claude API analyzes** the git diff and commit message
4. **Notion entry created** with plain-English summary

This means **zero manual work** - just commit your code normally and your Notion updates automatically!

### What Gets Analyzed
The script sends to Claude:
- Commit message
- List of changed files
- Git diff (what actually changed)

Claude then generates:
- **Summary**: Short one-liner (under 80 chars)
- **Detail**: 2-4 sentences explaining the change
- **Area**: Which part of the system (Signals, UI, Data, etc.)
- **Impact**: Who cares about this change

### Skipping Automation
If you want to commit without updating Notion, start your commit message with `[skip-notion]`:

```bash
git commit -m "[skip-notion] WIP: testing something"
```

## How to Use This System

### Daily Workflow

**Starting a Session:**
```bash
vela-start
```
This shows you:
- Git status
- Recent changes (last 7 days)
- Tasks in progress
- Next tasks ready to work on

**During the Session:**
- Code with Claude as usual
- Git commits auto-update Notion Changelog

**Ending the Session:**
```bash
vela-end
```
This prompts you to:
- Log important decisions
- Add follow-up tasks
- Link everything to the Claude conversation URL

### When Making Decisions

When you change something significant (signal parameters, data sources, UI patterns):

1. Go to **Decisions** database
2. Add a new entry:
   - **Decision**: "Changed RSI threshold from 40 to 35"
   - **Why**: "Too many false signals in choppy markets, narrower threshold filters better"
   - **Alternatives**: "Tried ADX filter but it was too restrictive"
   - **Status**: Active

This prevents you forgetting why you made choices 6 months later!

### End of Coding Session

At the end of each session, run the automation script:

```bash
vela-end
```

This will:
- Show recent commits (Changelog already auto-updated)
- Prompt you to log important decisions with conversation links
- Prompt you to add follow-up tasks with conversation links
- Everything is dated automatically!

### Tracking Design Changes

When you change colors, layouts, or component styles:

1. Go to **Design Decisions** database
2. Log the change:
   - **Decision**: "Use left-border color instead of card background for signal cards"
   - **Category**: UI/UX
   - **Why**: "Better accessibility, cleaner visual hierarchy"
   - **Status**: Active

### Managing Content

When adding or changing user-facing text:

1. Go to **Content Calendar** database
2. Add the copy:
   - **Content**: "Bullish signal notification template"
   - **Type**: Notification
   - **Copy**: "🟢 {ASSET} turned green: {REASON}"
   - **Status**: Live

## Configuration Files

### `.notion-config.json`
Contains your Notion integration credentials and database IDs. **DO NOT commit this to git** (it's in `.gitignore`).

```json
{
  "notion_token": "ntn_...",
  "vela_page_id": "...",
  "changelog_db_id": "...",
  "decisions_db_id": "...",
  "tasks_db_id": "...",
  "design_decisions_db_id": "...",
  "content_calendar_db_id": "..."
}
```

## Scripts

All automation scripts are in `scripts/`:

- `setup_notion.py` - Initial workspace creation (already ran)
- `populate_overview.py` - Adds Overview content (already ran)
- `add_quick_reference.py` - Adds Quick Reference (already ran)
- `add_design_and_product.py` - Adds Design/Product/Content/Ops sections (already ran)
- `add_initial_changelog.py` - Adds first changelog entries (already ran)
- `git_to_notion.py` - **The main automation** (runs on every git commit)

## Customization

### Adding New Sections
To add more sections to your Notion page, create a new script following the pattern:

```python
import json
import requests

with open('.notion-config.json', 'r') as f:
    config = json.load(f)

# Add blocks to config['vela_page_id']
```

### Changing Changelog Categories
Edit `git_to_notion.py` and modify the `create_simple_entry()` function's area detection logic.

### Adding New Databases
Use the `create_database()` function pattern from `setup_notion.py` and save the new database ID to `.notion-config.json`.

## Troubleshooting

### Notion not updating after commits
1. Check that `.git/hooks/post-commit` is executable: `ls -l .git/hooks/post-commit`
2. Run manually: `python3 scripts/git_to_notion.py`
3. Check for errors in terminal output

### Claude API errors
- Verify `ANTHROPIC_API_KEY` is set: `echo $ANTHROPIC_API_KEY`
- Check API credits at https://console.anthropic.com
- System falls back to simple parsing if API unavailable

### Notion API errors
- Verify your integration has access to the Vela page
- Check token is valid in `.notion-config.json`
- Re-share the page with the integration if needed

## Tips for Non-Technical Owners

### When Claude mentions file paths
Look them up in **Quick Reference → File Structure Cheat Sheet**

Example: "I updated `src/hooks/useData.ts`" → Check Quick Reference → "Data fetching: src/hooks/useData.ts"

### When Claude uses jargon
Check **Overview → Glossary** for definitions

Example: "I changed the EMA cross logic" → Glossary → "EMA (Exponential Moving Average)"

### When you want to understand a change
Go to **Changelog** and filter by **Area** or **Date**

Example: "What changed in the UI last week?" → Changelog → Filter Area = UI, Date = last 7 days

### When deciding what to build next
Use **Tasks & Roadmap** to organize:
- Dump all ideas in **Backlog**
- Prioritize 3-5 items to **Next**
- Work on one at a time in **In Progress**
- Move to **Done** when complete

## Next Steps

1. **Bookmark your Notion page**: https://notion.so/3088414f7d9b80cc855ad59086a39823
2. **Test the automation**: Make a small code change, commit it, check Notion
3. **Start adding tasks**: Populate your Tasks & Roadmap with upcoming work
4. **Log your first decision**: Add an entry when you make your next important choice

Your documentation is now a living system that grows with your project! 🎉
