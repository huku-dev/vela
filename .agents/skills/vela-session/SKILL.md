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

### Step 6: Draft Release Notes (if user-facing work shipped)
If the session included user-facing changes (new features, UX improvements, new pages), draft release notes for the public changelog at `getvela.xyz/changelog`.

**Voice guidelines (study Slack's release notes for tone):**
- Warm, conversational, occasionally witty. Never corporate.
- Explain what changed and why a user should care, in 1-2 sentences.
- Self-aware humor is good. "Because DND means DND" energy.
- No em dashes. No jargon. No "we're excited to announce."

**For each user-facing item, prepare an INSERT:**
```sql
INSERT INTO release_notes (title, body, emoji, published_at, link_url, link_text, category, is_major)
VALUES ('Short title', '1-2 sentence description in Vela voice', '🎯', 'YYYY-MM-DD', 'https://...', 'Try it out', 'feature', false);
```

**Fields:**
- `title`: Short, punchy. "Share your trades" not "Added trade sharing functionality"
- `body`: 1-2 sentences. What changed + why it matters to the user. Slack voice. Always frame in terms of user value.
- `emoji`: One emoji that captures the vibe
- `published_at`: Date the change shipped
- `link_url` + `link_text`: Optional CTA if users can try the feature (e.g. Telegram bot link, app page)
- `category`: One of `feature`, `improvement`, `fix`
- `is_major`: Discuss with user. Major releases get hero card treatment on the changelog page.

**Major vs minor classification (always confirm with user):**
- **Major (`is_major = true`):** New capabilities that fundamentally expand what Vela can do. Examples: platform launch, new product surface (Telegram bot), new asset class support, new execution venue. These get hero cards with optional images and prominent CTAs.
- **Minor (`is_major = false`):** Improvements, refinements, and fixes to existing functionality. Examples: redesigned cards, better emails, price source changes, language updates. These render as compact timeline entries.
- When in doubt, default to minor. Ask the user: "Should any of these be flagged as a major release?"

Present the draft to the user for approval before inserting. Insert into production (`dikybxkubbaabnshnreh`).

**Broadcast behavior:** New release notes with `broadcast_at = NULL` get automatically broadcast to Telegram users on the next cron tick (max 1 broadcast per day, extras batch to next day).

**Skip this step if:** The session was purely backend/infra with no user-visible changes.

### Step 7: Remind User
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
