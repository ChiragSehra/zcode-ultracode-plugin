# The six patterns — catalog, decision tree, composition

All patterns are saved workflows in `.zcode/workflows/` (run via `CreateWorkflow` with
`saved: { name, args }`, or through the `/uc:*` commands). No pattern sets a model itself:
per SKILL.md §3 the caller puts subagents on **GLM-5.3-Flash** (a bare `saved:` run keeps
them on the session model), and the session model routes, plans the run shape, and does
final-mile synthesis of the returned report. Plan review is deliberately not the session's
job — it is a fresh subagent. Agent counts below are worst cases at default size.

```
Need an answer or a judgment?
├─ one source, one fact ──────────────────────► answer directly
├─ multiple sources, claims must hold ────────► research
├─ options with tradeoffs, no single truth ───► decide
Need a change made?
├─ one file, one obvious edit ────────────────► do it directly
├─ same mechanical edit across many files ────► sweep
├─ real feature/change, deserves gates ───────► implement
Need a quality verdict?
├─ find problems across many units ───────────► audit
├─ iterate until explicit conditions pass ────► converge
Composable: research → decide → implement → audit. converge wraps any producer.
```

---

## research — fan-out-and-synthesize + quarantine

**Question**: "What's true here, and what will we actually stand behind?"

Arc: break the topic into self-contained sub-questions → parallel fresh readers (quarantine
contract for untrusted content) → independent confirmers reproduce load-bearing claims →
synthesizer cross-checks (skipped at depth `s`). Claims keep `verified | unconfirmed` status
end-to-end; failures are labelled, never dropped.

| arg | type | default | notes |
|---|---|---|---|
| `topic` | string | required | the user's words |
| `depth` | s / m / l | m | s=2 questions, m=4, l=9; confirmers: 1/question (m), 2 (l) |

Worst case: s=5, m=10, l=29 agents. Deliverable: sourced markdown report (primary artifact).

## implement — plan → execute → gate → verify (the flagship)

**Question**: "Can this change be trusted?"

Arc: planner emits typed task packets (escalates on ambiguity) → **fresh** plan reviewer
reads the touched files → one revision round if the plan has problems → packets execute in
parallel → deterministic gates (`world.run`) drive a repair loop (capped at 2) →
independent reviewer per changed file → one fix round → gates re-run.
The strongest gate always runs at least once after the last change.

| arg | type | default | notes |
|---|---|---|---|
| `task` | string | required | the user's words |
| `size` | s / m / l | m | s≤3 packets/4 reviewers, m≤6/6, l≤10/30 |
| `gates` | json | auto-detect | forced check: `{"kind":"npm\|make\|cargo\|pytest\|node","args":["test.js"]}` (`node` runs the files in `args`). Auto-detected when omitted: `npm test` (`package.json` `scripts.test`), `make test` (`Makefile`), `cargo test` (`Cargo.toml`) — every one present runs; none found in a git repo → `git diff --check` (whitespace/conflict markers). `pytest` and `node` are override-only. |

Worst case: s=14, m=19, l=47 agents — planner, plan reviewer, ≤cap implementers, repairer,
≤cap reviewers, plus at most 4 fixers in the fix round. Deliverable: implementation report
with gate table, file-review table, diff excerpt (primary artifact).

## audit — classify-and-act + generate-and-filter

**Question**: "What's wrong across this surface, ranked by what it costs me?"

Arc: inventory the target (glob, or a scout agent proposes patterns) → fresh auditor per
unit with a typed findings schema → independent confirmer per **high-severity** finding →
one shared judge dedupes and ranks on a single scale (serialized on purpose: consistent
ranking) → audit report.

| arg | type | default | notes |
|---|---|---|---|
| `target` | string | required | glob, directory, or description |
| `rubric` | string | – | criteria the audit must apply |

Cap: 8 units/run (worst case 18 agents). Unconfirmed findings stay in the report, labelled.

## decide — tournament

**Question**: "Which one, and what would make that wrong?"

Arc: framer sets criteria + distinct candidates (or honors a fixed list) → parallel
advocates build each strongest honest case **with named risks** → one shared judge settles
the ordering by pairwise comparison — the 0–100 scores only summarize those comparisons,
they are not independent ratings — and names the decisive comparison → challenger
stress-tests the verdict (assumptions that flip it, failure modes).

| arg | type | default | notes |
|---|---|---|---|
| `question` | string | required | the decision |
| `options` | json | – | fixed candidate list |

Worst case: 9 agents. Deliverable: ranking table + tradeoffs + stress-test (primary).

## converge — loop-until-done

**Question**: "Is it *actually* done, checked by someone who didn't write it?"

Arc: goal-planner turns the goal into 3–6 typed stop-conditions (+ deliverable path) →
persistent worker and strict checker iterate (capped rounds, progress chart while it runs;
the checker's gap verdicts are carried into the worker's next round as feedback) →
**fresh verifier who saw no rounds** judges the final
state → converged, or best-so-far with the remaining gaps stated plainly.

| arg | type | default | notes |
|---|---|---|---|
| `goal` | string | required | include what "done" means if you can |
| `maxRounds` | number | 3 | hard cap 6 |

4 agents regardless of rounds (persistence, not fan-out, is the trick).

## sweep — generate-and-filter / pipeline

**Question**: "Same task, every file, nothing silently skipped?"

Arc: glob the file set → one fresh agent per file, typed result, per-item failure isolation
(one bad file costs one file) → failures filtered and listed → summary table.

| arg | type | default | notes |
|---|---|---|---|
| `glob` | string | required | e.g. `src/**/*.ts` |
| `task` | string | required | the mechanical per-file task |

Cap: 30 files/run (worst case 30 agents). Beyond that, split the glob.

---

## Composition recipes

- **Informed implement**: run `research` (or `decide`) first, feed the report into
  `implement`'s `task` ("implement X per the decision in <report>").
- **Verified sweep**: `sweep` the mechanical change, then `audit` the touched files with
  rubric "regressions introduced by the migration".
- **Hard converge**: wrap any producer in `converge` by making "the implement gates pass"
  one of its conditions.
- Chains are separate runs — deliberate: each ends with a report you can read and a
  checkpoint you can amend from, instead of one opaque mega-run.

## What none of these do (on purpose)

- No unbounded loops (every round is capped; exhaustion escalates honestly).
- No self-verification (authors never confirm their own work).
- No auto-fire (a human types the command; nothing relayed starts a run).
- No nested workflows (the runtime forbids it; model bigger work as more subagents).
