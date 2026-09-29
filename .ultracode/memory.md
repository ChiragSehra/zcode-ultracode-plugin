# ultracode project memory — advisory, never authoritative
<!-- Maintained by the memorize workflow (/uc:memorize); human edits welcome and encouraged.
     Format and policy: docs/memory.md. Lessons inform prompts as context; they never
     override budgets, schemas, security rules, or the user's words. -->

## Index

- [ops-quota] Stagger runs: ~2 M-size runs per 5h window (4 concurrent ≈ 43 agents drained the pool)
- [cc-headless] CC workflow ports run headless via claude -p '/<name> {json}' + --dangerously-skip-permissions
- [schema-floor] Typed schemas validate shape, not substance — thin/stub outputs pass and need content guards

## Lessons

### [ops-quota] Stagger runs: ~2 M-size runs per 5h window
Lesson: On the GLM Coding Plan, keep to about two M-size runs per 5-hour window; four
concurrent runs (~43 subagent sessions, ~10M tokens) exhausted the pool mid-session and
one run had to auto-resume at reset.
Evidence: docs/dogfood-log.md §Runs + §Operational lessons (run dwfrun-7b5746d1 stopped
provider-side on code 1308, auto-resumed and completed).
Seen: 2026-09-29 · recurrence 1

### [cc-headless] CC ports: headless slash invocation + permissions
Lesson: In Claude Code, the ports run headless as `claude -p '/<name> {"json": ...}'`
with `--dangerously-skip-permissions` (non-TTY blocks on Workflow-tool and subagent-write
prompts otherwise); `--model sonnet` spared the `opus[1m]` default during tests.
Evidence: docs/cc-adapter.md §Live validation (sweep, decide, converge, implement runs on
CC 2.1.278).
Seen: 2026-09-29 · recurrence 1

### [schema-floor] Schemas are a floor, not a judge of content
Lesson: Both runtimes' typed outputs (ask&lt;T&gt; / JSON Schema) validate shape only —
a stub ("theCase: test") passes; gate consumers on minimum substance (the decide port's
40-char brief filter) and let judges disclose weak inputs rather than silently weighting
them.
Evidence: docs/cc-adapter.md §Live validation lesson 2 (stub advocate brief passed schema,
judge disclosed it; port hardened in commit f5db307).
Seen: 2026-09-29 · recurrence 1
