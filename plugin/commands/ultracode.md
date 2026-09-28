---
description: Arm ultracode for a task — route it to the right workflow pattern (research, implement, audit, decide, converge, sweep) or craft an ad-hoc one.
argument-hint: <task, exactly as you want it done>
---
The user armed ultracode. This is an **explicit, binding workflow request** — the task must
run as a dynamic workflow (`CreateWorkflow`), not inline and not as a plain Agent call.

The user's task, verbatim: $ARGUMENTS

Follow the `ultracode` skill (this plugin) for policy:

1. **Pick the pattern**: research / implement / audit / decide / converge / sweep per the
   skill's pattern picker. If two patterns plausibly fit, ask the user which — one
   question, options named. If none fits, author an ad-hoc workflow per the skill's
   authoring standards.
2. **Size class**: default M (≤ 20 subagents) unless the task is clearly small (S) or the
   user asked for deep/wide (L needs explicit sizing).
3. **Start it**: `CreateWorkflow` with `saved: { name, args }` and the pattern's tier from
   the skill's §3 table — `decide`/`converge` on GLM-5.3-Flash$max, `implement`/`research`/
   `audit` on GLM-5.3-Flash$high, `sweep` on GLM-5.3-Flash$low (resolve via ListModels if
   the id is rejected). Name the run in the user's language.
4. **Do not poll.** Continue other work; the completion notification carries the report
   and artifacts. Relay the report's conclusion, findings, verified and notCovered to the
   user faithfully — including anything that hit a round cap or budget.
