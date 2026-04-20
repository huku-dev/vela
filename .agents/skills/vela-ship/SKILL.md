---
name: vela-ship
description: Ship & verify pipeline — pre-flight checks, CI monitoring, deployment verification, Notion task updates, and cross-repo coordination via GitHub. Use when deploying, merging, or shipping features.
context: fork
---

# Vela Ship & Verify

End-to-end deployment pipeline that orchestrates pre-flight checks, CI monitoring, deployment verification, and post-ship documentation. Uses GitHub CLI/MCP for cross-repo coordination and Notion MCP for task tracking.

## Triggers
"ship this", "deploy", "merge to main", "push to production", "let's ship", "ready to merge"

---

## Pre-Flight Checks (MUST pass before any push)

Run all checks in parallel:
```bash
# Frontend
cd /Users/henry/crypto-agent-frontend
npm run test -- --run        # 522+ tests must pass
npm run type-check           # TypeScript errors = 0
npm run build                # Build must succeed
```

If ANY check fails, **STOP immediately**. Fix the issue before proceeding.

---

## Classify Scope

Determine what's changing:
```bash
# What files changed?
git -C /Users/henry/crypto-agent-frontend diff --name-only develop..HEAD
git -C /Users/henry/crypto-agent diff --name-only develop..HEAD 2>/dev/null
```

| Scope | Criteria | Pipeline |
|-------|----------|----------|
| Frontend-only | Only `crypto-agent-frontend/` changes | Push → CI → Vercel auto-deploy |
| Backend-only | Only `crypto-agent/` changes | Push → CI → `deploy.sh --staging` → verify → `deploy.sh --prod` |
| Cross-repo | Both repos have changes | Ship backend first → verify → ship frontend → verify both |

---

## Ship Pipeline

### Step 1: Push & Monitor CI
```bash
touch /tmp/vela-deploy.lock
git push origin develop
```

Then poll CI status every 15 seconds:
```bash
# Wait for run to appear
sleep 5
gh run list --limit 1

# Watch the run
gh run watch $(gh run list --limit 1 --json databaseId -q '.[0].databaseId')
```

**If CI fails:**
```bash
gh run view <run-id> --log-failed
```
STOP. Fix the failure. Push the fix. Re-verify. Never proceed with a red CI.

### Step 2: Verify Deployment

**Frontend (Vercel auto-deploys from develop):**
```bash
vercel ls --limit 3 2>/dev/null
```
Check that the latest deployment is "Ready" status.

**Backend (requires manual deploy):**
Instruct the user:
> Backend changes detected. Please run:
> ```bash
> cd /Users/henry/crypto-agent
> ./scripts/deploy.sh --staging
> ```

Then verify:
```bash
cd /Users/henry/crypto-agent
./scripts/verify-deployment.sh --staging
```

### Step 2.5: Code Review Gate (before production)

Run `/ultrareview` to perform parallel multi-agent analysis of the branch before promoting to production:

```
/ultrareview
```

This runs a comprehensive review across multiple agents in parallel and flags issues before they hit prod. Fix any HIGH findings before proceeding. MEDIUM findings require explicit sign-off.

### Step 3: Production Merge (if user confirms)

For significant changes, create a PR instead of direct merge:
```bash
# Create PR with structured description
gh pr create \
  --base main \
  --head develop \
  --title "feat: [description]" \
  --body "## Summary
- [changes]

## Test plan
- [ ] CI green on develop
- [ ] Staging verified
- [ ] QA smoke test passed

## Notion task
[Link to Notion task if available]"
```

For routine changes, direct merge:
```bash
git checkout main && git merge develop && git push origin main
```

Then monitor production CI:
```bash
gh run watch $(gh run list --limit 1 --json databaseId -q '.[0].databaseId')
```

**Backend production deploy (if applicable):**
> Please run:
> ```bash
> cd /Users/henry/crypto-agent
> ./scripts/deploy.sh --prod
> ./scripts/verify-deployment.sh --prod
> ```

```bash
rm -f /tmp/vela-deploy.lock
```

### Step 4: Post-Ship Documentation

**Notion updates** (non-blocking — failures warn but don't block ship):

Use Notion MCP to update the Vela project workspace:
- **Tasks database** (`3088414f7d9b811ebd25ffb6df813c5e`): Find the related task, mark status as "Done"
- **Changelog database** (`3088414f7d9b8152a806d1109be2af30`): Create entry with:
  - Title: feature/fix description
  - Properties: date, scope (frontend/backend/both), PR link if created

**Local documentation:**
- Update MEMORY.md with completed item
- Update test counts if tests were added/removed
- Update CLAUDE.md if conventions changed

### Step 5: Sync Branches
```bash
# Keep develop in sync with main after merge
git checkout develop && git merge main && git push origin develop
```

---

## Cross-Repo Coordination (GitHub MCP)

When changes span both repos:

### Check for Matching PRs
```bash
# If shipping frontend, check backend
gh pr list --repo henry/crypto-agent --state open
# If shipping backend, check frontend
gh pr list --repo henry/crypto-agent-frontend --state open
```

### Cross-Repo Ship Order
1. Ship backend first (migrations + edge functions must be live before frontend references them)
2. Verify backend deployment: `verify-deployment.sh --staging`
3. Ship frontend
4. Verify both: `verify-deployment.sh --both`

### PR Description from Notion Context
When creating a PR, pull context from the related Notion task to populate the description. Use Notion MCP to search for the task, then include:
- Task title and description
- Acceptance criteria
- Related decisions

---

## Safety Rules

- **Never run bare `deploy.sh`** — always `--staging` or `--prod` (enforced by Hookify rule)
- **Never skip CI verification** — the push → CI → verify sequence is ATOMIC
- **Backend deploy requires user action** — `deploy.sh` has interactive confirmation prompts
- **Staging before production** — always deploy to staging first, verify, then production
- **Post-ship docs are mandatory** — MEMORY.md and Notion must be updated same session

## Key References
- Deploy workflow: `docs/claude-reference/deploy-workflow.md`
- CI verification: `docs/claude-reference/deploy-workflow.md#post-push-ci-verification`
- QA checklist: `docs/claude-reference/qa-checklist.md`
- Backend project refs: Staging `memyqgdqcwrrybjpszuw`, Production `dikybxkubbaabnshnreh`
