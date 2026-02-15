# Vela Session Scripts

Automation scripts for managing Vela project documentation and workflows.

## Quick Start (Recommended)

Shell aliases have been added to your `~/.zshrc`. Use these from anywhere:

```bash
# Reload your shell config (only needed once after setup)
source ~/.zshrc

# Navigate to project
vela

# Start of session - see status, tasks, recent changes
vela-start

# End of session - log decisions and tasks
vela-end

# Manage tasks
vela-tasks list                    # List all tasks
vela-tasks list "Next"             # List tasks with specific status
vela-tasks add "Task name"         # Add task to backlog
```

## Alternative: Run Scripts Directly

If you prefer to run scripts directly (or aliases aren't working):

```bash
# First, navigate to the project directory
cd /Users/henry/crypto-agent-frontend

# Start of session
python3 scripts/start_session.py

# End of session
python3 scripts/end_session.py

# Manage tasks
python3 scripts/notion_tasks.py list
python3 scripts/notion_tasks.py list "Next"
python3 scripts/notion_tasks.py add "Task name" "Backlog" "UI" "High" "Description"
```

## Script Details

### `start_session.py`
**When to use:** At the beginning of each coding session

**What it shows:**
- Current git branch and uncommitted changes
- Recent changes from last 7 days (from Notion Changelog)
- Tasks currently "In Progress"
- Tasks marked as "Next" (ready to start)
- Backlog count with high-priority warnings

**Example output:**
```
🚀 START OF SESSION - Status Update
📌 Current branch: main
✓ Working directory clean

📝 RECENT CHANGES (last 7 days)
  [Infra] Add automated Notion documentation system
  [UI] Restructure Notion workspace

✅ YOUR TASKS
🔄 IN PROGRESS: None

⏭️ NEXT (ready to work on):
  [Infra] Deploy frontend to production (Priority: High)

📋 BACKLOG: 5 tasks

Ready to code! 🚀
```

### `end_session.py`
**When to use:** At the end of each coding session

**What it does:**
1. Shows recent git commits (Changelog auto-updated)
2. Prompts you to log important decisions with:
   - What decision was made
   - Why you made it
   - What alternatives you considered
   - Links to Claude conversation URL for context
3. Prompts you to add follow-up tasks with:
   - Task name, status, area, priority
   - Description
   - Links to Claude conversation URL for context

**Interactive:** The script will ask you questions - just answer them!

### `notion_tasks.py`
**When to use:** Anytime you want to view or manage tasks

**Commands:**
```bash
# List all tasks
vela-tasks list

# List tasks by status
vela-tasks list "Next"
vela-tasks list "In progress"
vela-tasks list "Backlog"

# Add a new task (quick)
vela-tasks add "Task name"

# Add a task with full details
vela-tasks add "Task name" "Next" "UI" "High" "Detailed description"

# Update task status (need task ID from list command)
vela-tasks update <task_id> "Done"
```

## Troubleshooting

### "command not found: vela-start"
Solution: Reload your shell configuration
```bash
source ~/.zshrc
```

### "can't open file"
This means you're not in the project directory. Either:
1. Use the aliases (recommended): `vela-start`
2. Or cd first: `cd /Users/henry/crypto-agent-frontend && python3 scripts/start_session.py`

### Scripts don't find .notion-config.json
The scripts must be run from the project root. Use the aliases or `cd` to the project first.

## Integration with Notion

All these scripts sync with your Notion workspace:
- **start_session.py** reads from Notion Tasks & Changelog databases
- **end_session.py** writes to Notion Decisions & Tasks databases
- **notion_tasks.py** reads/writes to Notion Tasks database

Changes appear instantly in Notion at: https://notion.so/3088414f7d9b80cc855ad59086a39823
