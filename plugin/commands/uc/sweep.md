---
description: Sweep workflow — one fresh agent per file or item, typed results, failures filtered and listed.
argument-hint: <glob> <what to do in each file>
---
The user requested the **sweep** workflow. This is an explicit, binding workflow request.

Arguments, verbatim: $ARGUMENTS

Parse it as: first token (or first quoted segment) = the glob (e.g. `src/**/*.ts`), the
rest = the per-file task. If the split is ambiguous, ask the user one question with your
best-guess split as the default option.

Start `CreateWorkflow` with `saved: { name: "sweep", args: { glob: "<glob>", task: "<task>" } }`.
Set `subagent_model` to GLM-5.3-Flash (standing default). Name the run in the user's
language. If the glob matches more than ~30 files, tell the user the scale before starting
(size L/XL per the skill's budget table) unless they already asked for scale.

Do not poll the run. When the completion notification arrives, relay the summary: files
changed/inspected, per-file results, failures listed — never silently dropped — and the
summary artifact.
