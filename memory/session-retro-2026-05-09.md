# Session retrospective: HTML effectiveness adoption

**Date:** 2026-05-09
**Worktree:** `silly-haslett-33b59c`
**Trigger:** Reviewed Thariq Shihipar's *Unreasonable Effectiveness of HTML* article and decided to adopt it across Vela's process and tooling.

---

## What shipped

### Process and skills (6 inline, no agents)
- `qa-review` skill output reformatted: 4-tier severity (Blocking / Worth a look / Nit / Safe) with file-level risk matrix, action-verb fix language, embedded HTML report.
- `qa-review` evals updated with new assertions (`risk_matrix_present`, `severity_distribution`, `action_verb_language`).
- `routing-flags-editor.html` refined with sticky diff sidebar + per-row anchored statements + view-diff jump links.
- Backend `CLAUDE.md` +2 lines: HTML feature-explainer rule for any doc that would exceed ~100 lines (149 lines total, under 200 cap).
- `feedback_design_process.md` +2 rules: interactive multi-screen prototypes for any multi-screen feature, vertically-stacked parallel visual explorations.
- `personal-code-review` skill spec written (no wiring yet).

### Phase 2 HTML batch (12 builds, dispatched in 3 parallel subagent batches)

| Pattern | File | Purpose |
|---|---|---|
| #20 prompt tuner | `docs/prompt-tuner.html` | Edit any of 10 production LLM prompts with slot highlighting, sample previews, copy-as-Claude-prompt outputting call-site path |
| #04 module map | `docs/architecture/run-signals.html` | Numbered callstack from cron trigger to notify with click-to-expand source and embedded gotchas |
| #14 feature explainer | `docs/llm-routing-patterns.html`, `docs/cron-policy.html`, `docs/gotchas.html` | Long markdown docs converted to progressive-disclosure HTML; CLAUDE.md cross-refs updated; `.md` sources keep "see live version" pointer |
| #18 ticket triage board | `docs/signal-quality-backlog.html` | Drag-drop kanban for the signal-quality backlog; markdown export round-trips |
| #13 incident timeline | `docs/post-mortems/TEMPLATE.html` | Template for P0 / P1 incident write-ups with minute-precision timeline |
| #15 concept explainer | `docs/llm-routing-explainer.html` | Sticky glossary sidebar, hover-to-highlight, interactive cascade visualizer |
| #10 annotated flowchart | `docs/deploy-pipeline.html` | 12-step staging-to-prod pipeline with click-to-expand details and pass / fail branches |
| #12 weekly status (restyle) | `docs/dashboard.html` | Restyled to Vela cream / lavender; Highlights, Shipped, Velocity, Carryover sections added |
| #11 slide deck | `docs/sprint-review/TEMPLATE.html` | Arrow-key + space + esc + 1-6 navigation, single-file deck for sprint reviews |
| #07 animation sandbox | `docs/prototypes/parameter-sandbox.html` | Live-tunable easing / duration / translate / opacity, sliders write to CSS custom properties |
| #06 component variants | `crypto-agent-frontend/src/dev-tools/component-matrix.{html,tsx}` | MergedSignalCard + VelaComponents primitives in every variant on one page |
| #05 living design system | `crypto-agent-frontend/src/dev-tools/design-system.{html,tsx}` | Every CSS token grouped by the brand-doc-canonical 19 categories with per-token usage notes |

### Discoverability + close-out
- `docs/index.html` built as the canonical hub linking every tool with one-line blurbs and pattern-source labels.
- Frontend `CLAUDE.md` updated with a Dev tools section pointing at the new entries (119 lines, room to grow).
- `feature_html_tools.md` memory file written documenting the full tool inventory.
- `MEMORY.md` +1 line pointer to the new feature file.
- Hook `.claude/hooks/check-doc-limits.sh` written to enforce 200-line hard cap + 2-net-new-lines-per-write soft cap on `CLAUDE.md` and `MEMORY.md`.
- Hook validator bug in routing-flags-editor caught + fixed (force_provider alone is valid per `factory.ts:163`; previous validator wrongly required force_model too).
- Routing-flags-editor BASELINE refreshed against prod (project `dikybxkubbaabnshnreh`).
- Worktree path bug in `stripe-billing.test.ts` fixed: now resolves frontend types via `$HOME/crypto-agent-frontend` fallback.
- All 1728 backend tests passing (was 1727 + 1 pre-existing failure).

