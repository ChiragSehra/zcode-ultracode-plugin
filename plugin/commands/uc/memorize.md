---
description: Memorize a lesson from a completed run — distills it, confirms it against the cited evidence, and merges it into project memory.
argument-hint: "<observation> ||| <evidence: run ids, paths, doc anchors>"
---
The user requested the **memorize** maintenance workflow. This is an explicit, binding
workflow request.

Parse `$ARGUMENTS` as two parts split on ` ||| `: the observation, and the evidence
receipts backing it (run ids, file paths, doc anchors). If either part is missing, ask
the user one question for the missing half — memory without evidence is refused by
policy, so guessing is pointless.

Start `CreateWorkflow` with `saved: { name: "memorize", args: { input: <observation,
quoted safely>, evidence: <evidence, quoted safely> } }`. Set `subagent_model` to
GLM-5.3-Flash$high (judgment-light distillation — standing default; resolve via
ListModels if rejected). Name the run in the user's language.

Do not poll the run. When the completion notification arrives, relay what was confirmed,
written, merged, and refused — refused lessons stay visible, not silently dropped.
