// Claude Code dialect of the ultracode `audit` pattern — see docs/cc-adapter.md.
// Inventory agent replaces files.glob; confirmers run only on high-severity findings and
// the report says when none were attempted (the honesty lesson from the ZCode dogfood).

export const meta = {
  name: "audit",
  description:
    "Audit many units in parallel: one fresh auditor per unit with a typed findings schema, independent confirmation of high-severity findings, one judge dedupes and ranks everything.",
  whenToUse: "Find problems across many files — a directory, a glob, an endpoint list.",
  phases: [
    { title: "Find the units and audit them in parallel, confirming what looks serious" },
    { title: "Rank the findings and write the audit report" },
  ],
};

const INVENTORY_SCHEMA = {
  type: "object",
  required: ["units"],
  properties: {
    units: {
      type: "array",
      items: { type: "string" },
      description: "Workspace-relative paths (or unit names) to audit, sorted lexicographically.",
    },
  },
};
const UNIT_REPORT_SCHEMA = {
  type: "object",
  required: ["findings", "notChecked"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["where", "what", "evidence", "severity"],
        properties: {
          where: { type: "string", description: "path:line where it applies." },
          what: { type: "string", description: "One sentence: what is wrong, not how to fix it." },
          evidence: { type: "string", description: "The lines read or command run that showed it." },
          severity: { type: "string", enum: ["low", "medium", "high"], description: "Reserve high for data loss, a crash, or a wrong result." },
        },
      },
    },
    notChecked: { type: "array", items: { type: "string" }, description: "What could not be checked and why." },
  },
};
const CONFIRM_SCHEMA = {
  type: "object",
  required: ["reproduced", "note"],
  properties: {
    reproduced: { type: "boolean", description: "True if you reproduced the finding from its evidence yourself." },
    note: { type: "string", description: "How, or why not." },
  },
};
const TRIAGE_SCHEMA = {
  type: "object",
  required: ["ranked", "duplicates"],
  properties: {
    ranked: {
      type: "array",
      items: {
        type: "object",
        required: ["where", "what", "evidence", "severity", "status"],
        properties: {
          where: { type: "string" },
          what: { type: "string" },
          evidence: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          status: { type: "string", enum: ["verified", "unconfirmed"] },
        },
      },
      description: "Findings worth the user's attention, worst first; keep statuses exactly as given.",
    },
    duplicates: { type: "array", items: { type: "string" }, description: "Near-duplicates folded, as 'X ≈ Y'." },
  },
};
const PATH_SCHEMA = {
  type: "object",
  required: ["path"],
  properties: { path: { type: "string" } },
};

let input = args;
if (typeof input === "string") {
  try {
    input = JSON.parse(input);
  } catch {
    input = {};
  }
}
const target = input !== null && typeof input === "object" && typeof input.target === "string" ? input.target : "";
const rubric =
  input !== null && typeof input === "object" && typeof input.rubric === "string" && input.rubric.length > 0
    ? input.rubric
    : null;
const unitCap = 8;

