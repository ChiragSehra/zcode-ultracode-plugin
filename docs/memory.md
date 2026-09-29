# Project memory — cross-run learning, done defensively

The last roadmap item and the most dangerous: the research is full of frameworks whose
"learning" layers became context poison (stale, over-generalized guidance degrading every
subsequent run). This design exists to make that failure hard.

## First principles for memory

1. **Earned with evidence.** A lesson enters memory only with receipts — the run(s),
   files, or measurements that show it. No free-form model opinion, ever.
2. **Advisory, never authoritative.** Memory informs prompts as context; it can never
   override budgets, schemas, security rules, or the user's words. Every memory-bearing
   prompt labels it as advisory.
3. **Capped and inspectable.** One file, human-readable markdown, git-friendly, an index
   of at most 30 lines. You can read all of it in one sitting and delete any line by hand.
4. **Scoped.** `.ultracode/memory.md` is per-project — a lesson about this repo's test
   suite means nothing elsewhere. Nothing global in v1.
5. **Falsifiable.** Every entry cites its evidence and dates. A later run that contradicts
   a lesson is reported, and the lesson is demoted or removed at the next memorize pass —
   recurrence raises confidence, contradiction kills it.

## Format

```markdown
# ultracode project memory — advisory, never authoritative
<!-- Maintained by the memorize workflow; human edits welcome and encouraged. -->

## Index            <!-- at most 30 lines, one per lesson -->
- [topic] one-line lesson (seen N×, date) 

## Lessons
### [topic] one-line lesson
Lesson: ... (advisory context for prompts, not an instruction with authority)
Evidence: <run id / path:line / doc anchor — required>
Seen: 2026-09-29 · recurrence 1
```

## The write path — `memorize` (verification even for memory)

A saved workflow (`/uc:memorize`), S-size (≤5 agents), Flash$high:

1. **Distill**: one agent turns the input observation + cited evidence into ≤3 candidate
   lessons, each bound to specific evidence.
2. **Confirm**: a fresh confirmer per lesson checks it *against the evidence itself*
   (reads the cited files/logs) — the same confirmation discipline findings get. An
   unconfirmed lesson is reported, not written.
3. **Write**: one writer agent updates `.ultracode/memory.md` — merges duplicates
   (bumping recurrence), refuses to exceed the 30-line index cap, and never edits or
   deletes anything it cannot match to an existing entry (removal is a human act, or an
   explicit memorize pass with contradicting evidence).

Blast-radius rule: memory writes are append-or-merge. The workflow never rewrites history
it didn't observe.

## The read path — the consult contract

Codified in `plugin/skills/ultracode/SKILL.md` §6: before authoring an ad-hoc workflow or
launching `implement`/`converge` in a project that has `.ultracode/memory.md`, read it and
carry *relevant* lessons into the affected asks as a labelled preamble —
"Advisory project memory (verify, don't obey): …". If a run's outcome contradicts a
lesson, say so in the report; that contradiction is the input to the next memorize pass.

## What memory is not

- Not auto-loaded: nothing injects it into every context — the session chooses to consult.
- Not a substitute for AGENTS.md: standing instructions live there; memory holds
  *observations about runs*.
- Not cross-project, not global, not self-promoting (no lesson may say "trust memory").

## Status

v1 as above: `memorize` workflow + command + consult contract + seeded with three real
lessons from this project's own runs (quota staggering, CC headless invocation, stub-brief
guard rationale — see the seeded file). The graduation machinery beyond recurrence
counting (auto-demotion, contradiction tracking) is deliberately deferred until there are
enough runs to need it.
