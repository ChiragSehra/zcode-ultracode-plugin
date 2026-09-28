# Contributing to ultracode-glm

This repo is two things: a pattern library (`.zcode/workflows/*.dwf.ts`) and the
`ultracode` ZCode plugin (`plugin/`). `DESIGN.md` is the architecture — read it before
structural changes. This file covers what you'll actually do: install the system, edit a
pattern workflow, add a command.

## Setup: the six patterns in a fresh ZCode workspace

The six saved workflows — `research`, `implement`, `audit`, `decide`, `converge`,
`sweep` — live in `.zcode/workflows/*.dwf.ts`. The commands, skill, agents, and guard
hook live under `plugin/`, wired up by `marketplace.json` (the local marketplace
`ultracode-local`).

**Plugin** (commands + skill + agents + hook): in ZCode, Settings → Plugins → Add
marketplace → point it at this repo's directory, then install `ultracode@ultracode-local`.

**Workflows** — two options:

- **Project scope (default):** nothing to do in this repo; this workspace already picks
  up `.zcode/workflows/`.
- **Global copy:** run `bash scripts/install.sh` to copy the six `.dwf.ts` files to
  `~/.zcode/workflows/`, where every project sees them. Project scope stays the source
  of truth — re-run the script after editing a workflow.

Verify: `/ultracode <task>` arms the router, `/uc:decide …` starts a run. On a different
Z.ai account the Flash model ids may differ — see "Model IDs on a different
machine/account" in `README.md`.

## Dev loop: editing a pattern workflow

1. **Load the bundled `dynamic-workflows` skill first.** It is the authoring contract
   (facade, phases, typed `ask<T>`, amend cache); `plugin/skills/ultracode/SKILL.md` §6
   adds the ultracode layer on top of it.
2. **Edit `.zcode/workflows/<name>.dwf.ts`** (e.g. `.zcode/workflows/audit.dwf.ts`).
   Keep agent names unique and stable — they are the amend-cache keys. Scripts are
   typechecked on submit.
3. **Re-save via `SaveWorkflow`** so the edited script replaces the saved workflow under
   the same name; unchanged asks then replay from the amend cache at zero tokens.
4. **Smoke-test pieces with `EvalWorkflowSnippet`** — parsers, gate predicates, glob
   shapes, schema logic. A full run is not a test bench.

If you change a pattern's shape, update its worst-case agent count in
`docs/patterns.md`, and keep the workflow readable in one sitting (DESIGN.md P7).

## Adding a `/uc:` command

Commands are thin triggers; the policy lives in the skill and the pattern script.

1. Create `plugin/commands/uc/<name>.md` with `description` and `argument-hint`
   frontmatter — copy `plugin/commands/uc/audit.md` as the template.
2. The body must state that the request is a binding workflow ask, interpolate the
   user's words verbatim, call `CreateWorkflow` with
   `saved: { name: "<pattern>", args: { … } }`, set `subagent_model` per the tier
   policy, and tell the session not to poll — relay the completion report faithfully.
3. Reload the plugin (marketplace install above) so ZCode picks up the command.

**Route to a new pattern instead** when no existing workflow's shape fits: a command
that would hand-roll orchestration inline is a smell. If the request is a recurring
fan-out / loop / branch shape with typed results, author
`.zcode/workflows/<name>.dwf.ts` (per the dev loop, within the budgets and verification
rules of `plugin/skills/ultracode/SKILL.md` §4–§5), add a row to the pattern table in
the skill's §2, and give it a `/uc:` command. If an existing pattern fits, add only the
command.

## Tier policy

The session model (GLM-5.3) routes, plans the run shape, and does final synthesis of the
returned report; run subagents go on `GLM-5.3-Flash` with the reasoning level matched to
the pattern's dominant role — `$max` where judgment is the value (`decide`, `converge`),
`$high` for mixed work (`implement`, `research`, `audit`), `$low` for mechanical fan-out
(`sweep`); escalate a level — or to the session model by omitting `subagent_model` —
when the work is genuinely hard, and demote honestly to `$low` for mechanical ad-hoc
subagents. The full table and rationale are in `plugin/skills/ultracode/SKILL.md`
section 3, "Model tier policy".

## Verification culture

- **Amend-first revisions.** A wrong or improved run is an `AmendWorkflow` on the
  existing run — never a fresh `CreateWorkflow`, which re-pays finished work. Stable
  subagent names let unchanged steps replay from cache at zero tokens.
- **Honest verified/notCovered.** A `verified` entry carries a check you actually ran
  (e.g. a gate's exit code); unconfirmed findings stay labelled `unconfirmed`; anything
  the run did not reach is listed in `notCovered`. On budget exhaustion the report says
  so and lists what remains — never a silently declared "done".
- **Size-class budgets.** S ≤ 14 subagents, M ≤ 20 (default), L ≤ 48 and XL > 48 only
  with explicit `size` args; round caps ≤ 2; no unbounded loops. `docs/operations.md`
  has the cost model and the credit-hygiene checklist.

## Before you open a PR

- Every path and command in your docs must exist in this repo — no invented tooling.
- `plugin/hooks/guard.mjs` and `plugin/hooks/hooks.json` deny a short list of
  destructive Bash one-liners; don't weaken them without discussion.
- Architecture questions start from `DESIGN.md` and `docs/research-notes.md` — cite the
  notes rather than re-deriving. License: MIT (`LICENSE`).
