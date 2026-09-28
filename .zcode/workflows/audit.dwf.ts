/* zcode-workflow
description: "Audit many units in parallel: one fresh auditor per unit with a
  typed findings schema, independent confirmation of high-severity findings (the
  report says when none were attempted), one shared judge dedupes and ranks
  everything, sourced audit-report artifact. Runs on GLM-5.3-Flash$high."
whenToUse: Use when the user asks to audit or review many units for problems
  (/uc:audit or /ultracode routed to audit) — files, a directory, an endpoint
  list. For reviewing a small diff, prefer a plain Agent review; for one file,
  answer directly.
args:
  rubric:
    type: string
    description: Optional criteria the audit must apply, e.g. 'missing auth checks,
      unvalidated input'.
  target:
    type: string
    description: "What to audit: a glob (src/**/*.ts), a directory (src/routes), or
      a scope description the workflow resolves."
    required: true
*/
const target = String(args.target);
const rubric = typeof args.rubric === "string" && args.rubric.length > 0 ? args.rubric : null;
const unitCap = 8;
const confirmCapPerUnit = 1;

interface Finding {
  /** Where: workspace-relative path with line when it applies, e.g. "src/a.ts:42". */
  where: string;
  /** One sentence: what is wrong, not how to fix it. */
  what: string;
  /** The lines read or command run that showed it. */
  evidence: string;
  /** Reserve "high" for data loss, a crash, or a wrong result. */
  severity: "low" | "medium" | "high";
}
interface UnitReport {
  /** Findings for this unit; empty when clean. */
  findings: Finding[];
  /** What could not be checked in this unit and why. */
  notChecked: string[];
}
interface Confirmation {
  /** True when the finding was independently reproduced from its evidence. */
  reproduced: boolean;
  /** One sentence: how, or why not. */
  note: string;
}
interface RankedFinding {
  where: string;
  what: string;
  evidence: string;
  severity: "low" | "medium" | "high";
  /** "verified" when an independent subagent reproduced it; "unconfirmed" otherwise. */
  status: "verified" | "unconfirmed";
}
interface Triage {
  /** Findings worth the user's attention, worst first. */
  ranked: RankedFinding[];
  /** Near-duplicates folded together, as "X ≈ Y". */
  duplicates: string[];
}
interface PatternProposals {
  /** Workspace-relative glob patterns that would match the units to audit. */
  patterns: string[];
}

phase("Find the units and audit them in parallel, confirming what looks serious");
const units: string[] = [];
const seen = new Set<string>();
const collect = (paths: string[]) => {
  for (const p of paths) {
    if (!seen.has(p)) {
      seen.add(p);
      units.push(p);
    }
  }
};
collect(await files.glob(target));
if (units.length === 0 && !target.includes("*")) {
  collect(await files.glob(`${target}/**/*`));
}
if (units.length === 0) {
  const scout = agent("inventory-scout");
  const proposals = await scout.ask<PatternProposals>(
    `The user wants to audit: "${target}". Direct globbing found nothing. Propose 2-3 workspace-relative glob patterns that would match the units to audit. Return only patterns.`,
  );
  for (const p of proposals.patterns.slice(0, 3)) {
    collect(await files.glob(p));
  }
}
if (units.length === 0) {
  return {
    conclusion: `Nothing matched the audit target "${target}"; nothing was audited.`,
    findings: [],
    verified: [],
    notCovered: [`audit target "${target}" matched no files`],
  };
}
const audited = units.slice(0, unitCap);
const deferred = units.slice(unitCap);
log(`Auditing ${audited.length} unit(s)${deferred.length > 0 ? `; ${deferred.length} beyond the cap deferred` : ""}`);

