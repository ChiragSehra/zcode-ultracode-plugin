// Claude Code dialect of the ultracode `sweep` pattern — see docs/cc-adapter.md.
// The runtime has no in-script file reads, so an inventory agent replaces files.glob;
// failed workers resolve to null and are counted, never silently dropped.

export const meta = {
  name: "sweep",
  description:
    "Sweep a file set: one fresh agent per matched file doing the same mechanical task, typed per-file results, failures counted and listed.",
  whenToUse: "The same mechanical change or check across many files, e.g. add headers, migrate APIs, verify references.",
  phases: [
    { title: "List the files in scope" },
    { title: "Work through each file independently" },
  ],
};

const INVENTORY_SCHEMA = {
  type: "object",
  required: ["files"],
  properties: {
    files: { type: "array", items: { type: "string" }, description: "Workspace-relative paths matching the glob." },
  },
};
const RESULT_SCHEMA = {
  type: "object",
  required: ["done", "summary", "problems"],
  properties: {
    done: { type: "boolean", description: "True when the task was completed for this file." },
    summary: { type: "string", description: "One sentence: what was done." },
    problems: { type: "array", items: { type: "string" }, description: "Problems hit; empty on success." },
  },
};

let input = args;
if (typeof input === "string") {
  try {
    input = JSON.parse(input);
  } catch {
    input = {};
  }
}
const globPattern =
  input !== null && typeof input === "object" && typeof input.glob === "string" ? input.glob : "";
const task = input !== null && typeof input === "object" && typeof input.task === "string" ? input.task : "";

if (globPattern === "" || task === "") {
  log('sweep: both glob and task are required. Usage: /ultracode:sweep {"glob": "src/**/*.ts", "task": "..."}');
} else {
  phase("List the files in scope");
  const inventory = await agent(
    `List the files matching this glob pattern, as workspace-relative paths sorted lexicographically. Use your file-listing tools; do not edit anything.\n\nGlob: ${globPattern}`,
    { label: "inventory", schema: INVENTORY_SCHEMA },
  );
  const paths = (inventory !== null ? inventory.files : []).slice(0, 30);
  const deferred = inventory !== null ? Math.max(0, inventory.files.length - 30) : 0;

  if (paths.length === 0) {
    log(`sweep: no files matched "${globPattern}"`);
  } else {
    log(`Sweeping ${paths.length} file(s)${deferred > 0 ? `; ${deferred} beyond the 30-file cap deferred` : ""}`);

    phase("Work through each file independently");
    const results = await parallel(
      paths.map((p) =>
        agent(
          `${task}\n\nFile: ${p}\n\nDo the task in this file only. If it genuinely does not apply, return done=false with the reason in problems rather than forcing it. If the task is impossible or your instructions conflict, say so in problems rather than faking completion.`,
          { label: `worker-${p}`, schema: RESULT_SCHEMA },
        ),
      ),
    );
    const okCount = results.filter((r) => r !== null && r.done && r.problems.length === 0).length;
    const failed = results
      .map((r, i) => ({ file: paths[i], r }))
      .filter((x) => x.r === null || !x.r.done || x.r.problems.length > 0);
    for (const x of failed) {
      log(
        `⚠️ ${x.file}: ${x.r === null ? "agent failed" : `${x.r.summary} — ${x.r.problems.join("; ")}`}`,
      );
    }
    log(`Sweep complete: ${okCount}/${results.length} file(s) clean, ${failed.length} with problems${deferred > 0 ? `, ${deferred} deferred beyond the cap` : ""}`);
  }
}
