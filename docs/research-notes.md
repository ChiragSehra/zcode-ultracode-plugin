# Research notes — what this system is built on

Three parallel research passes (2026-09-28) over official docs, changelogs, engineering
blogs, HN threads, and the port ecosystem. Condensed to what changed design decisions;
sources at the end. Claims are as-of research date.

## 1. What `ultracode` actually is

- **A native Claude Code setting, not a third-party framework.** Shipped by Anthropic
  2026-05-28 with Claude Code v2.1.154 and Opus 4.8's `/effort` system. Ultracode =
  `xhigh` reasoning effort **+ automatic dynamic-workflow orchestration**: for substantive
  tasks the model writes a JavaScript orchestration script (`agent()`, `parallel()`,
  `pipeline()`, `phase()`) that a sandboxed background runtime executes across tens-to-
  hundreds of subagents.
- **The core inversion**: the script decides what runs next; intermediate results live in
  script variables, not the conversation context. At the API level it is only
  effort=xhigh + adaptive thinking + large max_tokens + one system reminder — all value is
  client-side orchestration (confirmed by the UltraCode-Shim reverse engineering and the
  unlock-claude-ultracode binary patcher, which found nothing but feature-flag gates).
- **Named failure modes it targets** (Anthropic's "A harness for every task"): *agentic
  laziness* (declaring done at 35/50), *self-preferential bias*, *goal drift* under
  compaction. Six documented patterns: classify-and-act, fan-out-and-synthesize,
  adversarial verification, generate-and-filter, tournament, loop-until-done.
- **Rollout details that shaped our security rules**: the `ultracode` keyword originally
  fired from any input route; v2.1.210 restricted it to human-typed prompts after
  webhook/PR-comment injection abuse — we adopted "human-typed commands only" from day one.

## 2. Reception — the criticism that became our design

From the HN launch thread (200 pts) and diffuse follow-ups:

- **Token burn**: 62 Opus 1M-context subagents burning a 5-hour window in 18 minutes;
  weekly limits gone in minutes; "tokenmaxxing disguised as a product".
- **"Slop debt"**: LLM-implemented, LLM-cleaned output degrading — the real fix (a type
  split) "only came in the shower"; LLM never proposed it.
- **Opacity**: runs disappear into "ultra-specific madness" (a 20-hour optimization spiral
  that lost the original issue); users "keep interrogating to get a sense of what is
  happening".
- **Security**: PromptArmor found workflow subagents inheriting elevated permission modes
  (confirmed v2.1.168) — the origin of our escalation/quarantine posture and minimal guard
  hook.
- **The defenders' real point**, which we kept: quality gains come mostly from
  **clean-context subagents** and verification loops, not from raw model spend; one
  head-to-head found ultracode ≈ a wash vs a cheaper model at medium effort.
- **Community convergence (the "middle path")** across ~20 port repos: script-as-
  orchestrator ✔, adversarial verify ✔ — plus tiered model routing, deterministic
  verification gates (makefile/exit-code driven), token budgets, journaled resumable
  state, and trigger discipline. `ultracode-token-optimization` adds anti-patterns we
  adopted verbatim: no raw log dumping, no self-reported completion, reviewers without
  decision authority, heterogeneous reviewers. And the clink port's law: **"ultracode
  assumes fan-out is cheap; when it isn't, verification is the first thing to cut"** —
  our cut-lines rule.
- **Adjacent frameworks worth stealing from**: spec-kit's per-project constitution (→
  AGENTS.md as value anchor), BMAD's process sizing (small changes skip process — our
  router's "answer directly" lanes), Superpowers' plan-as-contract and
  evidence-over-claims (→ typed verdicts), Agent-OS's standards discovery (roadmap), and
  the framework-wars critique of verbose markdown specs ("false sense of control") — why
  our "specs" are typed schemas, not prose documents.

## 3. The GLM/ZCode substrate

- **Model lineup (late 2026)**: GLM-5.3 flagship (text), GLM-5.3-Flash (320B/18B active,
  multimodal) — the only two served on the Coding Plan; `[1m]` suffix selects 1M context.
  Lineage: GLM-4.5 (2025-07) → 4.6 → 4.7 → 5 (2026-02) → 5.1 → 5.2 (1M context) → 5.3
  (2026-08, ~50% coding gain over 5.2).
- **Coding Plan**: Lite/Pro/Max tiers, 5h+weekly credit pools, off-peak discount, token
  multipliers (5.3 ≈ 6.9/1.7/24, Flash ≈ 2.3/0.56/8 per 10k in/cached/out). Endpoint:
  `https://api.z.ai/api/anthropic` (Anthropic-compatible, first-class Claude Code
  support via `ANTHROPIC_BASE_URL`).
