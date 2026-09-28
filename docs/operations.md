# Operations runbook — budgets, credits, runs, troubleshooting

## The cost model in one paragraph

Every workflow subagent is a full model session with its own context. The session model
(GLM-5.3) routes and synthesizes; runs default to **GLM-5.3-Flash** at roughly a third of
the credit cost. So the levers, in order of power: **fan-out width** (agents), **tier**
(Flash vs 5.3), **rounds** (caps are written into every pattern), and **re-use**
(`AmendWorkflow` replays unchanged asks at zero tokens). Sizes: S≈≤8, M≈≤18 (default),
L≈≤36 (explicit), XL>36 (explicit only — schedule off-peak).

## GLM Coding Plan economics (verify current numbers at docs.z.ai/devpack)

- Subscription pools: 5-hour + weekly credits (Lite 2k/10k · Pro 12k/60k · Max 28k/140k,
  as of late 2026).
- Token multipliers per 10k tokens (late 2026): GLM-5.3 ≈ 6.9 input / 1.7 cached / 24
  output; GLM-5.3-Flash ≈ 2.3 / 0.56 / 8. **Cached input is ~4× cheaper** — that's why
  pattern scripts reuse persistent agents across rounds (long-lived prompt caching) instead
  of spawning fresh ones.
- Off-peak windows are discounted ~50% — check the current window in the plan docs before
  scheduling L/XL runs.
- Rough planning number: an M `implement` ≈ 18 Flash sessions; think "a few percent of a
  Pro weekly pool", not "free". If a run's value doesn't clear that bar, don't start it.

## Running

| You want | Do |
|---|---|
| start a pattern | `/uc:research <topic>` etc. — or `/ultracode <task>` and let the router pick |
| watch progress | the run's phase graph; `report()` items stream live; artifacts appear as cards |
| stop a run | `x` in the runs view / TaskStop — stopped runs keep everything that settled |
| resume a stopped run | `ResumeWorkflowRun` (same run id) — finished agents replay free |
| change a running/errored/completed run | edit its script file, then `AmendWorkflow` with `run_id` + `path` — never re-create from scratch |
| answer a subagent's question mid-run | `ResolveWorkflowQuestion` with the `dwfq-…` id (the run keeps going meanwhile) |

**Amend is the revision habit.** Stable subagent names are the cache keys: keep names
identical, keep tunable constants out of ask text, and a revision re-pays only what
actually changed.

## Troubleshooting

| Symptom | Meaning / fix |
|---|---|
| compile diagnostics, nothing ran | edit the named file, resubmit with `path` — never paste the script again |
| run "waiting for provider" | rate limits/overload are retried internally; a 20-min stall pings once — nothing to do |
| run `stopped`, reason `provider` | sign-in/quota/model-plan issue — the error block names it; fix, then resume |
| subagent parked on a question | its escalation is waiting for you (`dwfq-…` id in the notification or `GetWorkflowRun`) |
| gate keeps failing after 2 repairs | the run says so in `notCovered` — that's the cap working; read the stderr in the report, fix the cause, `AmendWorkflow` |
| `files.glob`/`files.grep` rejected | over-cap reads reject rather than truncate — narrow the pattern |
| Bash denied by `[ultracode guard]` | it matched the destructive list — get the user to run/approve it; don't retry verbatim |

## When NOT to use a workflow

- One fact, one file, one obvious edit — answer or do it directly.
- A single delegation with no fan-out/loop — `Agent` tool.
- You need the answer in this turn, interactively — workflows are background depth, not
  latency wins.
- The stakes don't justify ~10+ Flash sessions — the middle path still has a floor.

## Credit hygiene checklist (before any L/XL)

1. Can it be an M with two passes (amended) instead of one L? Amend-cache says yes often.
2. Is ≥70% of the fan-out on Flash?
3. Are round caps in the script (never `while (true)`)?
4. Off-peak window open? If not and it can wait, schedule it there.
5. Does the report's `verified`/`notCovered` tell the truth about what actually ran?
