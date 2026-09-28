---
description: Converge workflow — iterate a draft until typed stop-conditions pass, capped rounds, human escalation on exhaustion.
argument-hint: <goal + what "done" means>
---
The user requested the **converge** workflow. This is an explicit, binding workflow request.

Goal, verbatim: $ARGUMENTS

Start `CreateWorkflow` with `saved: { name: "converge", args: { goal: "$ARGUMENTS", maxRounds: 3 } }`
(raise `maxRounds` only if the user asks). Set `subagent_model` to GLM-5.3-Flash (standing
default). Name the run in the user's language.

Do not poll the run. When the completion notification arrives, relay the outcome honestly:
converged (which stop-conditions passed) or capped (best-so-far plus what remains), with
the progression artifact.