- **ZCode already ships a dynamic-workflow engine** (`CreateWorkflow` and siblings) —
  with several designs we rate *better* than Claude Code's: typed `ask<T>()` results with
  JSDoc-driven schemas, `world.run()` as a deterministic gate primitive (nonzero exit is
  a value), journaled/resumable runs, `AmendWorkflow` zero-token revision cache keyed on
  stable subagent names, artifact deliverables, and — critically — **explicit-request-only
  triggering**, which matches the community's trigger-discipline lesson.
- **Hard constraints we design around**: subagent model choice is per-run (no per-agent
  tiers) → tiering happens per-run + session-model final synthesis; no per-subagent tool
  profiles → roles are persona+ask contracts; only 7 hook events (vs Claude Code's ~27);
  commands lack `!`-shell/`@file`; plugin format otherwise highly compatible (accepts
  `.claude-plugin/` manifests; can consume Anthropic plugin marketplaces).
- No GLM-specific ultracode system existed at research time — this repo is that gap,
  filled on the middle path.

## Design-decision traceability

| Decision | Source |
|---|---|
| Script-as-orchestrator, results out of context | Claude Code dynamic workflows (§1) |
| Explicit-only trigger + propose-once | ZCode runtime rule + community burn stories (§2) |
| Flash-tier runs + session synthesis | Coding Plan multipliers (§3); UltraCode-Shim two-slot routing |
| Deterministic gates before LLM judgment | gojkoa's gate-driven rewrite (-80% tokens); pi-dynamic-workflows `verify()` |
| Round caps + escalate-with-best-so-far | "20-hour spiral" reports; kieiken anti-rework rules |
| Confirmers label, never drop | ZCode bundled workflow contract §10 |
| Quarantine readers | Anthropic quarantine pattern; PromptArmor permission finding |
| Destructive-op guard (minimal) | PromptArmor; our P6 |
| Amend-first revision policy | ZCode AmendWorkflow cache design (§3) |
| Typed schemas instead of prose specs | framework-wars "false sense of control" critique (§2) |

## Sources

**Official (Anthropic / Claude Code)**
- claude.com/blog/introducing-dynamic-workflows-in-claude-code
- claude.dev/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code/
- code.claude.com/docs/en/workflows · /settings-reference · /model-config
- anthropics/claude-code CHANGELOG.md (v2.1.154/160/210/248/282)
- anthropic.com/engineering/built-multi-agent-research-system · /effective-context-engineering-for-ai-agents · /writing-tools-for-agents

**Reception & community**
- news.ycombinator.com/item?id=48311705 (launch, 200 pts) · 48351384 (DIY skeptic) · 48376337 · 48507241 · 48543595 · 49415754 · 48903047 · 49587379 (gate-driven -80%) · 45155302 (framework wars)
- promptarmor.com/resources/claude-dynamic-workflows-use-incorrect-permissions
- note.com/tolove/n/n08cf64926fd4 · shmck.substack.com/p/claude-code-framework-wars
- martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html · theregister.com/2026/01/27/ralph_wiggum_claude_loops/

**Ports & optimization repos**
- github.com/QuintinShaw/pi-dynamic-workflows · OnlyTerp/UltraCode-Shim · PabloNAX/ultracode-skill · YuanpingSong/ultracodex · malakhov-dmitrii/grok-ultracode · norandom/OpenUltraCode · Shiyao-Huang/unlock-claude-ultracode · kieiken/ultracode-token-optimization · travisliu/open-dynamic-workflow · kolega-ai/kolega-code · peymanvahidi/awesome-claude-dynamic-workflows · xenodeve/xeno-skills#164 · omdsh-dev/dsh_workflow · just-every/plugin-ultracode · Tatlatat/ultimate-deepseek-ultracode · hieutrtr/ralphmad
- github.com/SuperClaude-Org/SuperClaude_Framework · ruvnet/ruflo · github/spec-kit · bmad-code-org/BMAD-METHOD · buildermethods/agent-os · obra/superpowers · affaan-m/everything-claude-code

**GLM / Z.ai / ZCode**
- docs.z.ai/devpack/overview · /quick-start · /tool/claude · /latest-model · /extension/coding-tool-helper · /tool/others · /transition
- docs.z.ai/release-notes/new-released · zcode.z.ai (+ /cn/docs/subagents, /cn/docs/automations)
- Local ground truth: ZCode bundled `dynamic-workflows` skill + facade; installed plugin
  manifests/hooks formats; `ListModels` output on this machine.
