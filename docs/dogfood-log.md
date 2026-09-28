# Dogfood log — first four-pattern exercise (2026-09-28/29)

Four real tasks, one per previously-untested pattern, run concurrently against this repo.
Every number below is from `GetWorkflowRun`; every fix landed in the same session.

## Runs

| Pattern | Task | Tier | Outcome | Wall | Tokens |
|---|---|---|---|---|---|
| sweep | verify all internal refs in `plugin/**/*.md` | `$low` | 10/11 clean; **1 real finding** | **2m 59s** | 416k |
| converge | write CONTRIBUTING.md against 6 typed conditions | `$max` | converged round 1; fresh verifier 6/6 | 14m 19s | 673k |
| audit | audit `plugin/` for correctness/security/schema bugs | `$high` | **15 findings** (5 medium) | 29m 58s | ~3.0M |
| research | CC-adapter port analysis | `$high` | 16 findings, 4 confirmed — after one error, one amend, one quota stop | 20m 25s (amended run; 8 steps replayed from cache) | ~5.0M (amended) |

Combined ≈ **10M tokens / ~43 subagent sessions in one 5-hour window — which exhausted the
pool** (see lessons). Deliverables: CONTRIBUTING.md (kept), the audit report (15 findings,
all triaged below), the CC-adapter research report (roadmap input), one stale-doc fix.

## Tiering verdict (measured, finally)

- `$low` sweep: **11 agents in 3 minutes** — comparable `$max` fan-outs earlier in the
  project took ~30. The reasoning-level lever is real.
- `$max` converge: one 421k-token worker session did the whole deliverable in a round.
- `$high` audit: auditors ranged 154k–949k tokens (rubric judgment work; one went deep).
- The four tiers did their jobs; no pattern needed re-tiering after observation.

## What the runs caught → what we fixed (same session)

1. **Artifact-title cap crash** (research): user text interpolated into `artifact.markdown`
   title (cap 120 chars) errored the run *at publish*. `report()`-as-you-go salvage kept all
   16 findings. Fix: `slice(0, 80)` in research/audit/sweep titles (decide/implement
   already had it). The errored run was repaired by **AmendWorkflow** — the amend-first
   policy's first real exercise.
2. **AmendWorkflow does not carry a saved run's `args`**: the amended run read
   `topic: "undefined"`; the planner **escalated instead of fabricating** (honesty persona
   working as designed); answered via `ResolveWorkflowQuestion`. Residual cosmetic damage:
   the artifact is titled "Research: undefined". Rule: answer the escalation, or re-create
   from `saved:` when args matter and cache is cold anyway.
3. **5-hour quota exhaustion** (code 1308) stopped the research run mid-confirm; it
   **auto-resumed at quota reset and completed**. Rule: ≤2 M-size runs per 5h window.
4. **Sweep found** the router command still saying M ≤ 12 (stale from the budget
   re-alignment; five other files were fixed, that one missed) → fixed.
5. **Audit's 15 findings**, all fixed this session:
   - quarantine-reader held **Bash** against its own "never execute" constitution → Bash
     removed from its tool list (the airlock now holds no execution primitive).
   - audit.md **invalid YAML** (unquoted colon in `argument-hint`) → quoted.
   - uc-synthesizer `thoughtLevel` **dead** next to `model: inherit` (parser early-return)
     → line removed rather than falsely claimed.
   - `.claude-plugin` **alias drift** → re-synced with canonical manifest.
   - manifest missing explicit **`hooks`** field (worked only by loader convention) →
     declared; version bumped 1.1.0 everywhere incl. marketplace.json.
   - manifest description overpromised ("six workflow patterns" not shipped by the plugin)
     → honest wording: workflows install via `scripts/install.sh` or ship in-repo.
   - **$ARGUMENTS spliced into quoted literals** across 5 command files → verbatim-on-own-
     line + "quoted safely by you" template style.
   - skeptic: invalid-JSON verdict example → real JSON; impossible "escalate" instruction
     (no such tool outside workflows) → honest wording; Bash scoped to read-only checks.
   - decide/converge **relay drift** (promised outputs the workflows don't return) → both
     commands and converge's conclusion fixed (it now lists its conditions).
   - audit's "0/18 confirmed" **misleading verified-line** (no confirmers were attempted —
     none of the findings were high severity) → the script now says exactly that.
6. **Not fixed, recorded**: `guard.mjs` regex audit fell beyond the 8-unit cap (it was
   hand-tested against 12 allow/deny cases earlier); plugin packaging of workflows remains
   an install.sh path (documented), not an in-plugin ship.

## Operational lessons (added to operations.md)

- **Stagger**: 4 concurrent runs drained the 5-hour pool mid-session. Keep ≤2 M-size runs
  per window; sequence the rest.
- **Amended runs lose args** — expect the escalation, answer it.
- **User text never goes into artifact titles unsliced** (cap 120) — now enforced in every
  pattern.

## Verdict

Dogfooding paid for itself: four patterns exercised, two runtime failure modes survived
(publish crash, quota stop) with zero lost work thanks to journaling + salvage + resume,
one honest-escalation save, 16+6 real defects found and fixed, and the tier policy now has
measured backing instead of estimates. Gate auto-discovery is unblocked as the next build.
