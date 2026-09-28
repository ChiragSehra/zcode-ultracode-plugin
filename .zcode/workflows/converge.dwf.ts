/* zcode-workflow
description: "Converge on a goal: typed stop-conditions defined up front, a
  persistent worker and strict checker iterate (capped rounds, checker gaps
  carried into the next worker round), then a fresh verifier who saw no rounds
  judges the result. Progress chart while it runs; deliverable artifact. Runs on
  GLM-5.3-Flash."
whenToUse: Use when the user asks to iterate something until it's genuinely done
  against explicit criteria (/uc:converge or /ultracode routed to converge) — a
  polished draft, a passing benchmark, a checklist. For implement-with-tests,
  prefer implement.
args:
  goal:
    type: string
    description: The goal, including what "done" means if you can say it.
    required: true
  maxRounds:
    type: number
    description: Cap on iteration rounds (default 3, max 6); on exhaustion the run
      reports best-so-far and what remains.
    default: 3
*/
const goal = String(args.goal);
const maxRoundsRaw = typeof args.maxRounds === "number" ? args.maxRounds : 3;
const maxRounds = Math.max(1, Math.min(6, Math.floor(maxRoundsRaw)));

interface Condition {
  /** One checkable statement of done; all must pass. */
  check: string;
}
interface ConditionPlan {
  /** 3-6 checkable conditions that together mean "done". */
  conditions: Condition[];
  /** Workspace-relative path where the deliverable lives, or null if none. */
  artifactPath: string | null;
}
interface ConditionVerdict {
  /** True when this condition currently passes. */
  pass: boolean;
  /** What is missing when not passing; empty when passing. */
  gap: string;
}
interface CheckResult {
  /** One verdict per condition, in order. */
  verdicts: ConditionVerdict[];
}
interface DraftOutcome {
  /** What this round changed. */
  change: string;
  /** Workspace-relative path of the deliverable after this round, or null. */
  path: string | null;
}

artifact.chart("progress", {
  title: "Conditions passing by round",
  x: { field: "round", label: "Round" },
  y: { field: "passed", label: "Conditions passing" },
});

phase("Define what done means");
const planner = agent("goal-planner", {
  system: "You turn goals into explicit, checkable done-conditions. Conditions a human could verify one by one; escalate if the goal is too vague to check.",
});
const plan = await planner.ask<ConditionPlan>(
  `The user wants to converge on this goal:\n\n${goal}\n\nWrite 3-6 checkable conditions that must ALL pass for "done", and name the workspace-relative path where the deliverable lives (or null if the goal produces no single file).`,
);
const conditions = plan.conditions.slice(0, 6);
if (conditions.length === 0) {
  return {
    conclusion: "No checkable conditions could be defined, so there was nothing to converge toward.",
    findings: [],
    verified: [],
    notCovered: ["goal could not be turned into conditions; restate the goal"],
  };
}
const conditionList = conditions.map((c, i) => `${i + 1}. ${c.check}`).join("\n");

const worker = agent("worker", {
  system:
    "You iterate a deliverable toward explicit conditions. Change what the feedback names, not everything. " +
    "If a condition is impossible to satisfy, escalate and say so plainly rather than faking it.",
});
const checker = agent("checker", {
  system:
    "You judge each condition strictly against the deliverable on disk. Passing requires evidence you actually checked; absence of comment is not a pass.",
});

phase("Iterate until the conditions pass");
let outcome: DraftOutcome = { change: "no draft yet", path: plan.artifactPath };
let passing = 0;
let feedback = "(first round — no checker feedback yet)";
for (let round = 1; round <= maxRounds; round++) {
  outcome = await worker.ask<DraftOutcome>(
    `Goal:\n${goal}\n\nConditions for done:\n${conditionList}\n\nProduce or revise the deliverable so the conditions pass. Deliverable path: ${plan.artifactPath ?? "(your choice — name it in the result)"}. Previous round: ${outcome.change}\nChecker gaps to close: ${feedback}`,
  );
  const check = await checker.ask<CheckResult>(
    `Judge each condition against the deliverable now on disk. Deliverable path: ${outcome.path ?? "(inspect the workspace)"}.\n\nConditions:\n${conditionList}`,
  );
  passing = check.verdicts.filter((v) => v.pass).length;
  feedback = check.verdicts.filter((v) => !v.pass).map((v) => v.gap).join("; ") || "(none — all conditions passing)";
  report({ round, passed: passing, total: conditions.length }, "progress");
  log(`Round ${round}/${maxRounds}: ${passing}/${conditions.length} conditions pass`);
  if (passing === conditions.length) {
    break;
  }
}

phase("Final check by someone who saw no rounds");
const finalCheck = await agent("fresh-verifier").ask<CheckResult>(
  `Judge each condition against the deliverable now on disk. You have seen nothing of how it was made — judge only what is there.\n\nDeliverable path: ${outcome.path ?? "(inspect the workspace)"}\n\nConditions:\n${conditionList}`,
);
const finalPassing = finalCheck.verdicts.filter((v) => v.pass).length;
const converged = finalPassing === conditions.length;
const remainingGaps = finalCheck.verdicts.filter((v) => !v.pass).map((v) => v.gap);

let deliverablePublished = false;
if (outcome.path !== null && outcome.path.length > 0) {
  try {
    await artifact.file("deliverable", outcome.path, {
      title: "Converged deliverable",
      description: converged ? "All conditions verified by a fresh reviewer." : `Best-so-far after ${maxRounds} round(s); ${remainingGaps.length} condition(s) still open.`,
      primary: true,
    });
    deliverablePublished = true;
  } catch {
    deliverablePublished = false;
  }
}

return {
  conclusion: converged
    ? `Converged: all ${conditions.length} conditions verified by a fresh reviewer after ${maxRounds}-cap rounds.`
    : `Not converged after ${maxRounds} round(s): ${finalPassing}/${conditions.length} conditions pass on final check. Best-so-far is reported; amend the run (raise maxRounds or sharpen the goal) to continue.`,
  findings: remainingGaps.map((g) => ({
    where: outcome.path ?? "goal",
    what: g,
    evidence: "fresh verifier final check",
    status: "unconfirmed" as const,
    severity: "medium" as const,
  })),
  verified: converged
    ? [`all ${conditions.length} conditions independently verified by a reviewer who saw no iteration rounds`]
    : [`${finalPassing}/${conditions.length} conditions verified on final independent check`],
  notCovered: [
    ...remainingGaps,
    ...(deliverablePublished ? [] : ["deliverable file could not be published (missing or no path)"]),
  ],
};