/* zcode-workflow
description: "Sweep a file set: one fresh agent per matched file doing the same
  mechanical task, typed per-file results, failures filtered and listed (never
  silently dropped), summary artifact. Runs on GLM-5.3-Flash. Cap: 30 files per
  run."
whenToUse: Use when the user asks to apply the same mechanical change or
  extraction across many files (/uc:sweep or /ultracode routed to sweep) — add
  headers, migrate APIs, extract TODOs. For a change requiring cross-file
  design, use implement instead.
args:
  glob:
    type: string
    description: Workspace-relative glob matching the files to work through, e.g.
      src/**/*.ts.
    required: true
  task:
    type: string
    description: The mechanical task to perform in each matched file.
    required: true
*/
const globPattern = String(args.glob);
const task = String(args.task);
const fileCap = 30;

interface SweepResult {
  /** True when the task was completed for this file. */
  done: boolean;
  /** One sentence: what was done. */
  summary: string;
  /** Problems hit; empty on success. */
  problems: string[];
}

const paths = await files.glob(globPattern);
if (paths.length === 0) {
  return {
    conclusion: `No files matched "${globPattern}"; nothing was swept.`,
    findings: [],
    verified: [],
    notCovered: [`glob "${globPattern}" matched no files`],
  };
}
const inScope = paths.slice(0, fileCap);
const deferred = paths.slice(fileCap);
log(`Sweeping ${inScope.length} file(s)${deferred.length > 0 ? `; ${deferred.length} beyond the cap deferred` : ""}`);

phase("Work through each file independently");
const results = await Promise.all(
  inScope.map(async (p) => {
    try {
      const r = await agent(`worker-${p}`).ask<SweepResult>(
        `Task: ${task}\n\nFile: ${p}\n\nDo the task in this file only. If the task genuinely does not apply to this file, return done=false with the reason in problems rather than forcing it. If the task is impossible or your instructions conflict, escalate rather than faking completion.`,
      );
      report({ file: p, done: r.done, summary: r.summary });
      return { file: p, ...r };
    } catch (err) {
      return { file: p, done: false, summary: "agent failed", problems: [String(err)] };
    }
  }),
);

const okCount = results.filter((r) => r.done && r.problems.length === 0).length;
const failed = results.filter((r) => !r.done || r.problems.length > 0);
const markdown = [
  `# Sweep: ${task}`,
  "",
  `${okCount}/${results.length} file(s) completed cleanly.`,
  "",
  "| File | Done | Summary |",
  "|---|---|---|",
  ...results.map((r) => `| \`${r.file}\` | ${r.done ? "✅" : "⚠️"} | ${r.problems.length > 0 ? `${r.summary} — ${r.problems.join("; ")}` : r.summary} |`),
  ...(deferred.length > 0 ? ["", `_${deferred.length} file(s) beyond the cap were not swept._`] : []),
].join("\n");
await artifact.markdown("summary", markdown, {
  title: `Sweep: ${globPattern}`,
  description: `${okCount}/${results.length} file(s) completed cleanly.`,
  primary: true,
});

return {
  conclusion: `${okCount}/${results.length} file(s) swept cleanly${failed.length > 0 ? `; ${failed.length} with problems (see findings)` : ""}.`,
  findings: failed.map((r) => ({
    where: r.file,
    what: r.problems.length > 0 ? r.problems.join("; ") : r.summary,
    evidence: r.file,
    status: "unconfirmed" as const,
    severity: "low" as const,
  })),
  verified: [`${results.length} file(s) each handled by an independent agent`, `files: ${inScope.join(", ")}`],
  notCovered: [
    ...(deferred.length > 0 ? [`${deferred.length} file(s) beyond the cap not swept: ${deferred.slice(0, 5).join(", ")}${deferred.length > 5 ? " …" : ""}`] : []),
  ],
};