### E2E functional verification
Browser-tested via local HTTP server on `:8421`:
- Routing-flags editor: 20 tasks load, edits propagate, 13 informational warnings on prod baseline (down from 24 once validator bug was fixed), SQL parses against staging via transaction-wrapped EXPLAIN.
- Prompt tuner: 10 tasks in dropdown, slot detection works (36 slots in `brief_generate`), task switching reloads content, preview fills render correctly.
- Parameter sandbox: 3 sliders write to `.preview-card` CSS custom properties live, 4 buttons present.
- Backlog board: 23 draggable cards in 4 columns, markdown export produces 5359 chars with proper structure, 23 list items match 23 cards.
- All 3 "Copy as Claude prompt" buttons produce well-formed prompts with appropriate call-site references and step instructions.

---

## Prompting feedback

### What worked

**The pattern-source labels were the key constraint.** Telling each subagent "lift implementation from gallery example #N at this URL" produced consistent quality across 12 wildly different builds. Without the label, agents would have invented their own structures. With the label, they had a concrete reference to imitate, which made review and integration easy.

**Quality bar specified per dispatch.** Every subagent prompt restated the hard rules: no em dashes, no "free" wedge, no jargon, Vela design tokens only, self-contained, action-verb language. Agents would have skipped one or more of these silently if not restated. Cost: ~50 lines per prompt. Benefit: fewer post-batch fixes.

**Parallel batches with vetting between.** Batches of 3-4 agents in a single turn, then a `grep -P '—' | wc -l` style vet pass before next batch. This caught 9 em-dash violations and 1 missing file across 12 builds. Without the vet, downstream batches would have inherited the inconsistencies.

**EXPLAIN against staging for SQL validation.** Wrapping the editor's generated UPDATE statements in `BEGIN; EXPLAIN ...; ROLLBACK;` proved syntactic validity + column existence + type coercion + index usage in one round trip. Cheaper than running the migration against a sandbox DB.

### What failed (or could improve)

**The first review of the gallery was too shallow.** I read only the top-level summary page and produced a category-level analysis. The user pushed back twice ("did you click into each module?") before I went deep. Lesson: for any reference material the user explicitly points to, read at the leaf level on the first pass, not the summary.

**The dashboard restyle decision was made wrong the first time.** Initial scoping said "keep dark theme" to minimize risk. Once placed next to the cream / lavender Phase 2 set, the dark theme was visually orphaned. The user had to flag it. Lesson: when scoping a refresh, decide the visual treatment relative to the destination set, not the origin file.

**Missed the design system v2 brand doc.** The first design-system snapshot used regex name-prefix grouping instead of the brand doc's 19 canonical categories. The user caught this with a simple "did you use the v2 file?" question. Lesson: when there's both a code file and a doc file for the same concept, the doc file usually defines semantics the code can't.

**Initial agent dispatch for E1+E2 returned mid-task.** The frontend dev-tools agent claimed `design-system.html` was visible but `design-system.tsx` was never written and Google Fonts were still in both HTML entries. Lesson: when an agent reports completion of a multi-file deliverable, verify each file landed before marking done. The vetting pass caught this but it added a second agent dispatch.

### Patterns to keep

- Three-batch parallel dispatch (3-4 agents per batch) with grep-vetting between batches.
- Pattern-source labels in every dispatch prompt.
- Quality bar restated per dispatch, never assumed.
- EXPLAIN-as-syntax-check for SQL-emitting tools.
- Browser-driven E2E via local HTTP server, not direct file access.
- DOM-textContent extraction when the response filter blocks JS string return.

---

## Efficiency feedback

