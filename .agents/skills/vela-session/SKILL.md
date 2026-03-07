---
name: vela-session
description: Session start and end orchestration — reads project state, queries Notion tasks, checks CI/git health, conducts retrospectives, and logs to Notion. Use at beginning or end of a Claude Code session.
---

# Vela Session Orchestration

Automates the session start and end routines from `docs/claude-reference/session-routines.md`. Orchestrates across Notion MCP, GitHub CLI, and local git to ensure nothing is missed.

## Session Start

**Triggers:** "let's start", "what should we work on", "session start", beginning of a new conversation.

Run these steps in order:

### Step 1: Load Project Context
- Read `CLAUDE.md` and `MEMORY.md` in full (MANDATORY — every session)
- Read any topic files referenced in MEMORY.md's Topic File Index if relevant to upcoming work

### Step 2: Query Notion for Active Tasks
Use Notion MCP to search the Vela project workspace:
- Search for tasks with status "In Progress" or "Next" priority
- Database ID: `3088414f7d9b811ebd25ffb6df813c5e` (Tasks)
- Display: task title, priority, status, assignee

### Step 3: Check Git & CI Health
Run in parallel:
```bash
# Frontend repo
git -C /Users/henry/crypto-agent-frontend status
git -C /Users/henry/crypto-agent-frontend log --oneline -5

# Backend repo
git -C /Users/henry/crypto-agent status
git -C /Users/henry/crypto-agent log --oneline -5

# CI health (both repos)
gh run list --limit 3 --repo henry/crypto-agent-frontend
gh run list --limit 3 --repo henry/crypto-agent
```

### Step 4: Display Session Brief
Format output as a structured summary:

```
## Session Brief

### Active Notion Tasks
- [In Progress] Task title — priority
- [Next] Task title — priority

### Git Status
- Frontend: [clean / X uncommitted files]
- Backend: [clean / X uncommitted files]

### CI Health
- Frontend: [passing / failing — run #XXX]
- Backend: [passing / failing — run #XXX]

### Recommended Next Step
[Based on Notion priorities + any CI failures that need fixing first]
```

**Priority logic:** CI failures > uncommitted work from prior sessions > "In Progress" Notion tasks > "Next" priority tasks.

---

## Session End

**Triggers:** "let's wrap up", "session end", "end session", "that's it for today".

Run these steps in order:

### Step 1: Verify CI is Green
```bash
gh run list --limit 3 --repo henry/crypto-agent-frontend
gh run list --limit 3 --repo henry/crypto-agent
```
If any runs are failing, **flag immediately** — do not proceed to retro until CI is addressed.

### Step 2: Check Deployments (if code was pushed)
```bash
# Frontend: check Vercel
vercel ls --limit 3 2>/dev/null || echo "Vercel CLI not available"

# Backend: check if deploy was run
git -C /Users/henry/crypto-agent log --oneline -3
```

### Step 3: Conduct FULL Session Retrospective
Generate a thorough, detailed retrospective — **never summarize or abbreviate**. Cover all 6 sections:

1. **What was accomplished:** List each distinct piece of work with file paths, deployment targets, and what changed. Someone reading it cold should understand what shipped.

2. **Prompting feedback:** Honest critique of user's prompts. Were instructions unclear, too vague, missing context? Call out specific moments. Don't just say "prompts were great."

3. **Efficiency feedback:** Self-critical assessment. Identify wasted steps, wrong approaches tried first, things that should have been anticipated, unnecessary round-trips. This is the most important section.

4. **Learnings:** Concrete, reusable insights. Not vague takeaways — specific patterns, gotchas, or decisions future sessions should know about.

5. **CLAUDE.md / MEMORY.md updates needed:** Explicitly state what was updated and whether anything still needs updating.

6. **Open items:** Anything unfinished, blocked, or deferred. If nothing, say so.

### Step 4: Update MEMORY.md
- Read current MEMORY.md
- Propose edits: completed items, new patterns, changed facts, updated counts
- Present diff to user for approval before saving

### Step 5: Log to Notion
Use Notion MCP to update the Vela project workspace:
- **Decisions database** (`3088414f7d9b8123952ae7320be53b4f`): Log any architectural decisions made during the session
- **Tasks database** (`3088414f7d9b811ebd25ffb6df813c5e`): Update task statuses (mark completed, add new follow-up tasks)
- **Changelog database** (`3088414f7d9b8152a806d1109be2af30`): Add session summary entry

### Step 6: Remind User
Always end with:
> **Reminder:** Run `vela-end` in terminal to complete interactive Notion logging (decisions + tasks prompts).

---

## Interaction with Existing Scripts

| Script | What it does | Skill's relationship |
|--------|-------------|---------------------|
| `vela-start` (Python) | Shows git changes, Notion tasks, recent activity | Skill does same via MCP — use either, not both |
| `vela-end` (Python) | Interactive `input()` prompts for decisions + tasks | Skill handles Claude's part (retro, MEMORY.md, Notion); user still runs `vela-end` for interactive logging |
| `git_to_notion.py` (post-commit hook) | Logs each commit to Notion changelog | Automatic — skill doesn't duplicate this |

## Key References
- Session routines: `docs/claude-reference/session-routines.md`
- Retrospective format: 6 sections, never abbreviated
- Notion workspace: Vela project (Tasks, Changelog, Decisions databases)
