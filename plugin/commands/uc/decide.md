---
description: Decide workflow — tournament with a shared judge doing pairwise comparison; winner plus rationale.
argument-hint: <question to decide>
---
The user requested the **decide** workflow. This is an explicit, binding workflow request.

Question, verbatim: $ARGUMENTS

Start `CreateWorkflow` with `saved: { name: "decide", args: { question: <the user's words, verbatim, quoted safely> } }`
(add `options` as JSON only if the user wants a fixed candidate list; otherwise the
workflow generates candidates). Set `subagent_model` to GLM-5.3-Flash$max (the judge and challenger are the value —
standing default). Name the run in the user's language.

Do not poll the run. When the completion notification arrives, relay faithfully: the
winner and full ranking, the decisive comparison, the challenger's failure modes and
flip-assumptions (findings and notCovered — the user must see what would reverse the
decision), and point to the decision artifact.
