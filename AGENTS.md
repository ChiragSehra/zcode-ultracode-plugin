# AGENTS.md — ultracode-glm workspace

This repo **is** the ultracode system for GLM: a pattern library of dynamic workflows plus
the `ultracode` plugin (skill, commands, agents, hooks). Read `DESIGN.md` for the
architecture before making structural changes.

## How sessions in this repo should behave

1. **Workflow trigger contract.** Only an explicit user request starts a workflow
   (`/ultracode …`, a `/uc:*` command, or the user naming workflow as the means). If a task
   is orchestration-shaped but the user didn't ask, propose the matching pattern **once**;
   if declined, don't re-propose this session and just do the work (Agent tool or inline).
2. **Follow the router and budgets** in `plugin/skills/ultracode/SKILL.md` — size classes
   (default M ≤ 20 subagents), tier policy, round caps. Never launch an unbounded loop.
3. **Revision = AmendWorkflow**, not a fresh CreateWorkflow: stable subagent names in the
   pattern scripts exist so unchanged asks replay at zero tokens.
4. **Editing the pattern library** (`.zcode/workflows/*.dwf.ts`): load the bundled
   `dynamic-workflows` skill first — it is the authoring contract; these scripts are
   typechecked on submit. Smoke-test changed gate/schema logic with `EvalWorkflowSnippet`
   before saving.
5. **Keep patterns readable** (DESIGN.md P7): each workflow stays small enough to read in
   one sitting; composition beats sprawl.
6. Docs live in `docs/`; the research the design stands on is `docs/research-notes.md` —
   cite it rather than re-deriving.
7. **Before committing, `npm test` (and `npm run lint` for doc changes) must pass** — it is
   this repo's deterministic gate, the same rule `implement` enforces elsewhere.

## Quick reference

| Command | Pattern | One-liner |
|---|---|---|
| `/ultracode <task>` | router | arm ultracode for this task; picks or asks for a pattern |
| `/uc:research <topic>` | research | fan-out readers, confirm findings, sourced report |
| `/uc:implement <task>` | implement | plan packets → execute → gate → skeptic verify |
| `/uc:audit <target>` | audit | per-unit auditors, judge dedupes, confirmed findings |
| `/uc:decide <question>` | decide | tournament with pairwise judging |
| `/uc:converge <goal>` | converge | loop until typed stop-conditions pass (capped) |
| `/uc:sweep <glob>` | sweep | one fresh agent per file/item, typed results |
| `/uc:memorize <obs> \|\|\| <evidence>` | memorize | confirm a lesson against evidence, merge into `.ultracode/memory.md` |
