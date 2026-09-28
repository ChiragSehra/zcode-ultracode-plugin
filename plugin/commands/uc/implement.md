---
description: Implement workflow — plan task packets, execute in parallel waves, deterministic build/test gates, independent skeptic review.
argument-hint: <what to build or change>
---
The user requested the **implement** workflow. This is an explicit, binding workflow request.

Task, verbatim: $ARGUMENTS

Start `CreateWorkflow` with `saved: { name: "implement", args: { task: <the user's words, verbatim, quoted safely>, size: "m" } }`
(`size: "s"` for a small change, `"l"` only if the user asked for scale; pass `gates` as
JSON only if the user named specific commands). Set `subagent_model` to GLM-5.3-Flash$high
(planner/reviewer want depth, implementers dominate the count — standing default). Name
the run in the user's language.

Do not poll the run. When the completion notification arrives, relay the report faithfully:
what was implemented, which gates passed (`verified`), what skeptics flagged, anything that
hit a repair/verify round cap (`notCovered`), and the diff summary artifact.
