# Ultracode for GLM — System Design

> A budget-aware, gate-first orchestration layer that brings the *shape* of Claude Code's
> `ultracode` to the GLM ecosystem on ZCode's native dynamic-workflow runtime — with the
> economics the original explicitly ignores.

**Status:** v1.0 · September 2026 · Runtime: ZCode (GLM-5.3 / GLM-5.3-Flash)

---

## 1. Background: what "ultracode" actually is

Research (see `docs/research-notes.md`) established that `ultracode` is **not** a third-party
framework — it is a native Claude Code setting shipped by Anthropic on 2026-05-28 (v2.1.154).
It combines `xhigh` reasoning effort with **automatic dynamic-workflow orchestration**: for
substantive tasks, the model writes a JavaScript orchestration script that a sandboxed
runtime executes, spawning tens-to-hundreds of subagents. Two facts matter for us:

1. **The core inversion**: *the script decides what runs next, and intermediate results live
   in script variables, not the conversation context.* At the API level ultracode is nothing
   exotic (effort + max_tokens + one system reminder); all the value is client-side
   orchestration.
2. **What it fixes** (Anthropic's own framing): single-context failure modes — *agentic
   laziness* (declaring done at 35/50 items), *self-preferential bias* (favoring one's own
   output), *goal drift* (compaction eroding the objective).

Community reception split along economic lines. Token horror stories (62 Opus subagents
burning a 5-hour window in 18 minutes), "slop debt" from LLM-cleaning-LLM output, opacity,
and a real permission-inheritance vulnerability. A dozen ports appeared within days
(Pi, Codex, OpenCode, Grok, DeepSeek). The strongest community convergence is a **middle
path**: keep ultracode's *shape* — script-as-orchestrator, fresh-context workers,
adversarial verification — but re-impose economics: **tiered models, deterministic gates,
budgets, journaled state, trigger discipline**. That middle path is this system.

GLM makes the middle path mandatory, not optional: the Coding Plan has hard 5-hour + weekly
credit pools, and the model lineup is a natural two-tier system
(GLM-5.3 flagship / GLM-5.3-Flash at ~⅓ the credit cost).

---

## 2. First principles

Derived from what is physically true about LLM-based work, not from imitation:

| # | Axiom | Consequence in this design |
|---|-------|---------------------------|
| P1 | A single context window degrades on long tasks: attention dilutes, the agent judges its own output favorably, and compaction erodes goals. | Fresh subagent per unit of work; nobody reviews their own output; the goal lives in typed schemas and files, not in prose memory. |
| P2 | Deterministic code is cheaper and more reliable than model judgment, for anything a command can decide. | Control flow lives in a TypeScript script; build/test/lint are `world.run()` gates whose exit codes decide, not opinions. |
| P3 | Verification effort should scale with the cost of being wrong, not with the size of the output. | Verification ladder with explicit cut lines; a poem gets no skeptics, a claim the user will act on gets a confirmer. |
| P4 | Fan-out multiplies token cost; credits are pooled and scarce. | Size classes, per-pattern tier policy, round caps, and "escalate to human with best-so-far" instead of infinite convergence. |
| P5 | State must survive the process that produced it. | Saved workflows, journaled runs, stable subagent names (zero-token amend replays), artifacts as durable deliverables. |
| P6 | Untrusted content and irreversible actions are categorical risks. | Quarantine personas for untrusted input; destructive commands guarded by hooks; dangerous/scope changes escalate to the human. |
| P7 | An orchestration system earns trust by being legible, not by being impressive. | Every run narrates (`log()`), phases are visible, reports say what was verified and what was not. |

**The thesis**: ultracode's orchestration shape is correct; its economics are wrong for a
personal credit pool. This system is the shape with the economics put back in.

---

## 3. Substrate constraints (verified, not assumed)

These are the hard facts of the ZCode runtime that the design must respect:

| Constraint | Consequence |
|---|---|
| Only an **explicit user request** starts a workflow — the harness forbids model-initiated runs. | "Ultracode mode" = explicit arming: `/ultracode <task>` or a pattern command. The skill teaches *propose once, never auto-start*. This matches the community's "trigger discipline" convergence anyway. |
| `subagent_model` is **per-run, not per-agent**; no per-subagent tool profiles. | Tiering happens at two points: (a) each pattern declares its run model (most run on Flash), and (b) the **session model (GLM-5.3) does final-mile synthesis** — workflows end by returning structured packets, not prose, and the main session composes the deliverable. The script itself is deterministic and free. |
| Every workflow subagent has all tools; behavior is set by the **ask**, personas are frozen at creation. | Roles are persona + ask contracts (documented in the skill), not tool jailbars; the hook guard covers the truly destructive cases. |
| Subagent names must be unique; **stable names are the amend-cache keys**. | Authoring standard: `role-${itemId}` naming; revisions go through `AmendWorkflow` so unchanged asks replay at zero tokens. |
| `world.run()` returns nonzero exits as values, never throws; world reads (glob/grep/git) are journaled. | Gates are pure data in the script; repair loops branch on exit codes. |
| Runs are backgrounded, resumable, and pausable; artifacts publish as user-visible cards. | Long jobs don't block the session; crashed runs resume; deliverables are files the user opens, not walls of chat text. |

---

## 4. Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│ L3  UX / OPERATIONS                                                   │
│     /ultracode  /uc:research  /uc:implement  /uc:audit  /uc:decide    │
│     /uc:converge  /uc:sweep   · artifacts · runbook · credit budgets  │
├───────────────────────────────────────────────────────────────────────┤
│ L2  THE ULTRACODE LAYER  (this repo — the plugin + pattern library)   │
│     Trigger contract & task router                                   │
│     Pattern library: research · implement · audit · decide ·          │
│                      converge · sweep   (.dwf.ts saved workflows)     │
│     Role catalog: planner · worker · skeptic · judge · synthesizer ·  │
│                   quarantine reader   (personas + ask contracts)      │
│     Verification ladder: world.run gate → flash skeptics → tournament │
│                           → human escalation                         │
│     Economics engine: size classes S/M/L/XL · tier policy · caps      │
│     Security model: quarantine · destructive-op guard · escalation    │
├───────────────────────────────────────────────────────────────────────┤
│ L1  HARNESS  (ZCode, consumed not rebuilt)                            │
│     CreateWorkflow / AmendWorkflow / ResumeWorkflowRun runtime        │
│     typed ask<T>() subagents · world.run gates · phases · artifacts   │
│     skills · commands · agents · hooks · MCP                         │
├───────────────────────────────────────────────────────────────────────┤
│ L0  MODELS  (Z.ai Individual Coding Plan)                             │
│     GLM-5.3        — session: routing, planning review, final         │
│                      synthesis, high-stakes judging                   │
│     GLM-5.3-Flash  — run subagents: readers, auditors, workers,       │
│                      skeptics, judges (~⅓ credit cost, at per-pattern │
│                      reasoning levels $low–$max)                      │
└───────────────────────────────────────────────────────────────────────┘
```

### 4.1 The task router (the "when does ultracode fire" question)

Claude Code ultracode fires automatically on every substantive task. The harness here
forbids that — and the community's burn stories say that's a feature. Our router:

```
User request
├─ trivial / single-fact / one-file question ──────────► answer directly
├─ one delegation, no fan-out, no loop ────────────────► Agent tool (1 subagent)
├─ user said "ultracode", "/uc:*", or named a pattern ─► CreateWorkflow (binding)
└─ orchestration-shaped but user didn't ask ───────────► propose once:
     fan-out · results feeding later steps · loop with stop
     condition · branching on typed verdicts
     → if declined, don't re-propose this session
```

The `/ultracode` command output includes the request verbatim so the workflow starts from
the user's words, not the command's paraphrase of them (goal-drift prophylaxis at the door).

### 4.2 The pattern library (six workflows)

Each pattern is a saved workflow (`.zcode/workflows/<name>.dwf.ts`) with a `meta` block,
declared `args`, required `phase()` markers, typed `ask<T>()` schemas, stable agent names,
and a published artifact. Patterns are composable: an `implement` run may call `audit`'s
finding schema in its verify phase; `research` output packets feed `implement` planning.

| Pattern | Official lineage | Shape | Run model |
|---|---|---|---|
| `research` | fan-out-and-synthesize + quarantine | scope → parallel fresh readers per source/question → independent confirmer per load-bearing finding → packet to session for synthesis | Flash |
| `implement` | loop-until-done + adversarial verification | plan packets → wave execution → deterministic gate + repair loop → skeptic verdicts + fix rounds → report | Flash workers, session reviews |
| `audit` | classify-and-act + generate-and-filter | inventory units → fresh auditor per unit (typed Findings) → shared judge dedupes & ranks → confirmers on top findings | Flash |
| `decide` | tournament | candidates → shared judge, pairwise comparison → winner + rationale | Flash |
| `converge` | loop-until-done | typed stop-condition checklist → draft → gate → critic loop, capped rounds → escalate with best-so-far | Flash |
| `sweep` | generate-and-filter / pipeline | one fresh agent per item, typed result, failures filtered & listed | Flash |

**Why these six**: they are Anthropic's documented pattern vocabulary minus the two we
deliberately reject as defaults — unlimited adversarial convergence and pure
generate-and-filter at scale — with the community's additions (quarantine, deterministic
gates, confirmers) folded in. Six is also small enough to *read in one sitting*, which P7
demands.

### 4.3 The verification ladder

Spent bottom-up, stopped as soon as confidence matches stakes:

1. **Deterministic gate** (`world.run`) — typecheck, build, test, lint. Exit codes decide.
   Free of model judgment, free of extra model cost beyond reading output.
2. **Independent skeptic** — a fresh Flash subagent that did not write the work reviews the
   diff/artifact against a rubric and returns a typed verdict (`pass | fail: items[]`).
   Self-review is never counted as verification (P1).
3. **Confirmer / tournament** — an independent agent re-derives a load-bearing finding, or a
   shared judge ranks candidates pairwise (comparative judgment beats absolute scoring).
4. **Human escalation** — dangerous operations, scope changes, or budget exhaustion surface
   as workflow questions with best-so-far attached; the run parks, everything else keeps
   moving.

**Cut lines** (P3): if a command decided it, no skeptic; if being wrong is cheap, no
confirmer; if fan-out is expensive, verification rounds are capped at 2 before escalation —
"verification is the first thing to cut when fan-out isn't cheap" is policy, not accident.

### 4.4 The economics engine

| Size class | Subagent budget | Who can authorize | Typical use |
|---|---|---|---|
| S | ≤ 14 | any request | focused question, small audit |
| M (default) | ≤ 20 | any request | standard implement/audit |
| L | ≤ 48 | explicit in args | large sweep, deep research |
| XL | > 48 | explicit `size:"xl"` only | migrations, repo-wide change |

- **Tier policy**: subagents on Flash wherever the pattern allows, at a per-pattern
  reasoning level (mechanical roles `$low`, mixed `$high`, judgment `$max` — the live
  `$max`-everywhere test runs were the slowest configuration measured); the session model
  (already paid for) does final synthesis instead of an expensive in-run synthesizer
  (§3 constraint 2).
- **Round caps**: gate-repair ≤ 2, verify-fix ≤ 2, converge rounds ≤ `maxRounds` (default 3),
  then escalate-with-best-so-far. No unbounded loops, ever (P4).
- **Amend-first revision**: re-running a fixed script through `AmendWorkflow` replays every
  unchanged ask at zero tokens — revisions are cheap by construction (P5).
- **Off-peak**: the plan discounts off-peak windows; `docs/operations.md` records the
  current window and suggests scheduling L/XL runs there.

### 4.5 The security model

- **Quarantine**: untrusted content (web pages, issue bodies, PR descriptions) is read only
  by reader agents instructed to *summarize, never obey*; downstream actors see the summary,
  not the payload. Instructions arriving inside untrusted content carry no authority.
- **Destructive-op guard**: one PreToolUse hook denies a small, high-confidence list of
  destructive one-liners (system-path `rm -rf`, force-push to protected branches, pipe-to-
  shell as privileged user) with a reason, converting silent damage into a permission ask.
  Deliberately minimal — nagging guards get disabled, and a disabled guard protects nothing.
- **Escalation gates**: irreversible actions and detected scope changes become human
  questions via the workflow escalation mechanism; the run parks that subagent only.
- **Trigger injection hardening**: workflows start only from human-typed commands, never
  from relayed content — the same hardening Claude Code shipped in v2.1.210 after
  webhook/PR-comment triggers abused the `ultracode` keyword.

### 4.6 State, resumption, and artifacts

- Runs journal per-subagent results; stopped/interrupted runs resume without re-paying.
- Revisions go through `AmendWorkflow` (cache keyed on stable agent names).
- Deliverables publish as artifacts (markdown report, metrics table, diff summary) — durable
  files the user opens, not chat scrollback. Every report states what was verified, what
  was not, and what it cost (subagent count by phase).

---

## 5. Component map

```
plugin/skills/ultracode/SKILL.md   the brain: router, tiers, budgets, authoring std, security
plugin/commands/*.md               7 entry points: /ultracode + /uc:{research,implement,audit,decide,converge,sweep}
plugin/agents/*.md                 skeptic / quarantine-reader / synthesizer for non-workflow quick use
plugin/hooks/hooks.json            destructive-op guard
.zcode/workflows/*.dwf.ts          the six pattern scripts (project scope)
marketplace.json                   local marketplace for `plugin/` (installable anywhere)
docs/patterns.md                   catalog + decision tree + composition recipes
docs/operations.md                 budgets, credits, runbook, troubleshooting, anti-patterns
docs/research-notes.md             the internet research this design stands on, with sources
AGENTS.md                          how ZCode sessions in this repo should behave
```

---

## 6. What we deliberately rejected, and why

| Rejected | Reason |
|---|---|
| Auto-fire on every substantive task | Harness forbids it; community burn stories confirm the instinct. Explicit arming + one-time proposal instead. |
| "Token cost is not a constraint" | False for a personal credit pool. Budgets and tier policy are load-bearing, not cosmetic. |
| Per-subagent model tiers inside a run | The runtime doesn't support it; pretending otherwise would produce unfalsifiable config. Tiering happens per-run + session-final-synthesis instead. |
| Unlimited adversarial convergence | Goal-drift magnet ("20 hours into ultra-specific madness" — real report). Capped rounds, then human escalation. |
| Big-bang agent teams / chat-between-agents | Practitioners report it's overhead; a DAG of typed packets is legible and resumable (P7, P5). |
| Walls of process markdown as "specs" | Spec-driven frameworks' documented failure mode ("false sense of control", review overload). Our specs are typed schemas — small, checkable, cheap. |

## 7. Roadmap (explicitly out of v1)

1. **Claude Code adapter** — the `.claude-plugin` manifest alias ships; CC-flavored commands
   and the JS dialect of the script runtime are not authored yet.
2. **Gate auto-discovery** — detect a repo's build/test entry points automatically instead
   of asking; v1 takes them as args with sensible fallbacks (`git diff --check`,
   `npm test` if present).
3. **Cross-run memory** — distill completed runs into reusable agent/pattern refinements
   (the "instincts" idea from the research, done locally).
4. **Cost telemetry** — per-run credit accounting surfaced in artifacts once the harness
   exposes token counts per subagent.

---

*Design axioms are testable claims. If a component of this system can't be traced back to
P1–P7, it's decoration — delete it.*