const rubricLine = rubric !== null ? `Apply this rubric: ${rubric}.` : "Use expert judgment: real problems (bugs, security holes, data loss, wrong behavior), not style nits.";
const unitResults = await Promise.all(
  audited.map(async (unit, ui) => {
    const unitReport = await agent(`auditor-${ui}`).ask<UnitReport>(
      `Audit this unit for real problems. ${rubricLine}\n\nUnit: ${unit}\n\nCite path:line evidence for every finding. Do not edit any file.`,
    );
    const serious = unitReport.findings.filter((f) => f.severity === "high").slice(0, confirmCapPerUnit);
    const confirmations = await Promise.all(
      serious.map((f, fi) =>
        agent(`confirmer-${ui}-${fi}`).ask<Confirmation>(
          `Independently reproduce this finding from its evidence: read the code, run a read-only check if useful. Do not edit any file.\n\nFinding: ${f.what}\nWhere: ${f.where}\nEvidence: ${f.evidence}`,
        ),
      ),
    );
    const marked: RankedFinding[] = unitReport.findings.map((f) => {
      const idx = serious.indexOf(f);
      const conf = idx >= 0 ? confirmations[idx] : undefined;
      const status: "verified" | "unconfirmed" =
        idx >= 0 && conf !== undefined && conf.reproduced ? "verified" : "unconfirmed";
      return { where: f.where, what: f.what, evidence: f.evidence, severity: f.severity, status };
    });
    for (const f of marked) {
      report({ where: f.where, what: f.what, severity: f.severity, status: f.status });
    }
    return { unit, findings: marked, notChecked: unitReport.notChecked, attempts: confirmations.length };
  }),
);
const allFindings = unitResults.flatMap((r) => r.findings);
const verifiedCount = allFindings.filter((f) => f.status === "verified").length;
const confirmAttempts = unitResults.reduce((n, r) => n + r.attempts, 0);

phase("Rank the findings and deduplicate across units");
const triage = await agent("lead-auditor", {
  system:
    "You triage audit findings on one consistent scale: rank by what would cost the user most if ignored, fold near-duplicates, never upgrade a finding's status.",
}).ask<Triage>(
  `Rank these findings worst-first and fold near-duplicates. Keep every finding's status exactly as given.\n\nFindings: ${JSON.stringify(allFindings)}`,
);

const rankedList = triage.ranked.length > 0 ? triage.ranked : allFindings;
const markdown = [
  `# Audit: ${target}`,
  "",
  `${rankedList.length} finding(s) across ${audited.length} unit(s); ${verifiedCount} independently confirmed.`,
  ...(rubric !== null ? ["", `Rubric: ${rubric}`] : []),
  "",
  "| # | Severity | Status | Where | Problem |",
  "|---|---|---|---|---|",
  ...rankedList.map((f, i) => `| ${i + 1} | ${f.severity} | ${f.status} | \`${f.where}\` | ${f.what} |`),
  ...(triage.duplicates.length > 0 ? ["", "## Duplicates folded", "", ...triage.duplicates.map((d) => `- ${d}`)] : []),
  ...(unitResults.some((r) => r.notChecked.length > 0)
    ? ["", "## Not checked", "", ...unitResults.flatMap((r) => r.notChecked.map((n) => `- ${r.unit}: ${n}`))]
    : []),
  ...(deferred.length > 0 ? ["", `_${deferred.length} unit(s) beyond the cap were not audited._`] : []),
].join("\n");
await artifact.markdown("report", markdown, {
  title: `Audit: ${target.slice(0, 80)}`,
  description: `${rankedList.length} finding(s), ${verifiedCount} confirmed, across ${audited.length} unit(s).`,
  primary: true,
});

return {
  conclusion: `${rankedList.length} finding(s) across ${audited.length} unit(s); ${verifiedCount} independently confirmed; worst: ${rankedList[0]?.what ?? "none"}.`,
  findings: rankedList.map((f) => ({
    where: f.where,
    what: f.what,
    evidence: f.evidence,
    status: f.status,
    severity: f.severity,
  })),
  verified: [
    ...(confirmAttempts > 0
      ? [`${verifiedCount}/${allFindings.length} findings independently reproduced (${confirmAttempts} confirmation(s) attempted on high-severity findings)`]
      : ["no high-severity findings raised; independent confirmation not attempted (confirmers run only on high-severity findings)"]),
    `units covered: ${audited.join(", ")}`,
  ],
  notCovered: [
    ...unitResults.flatMap((r) => r.notChecked.map((n) => `${r.unit}: ${n}`)),
    ...(deferred.length > 0 ? [`${deferred.length} unit(s) beyond the cap not audited: ${deferred.slice(0, 5).join(", ")}${deferred.length > 5 ? " …" : ""}`] : []),
  ],
};