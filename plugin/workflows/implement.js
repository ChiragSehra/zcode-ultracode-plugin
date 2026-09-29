// Claude Code dialect of the ultracode `implement` pattern — see docs/cc-adapter.md.
// The gate problem (no in-script shell) is answered by the dual-runner agreement gate:
// two independent runners execute the same command, and the script branches only on
// their agreement; disagreement is treated as failing and labelled. Gates remain
// agent-executed, not script-verified — repo CI is the deterministic verifier of record.

export const meta = {
  name: "implement",
  description:
    "Implement with verification: plan task packets, a fresh reviewer checks the plan, packets execute in parallel, dual-runner gates drive a capped repair loop, an independent reviewer per changed file.",
  whenToUse: "A change substantial enough to deserve plan, parallel execution, gated checks, and independent review.",
  phases: [
    { title: "Plan the change as independent packets" },
    { title: "Review the plan with fresh eyes" },
    { title: "Implement the packets in parallel" },
    { title: "Run the gates and repair what fails" },
    { title: "Review each changed file and fix what reviewers catch" },
    { title: "Write the implementation report" },
  ],
};

const PLAN_SCHEMA = {
  type: "object",
  required: ["packets"],
  properties: {
    packets: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "title", "instructions"],
        properties: {
          id: { type: "string", description: "Short stable id: p1, p2, ..." },
          title: { type: "string" },
          files: { type: "array", items: { type: "string" }, description: "Files this packet is expected to touch." },
          instructions: { type: "string", description: "Self-contained instructions for a fresh implementer." },
        },
      },
    },
    openQuestions: { type: "array", items: { type: "string" } },
  },
};
const REVIEW_SCHEMA = {
  type: "object",
  required: ["approved", "problems"],
  properties: {
    approved: { type: "boolean", description: "True only with evidence you actually read the code. Do not edit any file." },
    problems: { type: "array", items: { type: "string" }, description: "What would break or what is missing." },
  },
};
const PACKET_RESULT_SCHEMA = {
  type: "object",
  required: ["summary", "filesChanged", "notes"],
  properties: {
    summary: { type: "string" },
    filesChanged: { type: "array", items: { type: "string" } },
    notes: { type: "array", items: { type: "string" } },
  },
};
const PROBE_SCHEMA = {
  type: "object",
  required: ["hasTestScript", "testCommand"],
  properties: {
    hasTestScript: { type: "boolean", description: "True when package.json defines a scripts.test entry." },
    testCommand: {
      type: ["string", "null"],
      description: "Exactly one of: npm test | pnpm test | yarn test | bun test — chosen from scripts.test and the lockfile present. null when hasTestScript is false.",
    },
  },
};
const GATE_RESULT_SCHEMA = {
  type: "object",
  required: ["exitCode", "detail"],
  properties: {
    exitCode: { type: "number", description: "The real exit code you observed. Do not round it to pass/fail." },
    detail: {
      type: "string",
      description: "On failure: the actual error lines quoted from the output. On success: one line saying what ran.",
    },
  },
};
const SKEPTIC_SCHEMA = {
  type: "object",
  required: ["sound", "issues"],
  properties: {
    sound: { type: "boolean" },
    issues: {
      type: "array",
      items: {
        type: "object",
        required: ["where", "what"],
        properties: { where: { type: "string", description: "path:line" }, what: { type: "string" } },
      },
    },
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
const task = input !== null && typeof input === "object" && typeof input.task === "string" ? input.task : "";
const sizeRaw =
  input !== null && typeof input === "object" && typeof input.size === "string" ? input.size : "m";
const size = sizeRaw === "s" || sizeRaw === "l" ? sizeRaw : "m";
const userGate =
  input !== null && typeof input === "object" && typeof input.gates === "string" && input.gates.length > 0
    ? input.gates
    : null;
const packetCap = size === "s" ? 3 : size === "l" ? 10 : 6;
const reviewCap = size === "s" ? 4 : size === "l" ? 12 : 6;
const repairRounds = 2;

if (task === "") {
  log('implement: no task provided. Usage: /ultracode:implement {"task": "...", "size": "s|m|l", "gates": "node tests.js"}');
} else {
  // Gate command provenance: user-approved args.gates, or default-discovered from
  // package.json scripts.test by a probe restricted to npm|pnpm|yarn|bun test.
  let gateCommand = userGate;
  if (gateCommand === null) {
    const probe = await agent(
      "Read package.json in the current directory. Report whether scripts.test exists, and the single test command to run, chosen as: pnpm test if pnpm-lock.yaml exists, yarn test if yarn.lock exists, bun test if bun.lockb exists, otherwise npm test. If scripts.test does not exist, return hasTestScript false and testCommand null. Do not edit anything.",
      { label: "gate-probe", schema: PROBE_SCHEMA },
    );
    if (probe !== null && probe.hasTestScript === true && typeof probe.testCommand === "string") {
      gateCommand = /^(npm|pnpm|yarn|bun) test$/.test(probe.testCommand) ? probe.testCommand : "npm test";
    }
  }

  const RUNNER_PERSONA =
    "You run exactly one command with your shell tool and report what actually happened. You never fix anything, never edit files, never retry differently — you observe and report the real exit code. If the command cannot run at all, report the actual observed failure and its exit code. ";

  async function dualRunnerGate(roundTag) {
    const ask =
      RUNNER_PERSONA + `Run exactly this command and report its real exit code: ${gateCommand}`;
    const pair = await parallel([
      agent(ask, { label: `gate-${roundTag}-a`, schema: GATE_RESULT_SCHEMA }),
      agent(ask, { label: `gate-${roundTag}-b`, schema: GATE_RESULT_SCHEMA }),
    ]);
    const [a, b] = pair;
    if (a === null || b === null) return { status: "unknown", detail: "a runner agent failed" };
    if (a.exitCode === 0 && b.exitCode === 0) return { status: "pass", detail: a.detail };
    if (a.exitCode !== 0 && b.exitCode !== 0) {
      const detail = a.detail.length >= 20 ? a.detail : b.detail;
      return detail.length >= 20
        ? { status: "fail", detail }
        : { status: "unknown", detail: "runners reported failure without quotable detail" };
    }
    return { status: "unknown", detail: `runners disagreed (${a.exitCode} vs ${b.exitCode})` };
  }

  phase("Plan the change as independent packets");
  const plannerPersona =
    "You break implementation tasks into independently executable packets with self-contained instructions. Surface genuine ambiguity by saying so in openQuestions, not by guessing. ";
  let plan = await agent(
    plannerPersona + `Plan this task as implementation packets that a fresh engineer could each execute independently. Read the repository first; fit its conventions. Keep packets cohesive and few.\n\nTask: ${task}`,
    { label: "planner", schema: PLAN_SCHEMA },
  );
  let packets = (plan !== null ? plan.packets : []).slice(0, packetCap);
  if (packets.length === 0) {
    log("implement: the planner produced no executable packets; refine the task and re-run.");
  } else {
    phase("Review the plan with fresh eyes");
    const planReview = await agent(
      "You review implementation plans adversarially. Read the files the plan touches and judge it: what would break, what is missing, what is wrong about the file list. Approve only with evidence you actually read the code. Do not edit any file.\n\n" +
        `Task: ${task}\nPlan: ${JSON.stringify(packets)}`,
      { label: "plan-reviewer", schema: REVIEW_SCHEMA },
    );
    if (planReview !== null && planReview.approved !== true && planReview.problems.length > 0) {
      plan = await agent(
        plannerPersona + `A fresh reviewer found problems with the packet plan. Revise the packets accordingly.\n\nProblems: ${JSON.stringify(planReview.problems)}\nCurrent packets: ${JSON.stringify(packets)}`,
        { label: "planner-revision", schema: PLAN_SCHEMA },
      );
      packets = (plan !== null ? plan.packets : []).slice(0, packetCap);
    }
    log(`Executing ${packets.length} packet(s)`);

    phase("Implement the packets in parallel");
    const packetResults = await parallel(
      packets.map((p) =>
        agent(
          `Implement this packet fully — write the code, following the repository's conventions.\n\nPacket ${p.id}: ${p.title}\nInstructions: ${p.instructions}\nExpected files: ${p.files && p.files.length > 0 ? p.files.join(", ") : "(planner named none; choose sensibly)"}`,
          { label: `implementer-${p.id}`, schema: PACKET_RESULT_SCHEMA },
        ),
      ),
    );
    const done = packetResults.map((r, i) => ({ packet: packets[i], r })).filter((x) => x.r !== null);
    const failedPackets = packetResults.filter((r) => r === null).length;
    for (const x of done) {
      log(`packet ${x.packet.id}: ${x.r.summary}`);
    }

    let gateLog = [];
    let gateOutcomes = [];
    if (gateCommand !== null) {
      phase("Run the gates and repair what fails");
      gateOutcomes = [await dualRunnerGate("initial")];
      gateLog.push(`initial: ${gateOutcomes[0].status}`);
      let repairs = 0;
      const REPAIR_PERSONA =
        "You fix failing checks given concrete error output: change the least that fixes the real cause. If a check is impossible to pass, say so in your summary rather than working around it. ";
      while (gateOutcomes[gateOutcomes.length - 1].status !== "pass" && repairs < repairRounds) {
        repairs += 1;
        await agent(
          REPAIR_PERSONA + `This check fails:\n\n${gateCommand}\n${gateOutcomes[gateOutcomes.length - 1].detail}\n\nFix the real cause with the smallest change.`,
          { label: `repairer-${repairs}`, schema: PACKET_RESULT_SCHEMA },
        );
        const next = await dualRunnerGate(`repair-${repairs}`);
        gateOutcomes.push(next);
        gateLog.push(`repair ${repairs}: ${next.status}`);
      }
    }

    const touched = Array.from(
      new Set(done.flatMap((x) => (Array.isArray(x.r.filesChanged) ? x.r.filesChanged : []))),
    )
      .filter((f) => typeof f === "string" && f.length > 0)
      .slice(0, reviewCap);

    let verdicts = [];
    if (touched.length > 0) {
      phase("Review each changed file and fix what reviewers catch");
      verdicts = await parallel(
        touched.map((f) =>
          agent(
            "You review changed files for real problems introduced by the change — bugs, broken edge cases, security holes, tests that repeat the implementation. Read the file and the change around it; cite path:line evidence. Do not edit any file.\n\n" +
              `File: ${f}\nTask for context: ${task}`,
            { label: `reviewer-${f}`, schema: SKEPTIC_SCHEMA },
          ),
        ),
      );
      const flagged = verdicts
        .map((v, i) => ({ file: touched[i], v }))
        .filter((x) => x.v !== null && x.v.sound !== true && x.v.issues.length > 0)
        .slice(0, 2);
      for (const x of flagged) {
        await agent(
          `A reviewer caught problems in a file after implementation. Fix them properly.\n\nFile: ${x.file}\nIssues: ${JSON.stringify(x.v.issues)}\nOriginal task: ${task}`,
          { label: `fixer-${x.file}`, schema: PACKET_RESULT_SCHEMA },
        );
      }
      if (flagged.length > 0 && gateCommand !== null) {
        const finalGate = await dualRunnerGate("post-fix");
        gateOutcomes.push(finalGate);
        gateLog.push(`post-fix: ${finalGate.status}`);
      }
    }

    phase("Write the implementation report");
    const finalGate = gateOutcomes.length > 0 ? gateOutcomes[gateOutcomes.length - 1] : null;
    const gateSection =
      gateCommand === null
        ? "_No gate command available (no scripts.test found and none given). The change is unverified by any gate — repo CI is the deterministic verifier of record._"
        : `Gate \`${gateCommand}\`: **${finalGate !== null ? finalGate.status : "not run"}** (${gateLog.join(", ")}) — _agent-executed, dual-runner-agreed; not script-verified. Push CI remains the deterministic verifier of record._`;
    const report = [
      `# Implementation: ${task}`,
      "",
      `${done.length}/${packets.length} packet(s) executed${failedPackets > 0 ? `; ${failedPackets} failed` : ""}.`,
      "",
      "## Packets",
      "",
      ...done.map((x) => `- **${x.packet.id}** — ${x.r.summary}`),
      ...(failedPackets > 0 ? [`- ⚠️ ${failedPackets} packet agent(s) failed`] : []),
      "",
      "## Gates",
      "",
      gateSection,
      "",
      "## File reviews",
      "",
      ...(touched.length > 0
        ? verdicts.map((v, i) =>
            v === null
              ? `- ⚠️ \`${touched[i]}\` reviewer failed`
              : `- ${v.sound ? "✅" : "❌"} \`${touched[i]}\`${v.issues.length > 0 ? ` — ${v.issues.map((s) => s.what).join("; ")}` : ""}`,
          )
        : ["_No changed files reported by implementers._"]),
      ...(touched.length > 0 ? ["", `**Files touched (${touched.length}):** ${touched.map((f) => `\`${f}\``).join(", ")}`] : []),
      ...(plan !== null && Array.isArray(plan.openQuestions) && plan.openQuestions.length > 0
        ? ["", "## Open questions from planning", "", ...plan.openQuestions.map((q) => `- ${q}`)]
        : []),
      "",
      "_Ported pattern (Claude Code): gates are dual-runner-agreed agent executions, not script-verified exit codes; there is no salvage journal. See docs/cc-adapter.md._",
    ].join("\n");
    const written = await agent(
      "Write the following report verbatim to ultracode-implementation-report.md in the current directory, then return the path. Do not modify the content and do not create any other file.\n\n" +
        report,
      { label: "report-writer", schema: PATH_SCHEMA },
    );
    log(written !== null ? `Implementation report written to ${written.path}` : "report writer failed");
    log(
      `implement: ${done.length}/${packets.length} packets${gateCommand !== null ? `, gate ${finalGate !== null ? finalGate.status : "not run"}` : ", no gate"}`,
    );
  }
}
