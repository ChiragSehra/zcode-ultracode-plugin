---
description: Fan-out research workflow — parallel independent readers, confirmed load-bearing findings, sourced report.
argument-hint: <topic or question>
---
The user requested the **research** workflow. This is an explicit, binding workflow request.

Topic, verbatim: $ARGUMENTS

Start `CreateWorkflow` with `saved: { name: "research", args: { topic: <the user's words, verbatim, quoted safely>, depth: "m" } }`
(use `depth: "s"` for a focused question, `"l"` only if the user asked for depth).
Set `subagent_model` to GLM-5.3-Flash$high — readers extract, confirmers judge (standing
default; resolve via ListModels if rejected). Name the run in the user's language.

Do not poll the run. When the completion notification arrives, relay the report faithfully
(conclusion, confirmed vs unconfirmed findings, verified, notCovered) and point the user at
the published report artifact. You (the session model) do the final-mile synthesis of the
returned packet — the workflow returns structured findings, not finished prose.
