# Claude Code adapter — mapping, degradations, status

The six ultracode patterns are authored against ZCode's TypeScript workflow facade
(`.zcode/workflows/*.dwf.ts`). This adapter ports them to Claude Code's JavaScript
dynamic-workflow dialect, shipped as `plugin/workflows/*.js` — CC discovers a plugin's
`workflows/` directory by convention and exposes each as `/<plugin>:<name>` (here:
`/ultracode:decide`, `/ultracode:sweep`). Ground truth for the dialect: CC 2.1.278's own
shipped plugin workflows (e.g. `claude-security/workflows/scan.js`) and
code.claude.com/docs/en/workflows.

## Facade mapping

| ZCode (`.dwf.ts`) | Claude Code (`.js`) | Notes |
|---|---|---|
| `agent(name?, persona?).ask<T>(prompt)` | `agent(prompt, { label, schema })` | persona has no dedicated option — fold the persona text into the prompt; `label` replaces the name for display |
| typed `ask<T>()` + JSDoc field docs | `schema: { type: "object", required: [...], properties: {...} }` | JSON Schema, validated pre-spawn and on return (5 attempts); field docs go in `description` keywords — keep prompts explicit instead |
| `Promise.all(items.map(...))` fan-out | `parallel(tasks)` or `pipeline(list, fn)` | failed/stopped agents resolve to `null` — filter and count, never assume |
| `phase("...")` | `phase("...")` | same; `meta.phases` also declares display titles |
| `log()` | `log()` | same |
| `args` (validated bag) | `args` global — **may arrive as a JSON string** | parse defensively (`JSON.parse` on strings; tolerate empty) |
| `world.run(cmd, args)` deterministic gate | **no equivalent — scripts have no shell/filesystem** | see degradations |
| `files.glob/read/grep`, `git.*` journaled reads | **none in-script** | an inventory agent with file tools returns typed lists instead |
| `artifact.markdown/file` deliverables | none — **a final agent writes the deliverable file** | the shipped-`scan.js` pattern |
| `report()` streaming + salvage | none | `log()` lines only |
| `AmendWorkflow` cache by stable subagent name | resume replays by prompt-identity, **order-sensitive** | a changed early prompt re-runs everything after it |

## Honest degradations (why the ZCode originals remain the reference)

1. **Gates lose their script-verified trust model.** ZCode's `world.run` makes the *script*
   read the exit code; CC scripts have no shell, so a gate is agent-reported. The port's
   answer is the **dual-runner agreement gate** (below) — stronger than a single
   self-report, still weaker than code.
2. **No salvage.** ZCode's `report()`-as-you-go survives a crashed run; CC ports lose
   everything but `log()` lines if the script dies late.
3. **No in-script world reads.** Inventory (file lists, git state) costs an agent and is
   only as good as its typed result.
4. **No actor persistence.** ZCode reuses one named actor across loop rounds (cheap,
   cached); every CC `agent()` call is a fresh context — loop ports carry accumulated
   round history in the prompt instead, at full price per round.
5. **Advisory limits differ.** CC warns above 25 agents / 1.5M projected tokens
   (non-blocking); `research` depth-`l` (29 agents) trips the advisory on that runtime.

## The dual-runner agreement gate (CC port of `world.run`)

The ZCode skill's anti-pattern list says never trust a subagent's pass/fail claim. CC
leaves no alternative to asking a subagent — so the port makes one liar insufficient:

- **Two independent runners** (distinct labels, identical asks, no shared context) each
  execute the exact command and return a typed
  `{ exitCode: number, detail: string }` — on failure, `detail` must quote the actual
  error lines.
- **The script branches only on agreement**: both `exitCode === 0` → pass; both nonzero
  with real `detail` → fail (detail feeds the repairer); disagreement, null, or empty
  detail on a failure → **unknown, treated as failing** for the loop and labelled in the
  report.
- **Specificity is the lie detector**: coherent fabricated error lines produced
  identically by two independent contexts is a much more expensive lie than a boolean.
- **Honesty label**: the report's gate section says *agent-executed, dual-runner-agreed —
  not script-verified*, and names **repo CI as the deterministic verifier of record**:
  in CC-land the push's CI run is the true `world.run`; the workflow gets the code to a
  candidate state, CI confirms it.
- **Command provenance**: the gate command is either supplied by the user in
  `args.gates` (the CC equivalent of approving the literal command set) or
  default-discovered from `package.json` `scripts.test` by a probe agent restricted to
  `npm|pnpm|yarn|bun test`. No agent-invented commands.

