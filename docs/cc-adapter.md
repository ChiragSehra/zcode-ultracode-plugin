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
| `decide` | **ported** (`plugin/workflows/decide.js`) — pure-agentic, no gates needed; deliverable written by a final agent (`ultracode-decision-report.md`) |
| `sweep` | **ported** (`plugin/workflows/sweep.js`) — inventory agent replaces `files.glob`; 30-file cap kept; summary via `log()` |
| `research`, `audit` | portable with the same techniques (confirmers → schema'd second agents); not yet ported |
| `implement`, `converge` | **blocked on the gate redesign** above — the patterns' value is the deterministic gate; porting them without it would be ultracode-in-name-only |

Both ports are syntax-checked as ESM by this repo's `npm test` gate. They are **not
runtime-tested against a live Claude Code** (no CC session was spent); treat them as
faithful-to-documentation and expect minor friction on first real run — the meta/args/
schema/label contract is taken from CC's own shipped workflows on disk.

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
