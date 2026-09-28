---
description: Audit workflow — fresh auditor per unit, judge dedupes and ranks, independent confirmation of top findings.
argument-hint: <target: files, directory, endpoint list, or dependency scope>
---
The user requested the **audit** workflow. This is an explicit, binding workflow request.

Target, verbatim: $ARGUMENTS

Start `CreateWorkflow` with `saved: { name: "audit", args: { target: "$ARGUMENTS" } }`
(add `rubric: "…"` only if the user named specific criteria). Set `subagent_model` to
GLM-5.3-Flash (standing default). Name the run in the user's language.

Do not poll the run. When the completion notification arrives, relay the report faithfully:
confirmed findings with evidence and severity, unconfirmed ones labelled as such, what was
covered vs not, and the audit report artifact.
