# ultracode-glm

[![CI](https://github.com/ChiragSehra/zcode-ultracode-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/ChiragSehra/zcode-ultracode-plugin/actions/workflows/ci.yml)

**Ultracode for GLM** — a budget-aware, gate-first orchestration layer that brings the shape
of Claude Code's `ultracode` to GLM on ZCode's native dynamic-workflow runtime.

- `DESIGN.md` — the first-principles architecture (start here)
- `docs/patterns.md` — the six orchestration patterns, when to use which
- `docs/operations.md` — budgets, credits, runbook, troubleshooting
- `docs/research-notes.md` — the research this system is built on, with sources

## What's inside

| Path | What |
|---|---|
| `.zcode/workflows/*.dwf.ts` | six saved workflows: `research`, `implement`, `audit`, `decide`, `converge`, `sweep` |
| `plugin/` | the `ultracode` ZCode plugin: skill, 7 commands, 3 agents, destructive-op guard hook |
| `marketplace.json` | local marketplace to install the plugin into any ZCode workspace |

## Quickstart (this workspace)

The saved workflows are already in project scope, so inside this repo just:

```
/decide Should we use SQLite or Postgres for the metrics store?
/uc:implement add a rediscache module with tests
```

or arm the router for any task:

```
/ultracode research how ZCode hooks differ from Claude Code hooks
```

## Install into another workspace

```sh
# 1) workflows → global scope (available in every ZCode project)
cp .zcode/workflows/*.dwf.ts ~/.zcode/workflows/

# 2) plugin → register the local marketplace in ZCode, then install `ultracode@ultracode-local`
#    (or run the helper)
./scripts/install.sh
```

### Model IDs on a different machine/account

Two plugin agents (`plugin/agents/uc-skeptic.md`, `plugin/agents/uc-quarantine-reader.md`)
pin `model: account:zai-individual-coding-plan/GLM-5.3-Flash` — the model id as resolved
on the author's machine. If your Z.ai account prefix differs (e.g. `bigmodel-…`), run
`ListModels` in ZCode and update those two lines (and the tier examples in
`plugin/skills/ultracode/SKILL.md` §3) to your own ids. The saved workflows set no model
themselves — the caller applies the tier, so they need no edits.

## Claude Code adapter (experimental)

`plugin/workflows/*.js` carries Claude Code dialect ports of the patterns — `decide` and
`sweep` are ported (`/ultracode:decide`, `/ultracode:sweep` after installing this repo as
a CC plugin marketplace). The ZCode originals remain the reference implementation: CC's
runtime has no in-script shell or file reads, so deterministic gates and salvage don't
port 1:1 — `implement`/`converge` stay unported until the gate redesign lands. Full
mapping and honest degradation notes: [docs/cc-adapter.md](docs/cc-adapter.md).

## The repo gates itself

`npm test` — zero dependencies — checks what this repo has actually gotten wrong:
manifest name/version agreement, command/agent/skill frontmatter validity (including the
unquoted-`': '` bug class), the six pattern workflows' shape, guard-hook allow/deny
behavior on live cases, and the toy test suite. `npm run lint` verifies every internal
markdown reference resolves. CI (`.github/workflows/ci.yml`) runs both on every push —
which also means `implement`'s gate auto-discovery finds `npm run lint` + `npm test` here
with zero configuration.

## The one-line pitch

Claude Code's ultracode puts the *loop in a script* and declares token cost a non-issue.
This system keeps the loop-in-a-script, swaps in GLM's two-tier models with per-pattern
reasoning levels (5.3 orchestrates; Flash fans out — `$low` for mechanical work, `$high`
for mixed, `$max` for judgment), and puts the economics back in: size classes, round caps,
deterministic gates before LLM judgment, and human escalation instead of infinite
convergence.
