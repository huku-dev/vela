# Documentation Maintenance Standard

> *Extracted from CLAUDE.md — see CLAUDE.md for project overview and engineering principles.*

---

## Line Budgets

| File | Max Lines | Current | What It Contains |
|------|-----------|---------|-----------------|
| `CLAUDE.md` | 200 | ~177 | Project identity, architecture, engineering preferences, critical rules, commands, reference doc index |
| `MEMORY.md` | 200 | ~139 | Session-relevant facts, patterns, key counts, topic file index |
| Topic files (`memory/*.md`) | ~150 | varies | Single-subject detail (research, decisions, architecture, incidents) |
| Reference docs (`docs/claude-reference/*.md`) | no limit | varies | Detailed procedures, checklists, standards — loaded on-demand |

**MEMORY.md's 200-line limit is a hard ceiling.** Auto-memory silently truncates beyond 200 lines — content past the limit is invisible every session. This caused a months-long data loss incident where completed items, topic files, and key decisions were silently dropped.

---

## Routing Rules — Where Does New Information Go?

**Key principle:** Main files are *indexes*. They point to detail, they don't contain it.

Apply this decision tree for any new piece of information:

| Question | If YES → | If NO ↓ |
|----------|---------|---------|
| Is it a project-wide convention, architectural rule, or engineering preference? | `CLAUDE.md` (≤3 lines) or a reference doc (if detailed) | ↓ |
| Is it a detailed procedure (deploy steps, test protocol, QA checklist)? | Reference doc in `docs/claude-reference/` | ↓ |
| Is it a session fact that future sessions need (test count, completed item, new pattern)? | `MEMORY.md` (≤2 lines per item) | ↓ |
| Is it a detailed topic with context that would take >2 lines? | Topic file in `memory/` directory + 1-line pointer in MEMORY.md | ↓ |
| Is it a one-off decision or investigation that won't affect future sessions? | Don't persist — it lives in the session transcript | — |

### Anti-Patterns

- **Don't** dump a 20-line summary into MEMORY.md — create a topic file
- **Don't** add a 10-line procedure to CLAUDE.md — put it in a reference doc
- **Don't** create a topic file without a pointer in MEMORY.md's Topic File Index — orphan file
- **Don't** leave a pointer in MEMORY.md for a deleted topic file — broken reference
- **Don't** let MEMORY.md exceed 200 lines "just this once" — silent truncation = data loss
- **Don't** add the same fact to both CLAUDE.md and MEMORY.md — single source of truth

---

## When Each File Gets Updated

| File | When | Approval |
|------|------|----------|
| `CLAUDE.md` | Conventions, commands, architecture, or critical rules change. **Not every session.** | User approval required |
| `MEMORY.md` | Every session end — completed items, new patterns, changed facts | Claude updates, user reviews |
| Topic files | When a new subject needs >2 lines. When an existing topic has developments. | Claude creates/updates during or at end of session |
| Reference docs | When procedures, checklists, or detailed standards change | User approval, same commit as code change |

---

## Topic File Lifecycle

### Creation
Any time Claude would add **>2 lines of detail** to MEMORY.md about a single subject → create a topic file instead.

### Naming
`memory/<descriptive-kebab-case>.md` — e.g., `v7-ema-cooldown.md`, `cron-schedule.md`

### Structure
Each topic file starts with a **1-line summary**, then details. No YAML frontmatter needed.

### Pointer
Add a 1-line entry to MEMORY.md's **Topic File Index** section:
```
- `memory/<filename>.md` — One-line description
```

### Maintenance
When updating a topic, edit the topic file directly. Only update the MEMORY.md pointer if the topic's scope changed significantly.

### Archival
If a topic becomes irrelevant (feature removed, decision reversed):
1. Delete the topic file
2. Remove its pointer from MEMORY.md's Topic File Index
3. Never leave orphan pointers or orphan files

---

## MEMORY.md Update Procedure (Session End)

1. **Read** current MEMORY.md — note line count
2. **Identify** what changed this session: completed items, new patterns, new facts
3. **Route** each change:
   - ≤2 lines → update MEMORY.md directly
   - >2 lines detail → create/update topic file, add 1-line pointer in MEMORY.md
4. **Compress** if line count exceeds 180:
   - Move completed plan items older than 2 sessions to a topic file
   - Collapse verbose entries to 1-line summaries + topic file links
   - Remove stale information (counts that changed, decisions that were reversed)
5. **Verify** final line count is **≤200**

---

## CLAUDE.md Update Procedure

1. **Only update** when conventions, commands, architecture, or critical rules change
2. **Check first:** does this belong in a reference doc instead?
3. If adding a Critical Rule, keep total manageable (currently 15)
4. If adding to the Reference Documentation table, verify the doc exists and path is correct
5. **Compress** if line count exceeds 190:
   - Move detailed procedures to reference docs
   - Collapse verbose rules to single-line summaries
6. **Verify** final line count is **≤200**

---

## Current Topic File Inventory

Maintained in MEMORY.md's Topic File Index section. As of March 2026, 15 topic files in `memory/`:

| File | Subject |
|------|---------|
| `v7-ema-cooldown.md` | EMA cooldown after stop-loss |
| `hip3-builder-perps.md` | Multi-asset backtest results |
| `signal-improvement-pipeline.md` | Postmortem + signal-review architecture |
| `transaction-layer.md` | ADR-005 exchange/wallet/modes |
| `security-hardening.md` | Security fixes and audit |
| `pricing.md` | Product pricing decisions |
| `product-decisions-2026-03-02.md` | Product direction + feature rationale |
| `pending-decisions.md` | Deferred work with context |
| `marketing-strategy.md` | Go-to-market, brand, social |
| `go-live-status.md` | Launch readiness status |
| `outstanding-testing.md` | Remaining test coverage gaps |
| `research-v8-entry-filters.md` | REJECTED entry filter research |
| `multi-agent-system.md` | Health Monitor + Signal Triage + Content Pipeline |
| `cron-schedule.md` | Cron job timing + spacing |
| `social-media-playbook.md` | Social media rules, templates, voice, image strategy |