Cost: 2 runner sessions per gate per round (ZCode pays 0). That is the price of the
runtime's trust model, paid only by gate-bearing patterns.

## Port status

| Pattern | Status |
|---|---|
| `decide` | **ported + runtime-tested** (`plugin/workflows/decide.js`) — full tournament ran live; report on disk |
| `sweep` | **ported + runtime-tested** (`plugin/workflows/sweep.js`) — 3/3 files swept cleanly |
| `converge` | **ported + runtime-tested** (`plugin/workflows/converge.js`) — converged round 1, fresh-verifier pass; no gates needed (its verification is checker agents) |
| `implement` | **ported + runtime-tested** (`plugin/workflows/implement.js`) — dual-runner gate agreed *pass*, honestly labelled agent-executed; an external deterministic run of the same command confirmed exit 0 |
| `research` | **ported, syntax-checked, live test deferred** (`plugin/workflows/research.js`) — the live run hit the subscription's credit limit; re-run when credits reset (harness + commands below) |
| `audit` | **ported, syntax-checked, live test deferred** (`plugin/workflows/audit.js`) — same; carries the honest verified-line lesson from the ZCode dogfood |

Both ports are syntax-checked as ESM by this repo's `npm test` gate.

## Live validation (2026-09-29, CC 2.1.278, Pro subscription)

Run headless in a scratch project with the ports copied into `.claude/workflows/`:

```sh
cd <scratch-project>   # with .claude/workflows/{decide,sweep}.js inside
claude -p '/sweep {"glob": "*.txt", "task": "..."}' --model sonnet --dangerously-skip-permissions
claude -p '/decide {"question": "...", "options": ["a", "b", "c"]}' --model sonnet --dangerously-skip-permissions
```

Results: `sweep` — inventory agent + 3 workers, all 3 files modified, 0 failures, correct
summary. `decide` — full tournament (framer → 3 advocates → pairwise judge → challenger →
report-writer), 8 KB `ultracode-decision-report.md` on disk with the designed shape:
winner, decisive pairwise comparison, ranked table, tradeoffs, failure-mode disclosure.
Billed to the subscription (Keychain OAuth), `--model sonnet` to spare the session's
`opus[1m]` default.

Lessons from the live run:

1. **Slash-command invocation works headless** — `claude -p '/<name> {json-args}'` reaches
   the saved workflow; the ports' defensive `args` parsing (string-or-object) held.
2. **Schema validates shape, not substance.** One advocate returned a stub brief
   (`theCase: "test"`, risks `["a","b"]`) that passed validation; the judge honestly
   disclosed and discounted it, and the port now guards itself (briefs under 40 chars are
   excluded and counted as failures). Same exposure exists on the ZCode side — typed
   schemas are a floor, not a judge of content.
3. **`--dangerously-skip-permissions` was needed headless** to keep the Workflow tool and
   subagent writes from blocking on prompts in a non-TTY; in an interactive session the
   normal permission flow applies.
4. **The dual-runner gate held and stayed honest** (implement, second live session):
   both runners reported exit 0, the script's report labelled the gate
   *agent-executed, dual-runner-agreed — not script-verified*, and an external
   deterministic run of the same command confirmed exit 0. The trust protocol is weaker
   than `world.run` by construction, and the labelling is what keeps that weakness
   visible instead of laundered.
5. **Converge ports without the gate problem** — its verification was always checker
   agents; round history carried in prompts substitutes for actor persistence (at full
   token price per round, documented in the degradations).
6. **Subscription credits run out mid-campaign** — the `research` live test returned
   "Credit balance is too low" after the five successful runs. The port shipped as
   syntax-checked with the live test deferred; when credits reset, the staged harness
   (scratch project with `.claude/workflows/` holding all six ports) runs it with:
   `claude -p '/research {"topic": "...", "depth": "s"}' --model sonnet --dangerously-skip-permissions`
   (likewise `/audit {"target": "...", "rubric": "..."}`).

## Running the ports

Install this repo as a Claude Code plugin marketplace (`claude plugin marketplace add
ChiragSehra/zcode-ultracode-plugin`, then install `ultracode`), then:

```
/ultracode:decide {"question": "SQLite or JSONL for a personal metrics CLI?", "options": ["sqlite", "jsonl"]}
/ultracode:sweep {"glob": "src/**/*.ts", "task": "Add the license header if missing"}
```

Tiering note: CC's documented per-stage model naming is thinner than ZCode's
`$reasoningLevel` suffix; until verified, the ports run on the session model and the
Flash-tier economics apply only on the ZCode side.