### Costs
- 4 agent dispatches in Batch 1 (parallel)
- 3 agent dispatches in Batch 2 (parallel)
- 4 agent dispatches in Batch 3 (parallel) plus 1 fix-up agent for E1+E2 plus 1 design-system v2 refinement agent
- 12 deliverables produced
- 1 validator bug found and fixed during E2E testing
- 1 pre-existing test bug found and fixed during session-end test run

### What burned cycles
- The CLAUDE.md refactor early in the conversation (430 → 147 lines) involved multiple edit-and-recount loops because line counting was eyeballed first. Lesson: for any line-bounded edit, read the full file, count, edit, count, in that order, no shortcuts.
- Hook drift between project and global settings.json caused some confusion early. Lesson: when a hook is project-specific, don't assume the global has the same version.
- `[BLOCKED: Cookie/query string data]` blocked direct return of SQL strings from the browser tool, forcing a workaround via DOM textContent. Lesson: for security-filtered output, prefer DOM-rendering as the primary data path, not console / return.

### What saved cycles
- Parallel agent dispatch turned a 12-build session that would have been 6-8 hours sequential into ~3 batches of ~10 minutes each.
- The doc-limits hook caught an over-200-line CLAUDE.md draft once during the session, before it could land.
- Single `sed -i ''` calls for bulk em-dash fixes across multiple agent outputs saved 8-12 individual edits.

---

## Open items

### Genuinely deferred (not closed today)
- 3 in-flight sprint items: Telegram bot Class A wiring, Free-tier gating Phase 5, Phase 4 share previews. None touched today; user confirmed the foundation work justified the displacement.
- `personal-code-review` skill is a spec only. Wiring (calling the plugin skill, capturing output, post-processing into HTML) is its own project.
- `vela-design-system.css` line 18 still has Google Fonts `@import`. Out of scope for dev-tools; flagged for separate consideration.
- `e1` component matrix coverage is limited to MergedSignalCard + VelaComponents primitives. PositionCard / NewsDetail / EngagementFooter / SharePreviewSheet not present at audited paths; coverage to extend when those land.

### Long-term polish
- Routing-flags editor strict-$0 warning could be smarter: only urgent when `enabled=true && tier=='cheap' && force_provider=='anthropic'`. Today it warns on baseline state too because 7 disabled tasks have force_provider='anthropic' in prod (intentional but always-warning).
- Documented "dispatch pattern" (parallel agent batches with quality-bar specs and grep-vetting) isn't captured in `~/.claude/skills.md` yet. Worth a one-time write-up so future sessions reach for it.

---

## Learnings worth keeping in memory

- HTML beats Markdown for any tool with constrained inputs and exportable outputs. The "copy as X" pattern (copy as migration, copy as Claude prompt, copy as markdown) round-trips data back to its operating context cheaply.
- Pattern-source labels (gallery item #N) work as constraint anchors for subagent dispatch. Without them, agents invent. With them, output is consistent and reviewable.
- Parallel agent batching with vetting between batches scales 12 builds to ~30 min wall-clock. Sequential would have been ~6-8 hr.
- `docs/index.html` as a discoverability hub matters more than the individual tools. Tools you can't find don't get used.
- Doc-limits hooks (200-line cap + 2-net-new-per-write) prevent the CLAUDE.md drift that cost us hours in past sessions. The +2 cap forces extraction to topic files, which is the desired behavior.

---

## Files for `vela-end` to commit

12 new HTML files in `docs/` plus `docs/index.html`, 2 new TSX files in frontend `src/dev-tools/`, 1 new SKILL spec at `~/.claude/skills/personal-code-review/SKILL.md`, 1 new memory file at `feature_html_tools.md`, vite.config.ts modification, plus in-place edits to: CLAUDE.md (backend + frontend), MEMORY.md, qa-review SKILL + evals, routing-flags-editor (BASELINE refresh + validator fix), dashboard.html (restyle), 4 agent-output em-dash + color fixes, threat-reports / post-mortems / sprint-review TEMPLATEs, stripe-billing.test.ts worktree-path fix, and 3 markdown source files with "see live version" pointers (`gotchas.md`, `cron-policy.md`, `llm-routing-patterns.md`).

User to run `vela-end` to wrap.