if (target === "") {
  log('audit: no target provided. Usage: /ultracode:audit {"target": "src/**/*.ts", "rubric": "optional criteria"}');
} else {
  phase("Find the units and audit them in parallel, confirming what looks serious");
  const AUDITOR_PERSONA =
    "You audit one unit for real problems — bugs, security holes, data loss, wrong behavior — not style nits. Cite path:line evidence for every finding. Do not edit any file. ";
  const CONFIRMER_PERSONA =
    "You independently reproduce one finding from its evidence: read the code, run a read-only check if useful. Do not edit any file. ";

  const inventory = await agent(
    `List the units to audit for this target, as workspace-relative paths sorted lexicographically. Interpret the target as a glob, a directory, or a scope description; use your file tools to list. Do not edit anything.\n\nTarget: ${target}`,
    { label: "inventory-scout", schema: INVENTORY_SCHEMA },
  );
  const units = (inventory !== null ? inventory.units : []).slice(0, unitCap);
  const deferred = inventory !== null ? Math.max(0, inventory.units.length - unitCap) : 0;

  if (units.length === 0) {
    log(`audit: nothing matched "${target}"`);
  } else {
    log(`Auditing ${units.length} unit(s)${deferred > 0 ? `; ${deferred} beyond the cap deferred` : ""}`);
    const rubricLine = rubric !== null ? `Apply this rubric: ${rubric}.` : "";

    const unitResults = await parallel(
      units.map(async (unit, ui) => {
        const unitReport = await agent(
          AUDITOR_PERSONA + `${rubricLine}\n\nUnit: ${unit}`,
          { label: `auditor-${ui + 1}`, schema: UNIT_REPORT_SCHEMA },
        );
        if (unitReport === null) return { unit, findings: [], notChecked: ["auditor agent failed"], attempts: 0 };
        const serious = unitReport.findings.filter((f) => f.severity === "high").slice(0, 1);
        const confirmations = await parallel(
          serious.map((f) =>
            agent(
              CONFIRMER_PERSONA + `Finding: ${f.what}\nWhere: ${f.where}\nEvidence: ${f.evidence}`,
              { label: `confirmer-${ui + 1}`, schema: CONFIRM_SCHEMA },
            ),
          ),
        );
        const marked = unitReport.findings.map((f) => {
          const idx = serious.indexOf(f);
          const conf = idx >= 0 ? confirmations[idx] : null;
          return {
            where: f.where,
            what: f.what,
            evidence: f.evidence,
            severity: f.severity,
            status: idx >= 0 && conf !== null && conf.reproduced === true ? "verified" : "unconfirmed",
          };
        });
        return { unit, findings: marked, notChecked: unitReport.notChecked, attempts: confirmations.length };
      }),
    );
    const allFindings = unitResults.flatMap((r) => r.findings);
    const verifiedCount = allFindings.filter((f) => f.status === "verified").length;
    const confirmAttempts = unitResults.reduce((n, r) => n + r.attempts, 0);

    phase("Rank the findings and write the audit report");
    const triage = await agent(
      "You triage audit findings on one consistent scale: rank by what would cost the user most if ignored, fold near-duplicates, never upgrade a finding's status.\n\n" +
        `Findings: ${JSON.stringify(allFindings)}`,
      { label: "lead-auditor", schema: TRIAGE_SCHEMA },
    );
    const rankedList = triage !== null && triage.ranked.length > 0 ? triage.ranked : allFindings;
    const verifiedLine =
      confirmAttempts > 0
        ? `${verifiedCount}/${allFindings.length} findings independently reproduced (${confirmAttempts} confirmation(s) attempted on high-severity findings)`
        : "no high-severity findings raised; independent confirmation not attempted (confirmers run only on high severity)";
    const report = [
      `# Audit: ${target}`,
      "",
      `${rankedList.length} finding(s) across ${units.length} unit(s); ${verifiedCount} independently confirmed.`,
      ...(rubric !== null ? ["", `Rubric: ${rubric}`] : []),
      "",
      "| # | Severity | Status | Where | Problem |",
      "|---|---|---|---|---|",
      ...rankedList.map((f, i) => `| ${i + 1} | ${f.severity} | ${f.status} | \`${f.where}\` | ${f.what} |`),
      ...(triage !== null && triage.duplicates.length > 0
        ? ["", "## Duplicates folded", "", ...triage.duplicates.map((d) => `- ${d}`)]
        : []),
      ...(unitResults.some((r) => r.notChecked.length > 0)
        ? ["", "## Not checked", "", ...unitResults.flatMap((r) => r.notChecked.map((n) => `- ${r.unit}: ${n}`))]
        : []),
      ...(deferred > 0 ? ["", `_${deferred} unit(s) beyond the cap were not audited._`] : []),
      "",
      `_Ported pattern (Claude Code): ${verifiedLine}; no salvage journal. See docs/cc-adapter.md._`,
    ].join("\n");
    const written = await agent(
      "Write the following report verbatim to ultracode-audit-report.md in the current directory, then return the path. Do not modify the content and do not create any other file.\n\n" +
        report,
      { label: "report-writer", schema: PATH_SCHEMA },
    );
    log(written !== null ? `Audit report written to ${written.path}` : "report writer failed");
    log(`audit: ${rankedList.length} finding(s), ${verifiedCount} confirmed; worst: ${rankedList.length > 0 ? rankedList[0].what : "none"}`);
  }
}
