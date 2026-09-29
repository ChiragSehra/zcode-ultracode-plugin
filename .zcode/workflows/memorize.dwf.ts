/* zcode-workflow
description: "Turn an observation with evidence into confirmed project memory:
  distill ≤3 candidate lessons, independently confirm each against its cited
  evidence, then a single writer merges confirmed lessons into
  .ultracode/memory.md (append-or-merge only, 30-line index cap). Runs on
  GLM-5.3-Flash$high."
whenToUse: Use when the user asks to memorize a lesson from a completed run with
  evidence (/uc:memorize), or when a run report contradicts an existing memory
  entry and memory should be updated. Not for standing instructions — those
  belong in AGENTS.md.
args:
  evidence:
    type: string
    description: "Receipts supporting the observation: run ids, file paths, doc
      anchors. Required — no evidence, no lesson."
    required: true
  input:
    type: string
    description: The observation or run outcome to potentially learn from.
    required: true
*/
const observation = String(args.input);
const evidence = String(args.evidence);
const lessonCap = 3;

interface CandidateLesson {
  /** One sentence of advisory guidance, not an instruction with authority. */
  lesson: string;
  /** The specific part of the cited evidence that shows it. */
  evidence: string;
}
interface Distilled {
  /** 1-3 candidate lessons, each bound to specific evidence. */
  lessons: CandidateLesson[];
}
interface Confirmation {
  /** True only if you checked the cited evidence yourself and it supports the lesson. */
  confirmed: boolean;
  /** How you checked, or why the evidence does not support it. */
  note: string;
}
interface WriteResult {
  /** Path of the memory file written. */
  path: string;
  /** New lessons appended. */
  written: number;
  /** Existing entries merged into (recurrence bumped). */
  merged: number;
  /** Lessons refused (index cap, unconfirmed, or not matching policy). */
  refused: string[];
}

phase("Distill candidate lessons from the observation");
const distilled = await agent("distiller", {
  system:
    "You distill run observations into lessons, conservatively: a lesson must be bound to specific cited evidence, be advisory (never an instruction claiming authority), and generalize no further than the evidence. If the observation teaches nothing durable, return an empty list — that is a fine answer.",
}).ask<Distilled>(
  `Observation to learn from:\n${observation}\n\nCited evidence (receipts):\n${evidence}\n\nDistill at most ${lessonCap} candidate lessons. Each must cite the specific part of the evidence that shows it. Refuse to generalize beyond what the evidence supports.`,
);
const candidates = (distilled !== null ? distilled.lessons : []).slice(0, lessonCap);
if (candidates.length === 0) {
  return {
    conclusion: "Nothing durable to memorize — the distiller returned no lessons bound to evidence.",
    findings: [],
    verified: [],
    notCovered: ["no candidate lessons; observation not memorized"],
  };
}
log(`Distilled ${candidates.length} candidate lesson(s)`);

phase("Confirm each lesson against its own evidence");
const confirmations = await Promise.all(
  candidates.map((c, i) =>
    agent(`confirmer-lesson-${i}`).ask<Confirmation>(
      `Independently check this lesson against the cited evidence: read the files or logs named, verify the lesson is what they show, and that it does not generalize further than they support. Do not edit any file.\n\nLesson: ${c.lesson}\nEvidence: ${c.evidence}\nFull evidence context: ${evidence}`,
    ),
  ),
);
const confirmed = candidates.filter((c, i) => confirmations[i] !== undefined && confirmations[i].confirmed);
for (let i = 0; i < candidates.length; i += 1) {
  const conf = confirmations[i];
  report({ lesson: candidates[i].lesson, confirmed: conf !== undefined && conf.confirmed, note: conf?.note ?? "confirmer failed" });
}
if (confirmed.length === 0) {
  return {
    conclusion: `All ${candidates.length} candidate lesson(s) failed confirmation against their evidence; nothing was written.`,
    findings: candidates.map((c, i) => ({
      where: "memorize",
      what: `unconfirmed: ${c.lesson}`,
      evidence: confirmations[i]?.note ?? "confirmer failed",
      status: "unconfirmed" as const,
      severity: "low" as const,
    })),
    verified: [],
    notCovered: ["no lessons written"],
  };
}

phase("Merge confirmed lessons into project memory");
const writeResult = await agent("memory-writer", {
  system:
    "You maintain .ultracode/memory.md under strict policy: append-or-merge only; never rewrite or delete entries you cannot match; merge duplicates by bumping their recurrence count and date; keep the '## Index' section at most 30 lines (refuse excess lessons rather than trimming others); every lesson line must carry an Evidence reference. Create the file with the standard header (see docs/memory.md for the format) if it does not exist.",
}).ask<WriteResult>(
  `Merge these confirmed lessons into .ultracode/memory.md per policy (format reference: docs/memory.md; read it if unsure):\n\n${confirmed
    .map((c) => `- Lesson: ${c.lesson}\n  Evidence: ${c.evidence}`)
    .join("\n")}\n\nToday's date: 2026-09-29. Return counts of what you did and any refusals with reasons.`,
);
let published = false;
try {
  await artifact.file("memory", ".ultracode/memory.md", {
    title: "Project memory after this memorize pass",
    description: `${writeResult?.written ?? 0} written, ${writeResult?.merged ?? 0} merged, ${(writeResult?.refused ?? []).length} refused.`,
  });
  published = true;
} catch {
  published = false;
}

return {
  conclusion: writeResult !== null
    ? `Memory updated: ${writeResult.written} written, ${writeResult.merged} merged, ${writeResult.refused.length} refused (${writeResult.path}).`
    : "The memory writer failed; confirmed lessons were not written — re-run memorize with the same input.",
  findings: (writeResult?.refused ?? []).map((r) => ({
    where: ".ultracode/memory.md",
    what: `refused: ${r}`,
    evidence: "writer policy (index cap / append-only)",
    status: "unconfirmed" as const,
    severity: "low" as const,
  })),
  verified: [
    ...confirmed.map((c) => `confirmed against evidence: ${c.lesson}`),
    ...(writeResult !== null ? [`${writeResult.written} written, ${writeResult.merged} merged into ${writeResult.path}`] : []),
  ],
  notCovered: [
    ...(writeResult === null ? ["memory writer agent failed"] : []),
    ...(published ? [] : ["memory file could not be published as an artifact"]),
  ],
};