# Session Routines & Project Management

> *Extracted from CLAUDE.md — see CLAUDE.md for project overview and engineering principles.*

---

## Session Start Routine

1. **Read CLAUDE.md and MEMORY.md in full (MANDATORY).** Every session starts by reading both files end-to-end. This ensures all engineering preferences, processes, conventions, completed work, and pending decisions are fresh in context — not assumed from prior sessions.
2. Run `vela-start` to see project status
3. Review any "Next" priority tasks from Notion
4. Check git status for uncommitted changes on both repos

---

## Session End Routine

1. Ensure all tests pass and CI is green
2. Commit with conventional commit message
3. Push to trigger Vercel deployment
4. Verify CI passes after push (`gh run list`)
5. **Release note proposal (if applicable):** If the session shipped a user-facing feature or significant change, draft a release note entry for the `release_notes` table and propose it to the user for approval before the session ends. Follow the established voice: benefit-focused, 1-2 sentences, no jargon, emoji prefix. Once approved, insert into the production `release_notes` table. The `publish-scheduled` cron will broadcast it to Telegram and the website changelog pulls live from the table.
6. **Clean up worktrees (MANDATORY):** Stale Claude Code worktrees cause vitest to discover duplicate test files that fail with React errors. For each worktree:
   ```bash
   git worktree list                                    # see what exists
   ```
   For each `.claude/worktrees/<name>` entry, check for uncommitted work:
   ```bash
   cd .claude/worktrees/<name> && git status && cd -     # check for changes
   ```
   Then **decide for each worktree** — no skipping:
   - **Has uncommitted changes you want:** commit them to main first, then remove
   - **Has uncommitted changes you don't want:** `git worktree remove --force .claude/worktrees/<name>`
   - **Clean (no changes):** `git worktree remove .claude/worktrees/<name>`

   After all worktrees are handled:
   ```bash
   git worktree prune                                   # clean orphaned refs
   ```
7. Update MEMORY.md following the routing rules in `documentation-maintenance.md` — detail goes in topic files, main file stays ≤200 lines
8. **Session retrospective (MANDATORY — FULL, NOT SUMMARIZED):** Before closing out, review the session's work with the user. This must be a **thorough, detailed retrospective** — not a condensed bullet list. Cover every section below with specific examples and honest reflection:
   - **What was accomplished:** List each distinct piece of work with enough detail that someone reading it cold understands what shipped. Include file paths, deployment targets, and what changed.
   - **Prompting feedback:** How could the user have prompted better? Were instructions unclear, too vague, or missing context that caused rework? Call out specific moments. Be honest — don't just say "your prompts were great."
   - **Efficiency feedback:** Where could Claude have been better? Identify specific wasted steps, wrong approaches tried first, things that should have been anticipated, unnecessary round-trips. This is the most important section — be self-critical.
   - **Learnings:** Concrete reusable insights from this session. Not vague takeaways — specific patterns, gotchas, or decisions that future sessions should know about.
   - **CLAUDE.md / MEMORY.md updates needed:** Explicitly state what was updated and whether anything still needs updating. If nothing, say so.
   - **Open items:** Anything left unfinished, blocked, or deferred. If nothing, say so.

   **DO NOT summarize or abbreviate the retro.** The user has repeatedly asked for full retrospectives. A 3-bullet summary is not a retro.
9. **Remind user to run `vela-end`** — this is interactive (prompts for decisions + tasks) and must be run by the user in terminal, not by Claude Code

---

## Notion Integration

- **Automatic:** Every `git commit` triggers `scripts/git_to_notion.py` via post-commit hook, logging the commit to the Notion changelog
- **Manual (user runs):** `vela-end` logs session decisions + follow-up tasks to Notion (interactive — uses `input()` prompts)
- **Manual (user runs):** `vela-start` shows project status from Notion
- Claude Code should **remind the user** to run `vela-end` at the end of every session

---

## Architectural Decision Records (ADRs)

For significant architectural choices, document in Notion "Decisions" database using this format:

### Template
```markdown
# ADR-XXX: [Decision Title]

## Context
What problem are we solving? What constraints exist?

## Decision
What did we choose? Why this approach?

## Consequences
**Pros:** What do we gain?
**Cons:** What are the tradeoffs?
**Alternatives Considered:** What did we reject and why?

## Status
Implemented | In Progress | Rejected
```

### Example ADRs Logged
- ADR-001: Semantic Color Tokens for Signal Status
- ADR-002: Supabase for Backend (vs. custom API)
- ADR-003: Paper Trading Before Real Trading
- ADR-004: Signal Engine 3-Layer Refactor
- ADR-005: Transaction Layer Architecture
- ADR-006: Brand Identity Redesign

---

## Deferred Work Standards

Work that's explicitly deferred (via plan scope challenge or mid-session decisions) must be captured in MEMORY.md's "Pending Decisions" section with structured entries:

- **What:** One-line description of the work
- **Why:** Concrete problem solved or value unlocked — not vague ("improve UX") but specific ("users can't tell which trades are BB2 vs EMA at a glance")
- **Context:** Enough detail to pick up the work in 3 months without re-deriving motivation, current state, or starting point. Include relevant file paths, data shapes, and constraints discovered during the session
- **Blocked by / depends on:** Prerequisites and ordering constraints, if any

**A deferred item without context is worse than no deferred item.** It creates phantom tasks that nobody can action.

Every plan must include a **"NOT in scope"** section listing deferred items with a one-line rationale per item. This prevents scope from silently expanding and creates an explicit record of what was considered and intentionally left out.

---

## If You're Stuck

- Check CLAUDE.md for conventions
- Review recent Notion changelog for context
- Check Notion Decisions database for past architectural choices
- Read relevant ADRs before proposing alternative approaches
