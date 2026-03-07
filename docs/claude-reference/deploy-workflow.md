# Deploy Workflow & CI Pipeline

> *Extracted from CLAUDE.md — see CLAUDE.md for project overview and engineering principles.*

---

## Development Commands

```bash
npm run dev           # Start dev server (localhost:5173)
npm run build         # Build for production
npm run preview       # Preview production build locally
npm run type-check    # Run TypeScript compiler (no output)
npm run lint          # Run ESLint (when configured)
```

---

## Notion Integration (Session Management)

```bash
vela-start            # Show session status: git changes, tasks, recent activity
vela-end              # Log decisions and tasks to Notion (interactive — user runs)
vela-tasks list       # List all tasks from Notion
vela-tasks add        # Add a new task
vela                  # cd to project directory
```

**Automatic:** Every `git commit` triggers `scripts/git_to_notion.py` via post-commit hook, logging the commit to the Notion changelog.

**Manual (user runs):** `vela-end` logs session decisions + follow-up tasks to Notion (interactive — uses `input()` prompts). Claude Code should **remind the user** to run `vela-end` at the end of every session.

---

## Git Workflow

```bash
git add [files]
git commit -m "feat: add signal detail page"  # Conventional commits format
# Post-commit hook automatically logs to Notion changelog
git push origin main  # Auto-deploys to Vercel
```

---

## Backend Deployment

```bash
cd /Users/henry/crypto-agent
./scripts/deploy.sh --staging                # Apply migrations + deploy functions to staging
./scripts/deploy.sh --prod                   # Apply migrations + deploy functions to production
./scripts/deploy.sh --staging --skip-migrations  # Functions only
./scripts/verify-deployment.sh --staging     # Verify staging is in sync
./scripts/verify-deployment.sh --prod        # Verify production is in sync
./scripts/verify-deployment.sh --both        # Verify both environments
```

### deploy.sh Details
- Requires `--staging` or `--prod` flag — no default environment
- Production requires interactive `yes` confirmation
- Script always re-links to staging after completion
- NEVER run bare `deploy.sh` or `supabase functions deploy` directly
- Now also applies pending migrations (`db push`) before deploying functions (`--skip-migrations` to skip)

### Backend Project References
- **Staging:** `memyqgdqcwrrybjpszuw`
- **Production:** `dikybxkubbaabnshnreh`
- Hardcoded in `deploy.sh`. Default link: staging.

---

## Post-Push CI Verification (MANDATORY)

After every `git push`, you **must** verify the CI pipeline passes before marking a task as complete:

```bash
gh run list --limit 3                    # See recent runs
gh run view <run-id> --log-failed        # Inspect failures
```

**Rules:**
1. Never mark a task as done until the corresponding CI run is green
2. If a build fails, investigate and fix immediately — do not move on to the next task
3. After fixing, push the fix and verify the new run passes
4. Keep the `develop` branch in sync with `main` after fixes (`git checkout develop && git merge main && git push`)

---

## Backend Deployment Verification (MANDATORY)

After any backend change (migration, edge function, shared code), verify deployment parity:

```bash
cd /Users/henry/crypto-agent

# Single command to deploy: applies pending migrations + deploys functions
./scripts/deploy.sh --staging               # Staging first
./scripts/deploy.sh --prod                  # Production after staging verified

# Verify everything is in sync
./scripts/verify-deployment.sh --staging    # Check staging
./scripts/verify-deployment.sh --prod       # Check production
```

**Rules:**
1. `deploy.sh` now automatically runs `db push` before deploying functions — one command does both
2. Never mark a backend task as done until `verify-deployment.sh` passes for the target environment
3. Migrations written but not pushed to staging WILL accumulate silently — the verification script catches this
4. At session end, always run `verify-deployment.sh --staging` to confirm nothing is stuck locally
5. For cross-repo changes (migration + frontend), verify BOTH repos are deployed before marking complete

---

## Post-Ship Documentation Updates (MANDATORY)

After every completed feature, fix, or ship, **immediately update documentation** before moving on:

1. **MEMORY.md** — Update test counts, completed items, new patterns, and remove stale info
2. **CLAUDE.md** — Update if conventions, commands, or architecture changed
3. **Completed Plan Items** in MEMORY.md — Move shipped work from pending to completed

Documentation must never be outdated. If a fact has changed (test count, file paths, process rules), update it in the same session.

---

## CoinGecko API Rate Limits

- **Free tier:** 10-50 calls/minute (varies)
- **Solution:** Cache price data for 60 seconds minimum
- **Fallback:** Show stale data with warning instead of crashing

---

## Supabase Migration Safety (learned 2026-03-01)

- `db push` can fail silently — records migration BEFORE SQL executes. `migration list` only checks registry, not actual objects.
- **MANDATORY after every `db push`:** Run `scripts/verify-migrations.sql`. Any `exists = false` = silent failure.
- If silently failed: connect directly (`node` + `pg`, no `psql`), execute SQL manually. Do NOT re-run `db push`.
- Incident 2026-03-01: 5 trading tables missing despite "applied" status. Manual SQL remediation required.

---

## Environments & Deployment Process (MANDATORY)

- **Production:** Supabase `dikybxkubbaabnshnreh` | `app.getvela.xyz` | Vercel `main`
- **Staging:** Supabase `memyqgdqcwrrybjpszuw` | `staging.getvela.xyz` | Vercel `develop`
- **Order: ALWAYS staging -> test -> production.** Push `develop` -> verify staging -> merge to `main` -> verify production. DB: `db push --project-ref <ref>` + `verify-migrations.sql`. Edge functions: deploy to staging first.
- **Backend linking:** `npx supabase link --project-ref <ref>`. Default: staging. Re-link after prod ops.
- **Privy:** Production env (2026-03-02). CSP configured in `vercel.json`.
- **Production secrets:** 38 total required. Full checklist in `DEPLOY.md` step 4f. Verify with `supabase secrets list` after every deploy.
- **Referral code:** `HUKU` (Hyperliquid, both environments)

---

## macOS Compatibility Notes

- **BSD grep:** Has no `-P` (Perl regex). Use `awk -F'|'` for complex pattern matching in bash scripts.
- **BSD awk:** Doesn't support `\s` — use `[[:space:]]` POSIX class.
- Both `grep -P` and `\s` in awk caused deploy.sh to silently skip migrations. Full troubleshooting in `DEPLOY.md`.
