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

1. **Gates lose their trust model.** ZCode's `world.run` makes the *script* read the exit
   code; in CC a subagent must run the check and report it — a self-reported pass/fail,
   which the ZCode skill explicitly lists as an anti-pattern. The port for gate-bearing
   patterns (`implement`, `converge`) must either accept that weaker trust or run checks
   via a tightly-instructed runner persona and cross-check with a second runner on
   disagreement. That design work is deliberately not rushed.
2. **No salvage.** ZCode's `report()`-as-you-go survives a crashed run; CC ports lose
   everything but `log()` lines if the script dies late.
3. **No in-script world reads.** Inventory (file lists, git state) costs an agent and is
   only as good as its typed result.
4. **Advisory limits differ.** CC warns above 25 agents / 1.5M projected tokens
   (non-blocking); `research` depth-`l` (29 agents) trips the advisory on that runtime.

## Port status

| Pattern | Status |
|---|---|
| `decide` | **ported + runtime-tested** (`plugin/workflows/decide.js`) — full tournament ran live; report on disk |
| `sweep` | **ported + runtime-tested** (`plugin/workflows/sweep.js`) — 3/3 files swept cleanly |
| `research`, `audit` | portable with the same techniques (confirmers → schema'd second agents); not yet ported |
| `implement`, `converge` | **blocked on the gate redesign** above — the patterns' value is the deterministic gate; porting them without it would be ultracode-in-name-only |

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
