// Claude Code dialect of the ultracode `converge` pattern — see docs/cc-adapter.md.
// No deterministic gates exist in this pattern (verification is checker + fresh-verifier
// agents), so it ports cleanly. CC has no actor persistence: each round's worker gets
// the accumulated history in its prompt instead of a shared context.

export const meta = {
  name: "converge",
  description:
    "Converge on a goal: typed stop-conditions defined up front, a worker and strict checker iterate with feedback carried forward, then a fresh verifier who saw no rounds judges the result.",
  whenToUse: "Iterate something until it is genuinely done against explicit criteria — a draft, a benchmark, a checklist.",
  phases: [
    { title: "Define what done means" },
    { title: "Iterate until the conditions pass" },
    { title: "Final check by someone who saw no rounds" },
  ],
};

const PLAN_SCHEMA = {
  type: "object",
  required: ["conditions", "artifactPath"],
  properties: {
    conditions: {
      type: "array",
      items: { type: "string" },
      description: "3-6 checkable conditions that must ALL pass for done.",
    },
    artifactPath: {
      type: ["string", "null"],
      description: "Workspace-relative path of the deliverable, or null if the goal produces no single file.",
    },
  },
};
const CHECK_SCHEMA = {
  type: "object",
  required: ["verdicts"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        required: ["pass", "gap"],
        properties: {
          pass: { type: "boolean", description: "True only with evidence you actually checked; absence of comment is not a pass." },
          gap: { type: "string", description: "What is missing when not passing; empty when passing." },
        },
      },
    },
  },
};
const OUTCOME_SCHEMA = {
  type: "object",
  required: ["change"],
  properties: {
    change: { type: "string", description: "What this round changed, one sentence." },
    path: { type: ["string", "null"], description: "Deliverable path after this round, or null." },
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
const goal = input !== null && typeof input === "object" && typeof input.goal === "string" ? input.goal : "";
const maxRoundsRaw =
  input !== null && typeof input === "object" && typeof input.maxRounds === "number" ? input.maxRounds : 3;
const maxRounds = Math.max(1, Math.min(6, Math.floor(maxRoundsRaw)));

if (goal === "") {
  log('converge: no goal provided. Usage: /ultracode:converge {"goal": "...", "maxRounds": 3}');
} else {
  phase("Define what done means");
  const plan = await agent(
    "You turn goals into explicit, checkable done-conditions — conditions a human could verify one by one. If the goal is too vague to check, say so in the conditions rather than guessing.\n\n" +
      `The user wants to converge on this goal:\n\n${goal}\n\nWrite 3-6 checkable conditions that must ALL pass for "done", and name the workspace-relative path where the deliverable lives (or null if the goal produces no single file).`,
    { label: "goal-planner", schema: PLAN_SCHEMA },
  );
  const conditions = (plan !== null ? plan.conditions : []).slice(0, 6);
  const artifactPath = plan !== null ? plan.artifactPath : null;
  const conditionList = conditions.map((c, i) => `${i + 1}. ${c.check ?? c}`).join("\n");

  if (conditions.length === 0) {
    log("converge: no checkable conditions could be defined; restate the goal.");
  } else {
    const WORKER_PERSONA =
      "You iterate a deliverable toward explicit conditions. Change what the feedback names, not everything. If a condition is impossible to satisfy, say so in your change summary rather than faking it. ";
    const CHECKER_PERSONA =
      "You judge each condition strictly against the deliverable on disk. Passing requires evidence you actually checked; absence of comment is not a pass. Do not edit any file. ";

    phase("Iterate until the conditions pass");
    let history = "(first round — no history yet)";
    let feedback = "(first round — no checker feedback yet)";
    let lastPath = artifactPath;
    let passing = 0;
    let convergedInRound = 0;

    for (let round = 1; round <= maxRounds; round += 1) {
      const outcome = await agent(
        WORKER_PERSONA +
          `Goal:\n${goal}\n\nConditions for done:\n${conditionList}\n\nProduce or revise the deliverable so the conditions pass. Deliverable path: ${artifactPath ?? "(your choice — name it in the result)"}.\n\nRound history: ${history}\nChecker gaps to close: ${feedback}`,
        { label: `worker-round-${round}`, schema: OUTCOME_SCHEMA },
      );
      const change = outcome !== null ? outcome.change : "(worker failed this round)";
      if (outcome !== null && typeof outcome.path === "string" && outcome.path.length > 0) {
        lastPath = outcome.path;
      }
      const check = await agent(
        CHECKER_PERSONA +
          `Judge each condition against the deliverable now on disk. Deliverable path: ${lastPath ?? "(inspect the workspace)"}.\n\nConditions:\n${conditionList}`,
        { label: `checker-round-${round}`, schema: CHECK_SCHEMA },
      );
      const verdicts = check !== null ? check.verdicts : [];
      passing = verdicts.filter((v) => v.pass).length;
      feedback =
        verdicts.filter((v) => !v.pass).map((v) => v.gap).join("; ") || "(none — all conditions passing)";
      history = `${history}; round ${round}: ${change}`;
      log(`Round ${round}/${maxRounds}: ${passing}/${conditions.length} conditions pass`);
      if (passing === conditions.length) {
        convergedInRound = round;
        break;
      }
    }

    phase("Final check by someone who saw no rounds");
    const finalCheck = await agent(
      CHECKER_PERSONA +
        `You have seen nothing of how this was made — judge only what is there.\n\nDeliverable path: ${lastPath ?? "(inspect the workspace)"}\n\nConditions:\n${conditionList}`,
      { label: "fresh-verifier", schema: CHECK_SCHEMA },
    );
    const finalVerdicts = finalCheck !== null ? finalCheck.verdicts : [];
    const finalPassing = finalVerdicts.filter((v) => v.pass).length;
    const converged = finalPassing === conditions.length;
    log(
      converged
        ? `Converged: all ${conditions.length} conditions verified by a fresh reviewer${convergedInRound > 0 ? ` (iteration converged in round ${convergedInRound})` : ""}. Conditions: ${conditions.join("; ")}`
        : `Not converged after ${maxRounds} round(s): ${finalPassing}/${conditions.length} conditions pass on final independent check. Best-so-far is on disk${lastPath !== null ? ` at ${lastPath}` : ""}; re-run with a higher maxRounds or a sharper goal to continue. Remaining gaps: ${finalVerdicts.filter((v) => !v.pass).map((v) => v.gap).join("; ")}`,
    );
  }
}
