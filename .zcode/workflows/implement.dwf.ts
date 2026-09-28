/* zcode-workflow
description: "Implement with verification: planner emits typed task packets, a
  fresh reviewer checks the plan, packets execute in parallel, deterministic
  build/test gates (world.run) drive a capped repair loop, then an independent
  reviewer per changed file with one capped fix round. Diff-summary artifact.
  Default run model: GLM-5.3-Flash."
whenToUse: Use when the user asks to implement or change something substantial
  enough to deserve plan → parallel execution → build/test gates → independent
  review (/uc:implement or /ultracode routed to implement). For a one-line fix
  or a single-file tweak, do it directly; for pure research, use research.
args:
  gates:
    type: json
    description: 'Optional gate override: {"kind": "npm|make|cargo|pytest|node",
      "args": ["file.js"]} — the check command the run gates on (node takes the
      test entry file(s) in args).'
  size:
    type: string
    description: "s: ≤3 packets, ≤4 file reviewers; m (default): ≤6 packets, ≤6
      reviewers; l: ≤10 packets, ≤30 reviewers. Fix round capped at 4 fixers."
    default: m
  task:
    type: string
    description: What to build or change, in the user's words.
    required: true
*/
const task = String(args.task);
const sizeRaw = String(args.size ?? "m");
const size = sizeRaw === "s" || sizeRaw === "l" ? sizeRaw : "m";
const packetCap = size === "s" ? 3 : size === "l" ? 10 : 6;
const reviewCap = size === "s" ? 4 : size === "l" ? 30 : 6;
const repairRounds = 2;

interface Packet {
  /** Short stable id: p1, p2, ... */
  id: string;
  /** What this packet accomplishes, one sentence. */
  title: string;
  /** Files this packet is expected to touch. */
  files: string[];
  /** Self-contained instructions for a fresh implementer. */
  instructions: string;
}
interface Plan {
  /** Implementation packets, independently executable where possible. */
  packets: Packet[];
  /** Ambiguities the planner could not resolve; the script records them, unhidden. */
  openQuestions: string[];
}
interface PlanReview {
  /** True when the plan is sound as written. */
  approved: boolean;
  /** What would break or what is missing; empty when approved. */
  problems: string[];
}
interface PacketResult {
  /** What was implemented. */
  summary: string;
  /** Files created or changed. */
  filesChanged: string[];
  /** Follow-up worth knowing. */
  notes: string[];
}
interface SkepticVerdict {
  /** True when the file's change is sound. */
  sound: boolean;
  /** Problems found, with path:line evidence. */
  issues: { where: string; what: string }[];
}
type GateKind = "npm" | "make" | "cargo" | "pytest" | "node" | "gitcheck";
interface GateSpec {
  kind: GateKind;
  argv: string[];
  label: string;
}

const gateCfg = (args.gates ?? null) as { kind?: unknown; args?: unknown } | null;
const gateKind = gateCfg !== null && typeof gateCfg.kind === "string" ? gateCfg.kind : null;
const rawGateArgs = gateCfg !== null && Array.isArray(gateCfg.args) ? gateCfg.args : [];
const gateArgv = rawGateArgs.map((a) => String(a));

function gateFor(kind: string, argv: string[]): GateSpec | null {
  if (kind === "npm") return { kind: "npm", argv: [], label: "npm test" };
  if (kind === "make") return { kind: "make", argv: [], label: "make test" };
  if (kind === "cargo") return { kind: "cargo", argv: [], label: "cargo test" };
  if (kind === "pytest") return { kind: "pytest", argv: [], label: "pytest" };
  if (kind === "node") return { kind: "node", argv, label: "node test" };
  return null;
}

let gates: GateSpec[] = [];
const chosen = gateKind !== null ? gateFor(gateKind, gateArgv) : null;
if (chosen !== null) {
  gates = [chosen];
} else {
  let pkg: unknown = null;
  try {
    pkg = JSON.parse(await files.read("package.json"));
  } catch {
    pkg = null;
  }
  const scripts = (pkg as { scripts?: Record<string, unknown> } | null)?.scripts;
  if (scripts !== undefined && typeof scripts.test === "string") {
    gates.push({ kind: "npm", argv: [], label: "npm test" });
  }
  if ((await files.glob("Makefile")).length > 0) {
    gates.push({ kind: "make", argv: [], label: "make test" });
  }
  if ((await files.glob("Cargo.toml")).length > 0) {
    gates.push({ kind: "cargo", argv: [], label: "cargo test" });
  }
  if (gates.length === 0) {
    let inGitRepo = true;
    try {
      await git.status();
    } catch {
      inGitRepo = false;
    }
    if (inGitRepo) {
      gates.push({ kind: "gitcheck", argv: [], label: "git diff --check" });
    }
  }
}

async function runGate(g: GateSpec): Promise<{ label: string; ok: boolean; output: string }> {
  if (g.kind === "npm") {
    const r = await world.run("npm", ["test"], { timeoutMs: 900000 });
    return { label: g.label, ok: r.exitCode === 0, output: `${r.stdout}\n${r.stderr}`.slice(0, 4000) };
  }
  if (g.kind === "make") {
    const r = await world.run("make", ["test"], { timeoutMs: 900000 });
    return { label: g.label, ok: r.exitCode === 0, output: `${r.stdout}\n${r.stderr}`.slice(0, 4000) };
  }
  if (g.kind === "cargo") {
    const r = await world.run("cargo", ["test"], { timeoutMs: 900000 });
    return { label: g.label, ok: r.exitCode === 0, output: `${r.stdout}\n${r.stderr}`.slice(0, 4000) };
  }
  if (g.kind === "pytest") {
    const r = await world.run("python3", ["-m", "pytest"], { timeoutMs: 900000 });
    return { label: g.label, ok: r.exitCode === 0, output: `${r.stdout}\n${r.stderr}`.slice(0, 4000) };
  }
  if (g.kind === "node") {
    const r = await world.run("node", g.argv.length > 0 ? g.argv : ["test.js"], { timeoutMs: 900000 });
    return { label: g.label, ok: r.exitCode === 0, output: `${r.stdout}\n${r.stderr}`.slice(0, 4000) };
  }
  const r = await world.run("git", ["diff", "--check"], { timeoutMs: 60000 });
  return { label: g.label, ok: r.exitCode === 0, output: `${r.stdout}\n${r.stderr}`.slice(0, 4000) };
}

phase("Plan the change as independent packets");
const planner = agent("planner", {
  system:
    "You break implementation tasks into independently executable packets with self-contained instructions. " +
    "Surface genuine ambiguity by escalating, not by guessing. If a check or instruction is impossible, say so plainly.",
});
const plan = await planner.ask<Plan>(
  `Plan this task as implementation packets that a fresh engineer could each execute independently. Read the repository first; fit its conventions. Keep packets cohesive and few.\n\nTask: ${task}`,
);
let packets = plan.packets.slice(0, packetCap);
if (packets.length === 0) {
  return {
    conclusion: "The planner produced no executable packets, so nothing was implemented.",
    findings: [],
    verified: [],
    notCovered: [...plan.openQuestions, "no packets: refine the task and re-run"],
  };
}

phase("Review the plan with fresh eyes");
const planReview = await agent("plan-reviewer").ask<PlanReview>(
  `A planner wrote this implementation plan. Read the files it touches in the repository and judge it: what would break, what is missing, what is wrong about the file list. Approve only with evidence you actually read the code. Do not edit any file.\n\nTask: ${task}\nPlan: ${JSON.stringify(packets)}`,
);
if (!planReview.approved && planReview.problems.length > 0) {
  const revised = await planner.ask<Plan>(
    `A fresh reviewer found problems with the packet plan. Revise the packets accordingly.\n\nProblems: ${JSON.stringify(planReview.problems)}\nCurrent packets: ${JSON.stringify(packets)}`,
  );
  packets = revised.packets.slice(0, packetCap);
}
log(`Executing ${packets.length} packet(s)`);

phase("Implement the packets in parallel");
const packetResults = await Promise.all(
  packets.map(async (p) => {
    try {
      const r = await agent(`implementer-${p.id}`).ask<PacketResult>(
        `Implement this packet fully — write the code, following the repository's conventions.\n\nPacket ${p.id}: ${p.title}\nInstructions: ${p.instructions}\nExpected files: ${p.files.length > 0 ? p.files.join(", ") : "(planner named none; choose sensibly)"}`,
      );
      report({ packet: p.id, title: p.title, done: true, summary: r.summary });
      return { id: p.id, ok: true, result: r };
    } catch (err) {
      report({ packet: p.id, title: p.title, done: false, summary: String(err) });
      return {
        id: p.id,
        ok: false,
        result: { summary: `packet failed: ${String(err)}`, filesChanged: [], notes: [] } as PacketResult,
      };
    }
  }),
);

let gateOutcomes: { label: string; ok: boolean; output: string }[] = [];
let repairsUsed = 0;
if (gates.length > 0) {
  phase("Check the build and tests, repairing what fails");
  gateOutcomes = await Promise.all(gates.map((g) => runGate(g)));
  const repairer = agent("repairer", {
    system:
      "You fix failing checks given concrete error output: change the least that fixes the real cause. " +
      "If a check is impossible to pass, escalate and say so plainly rather than working around it.",
  });
  while (gateOutcomes.some((o) => !o.ok) && repairsUsed < repairRounds) {
    repairsUsed += 1;
    const failing = gateOutcomes.filter((o) => !o.ok);
    await repairer.ask(
      `These checks fail:\n\n${failing.map((f) => `- ${f.label}:\n${f.output}`).join("\n\n")}\n\nFix the real cause with the smallest change.`,
    );
    gateOutcomes = await Promise.all(gates.map((g) => runGate(g)));
  }
  for (const o of gateOutcomes) {
    report({ gate: o.label, passed: o.ok });
  }
}

let changed: string[] = [];
try {
  changed = await git.changedFiles();
} catch {
  changed = [];
}
const touched = Array.from(new Set([...changed, ...packetResults.flatMap((p) => p.result.filesChanged)])).filter(
  (p) => p.length > 0,
);
const reviewTargets = touched.slice(0, reviewCap);
const reviewDeferred = touched.length - reviewTargets.length;

let verdicts: { file: string; sound: boolean; issues: { where: string; what: string }[] }[] = [];
if (reviewTargets.length > 0) {
  phase("Review each changed file and fix what reviewers catch");
  verdicts = await Promise.all(
    reviewTargets.map(async (f) => {
      const v = await agent(`reviewer-${f}`).ask<SkepticVerdict>(
        `Review this changed file for real problems introduced by the change — bugs, broken edge cases, security holes, tests that repeat the implementation. Read the file and the change around it; cite path:line evidence. Do not edit any file.\n\nFile: ${f}\nTask for context: ${task}`,
      );
      report({ file: f, sound: v.sound, issues: v.issues.length });
      return { file: f, ...v };
    }),
  );
  const flagged = verdicts.filter((v) => !v.sound && v.issues.length > 0).slice(0, 4);
  if (flagged.length > 0) {
    await Promise.all(
      flagged.map((v) =>
        agent(`fixer-${v.file}`).ask(
          `A reviewer caught problems in a file after implementation. Fix them properly.\n\nFile: ${v.file}\nIssues: ${JSON.stringify(v.issues)}\nOriginal task: ${task}`,
        ),
      ),
    );
    if (gates.length > 0) {
      gateOutcomes = await Promise.all(gates.map((g) => runGate(g)));
      for (const o of gateOutcomes) {
        report({ gate: o.label, passed: o.ok, after: "fix round" });
      }
    }
  }
}

let diffText = "";
try {
  diffText = (await git.diff()).slice(0, 8000);
} catch {
  diffText = "";
}

const failedPackets = packetResults.filter((p) => !p.ok);
const openIssues = verdicts.filter((v) => !v.sound).flatMap((v) => v.issues.map((i) => `${v.file}: ${i.what}`));
const gatesPassed = gates.length > 0 && gateOutcomes.length > 0 && gateOutcomes.every((o) => o.ok);

const markdown = [
  `# Implementation: ${task}`,
  "",
  `${packets.length} packet(s); ${packetResults.length - failedPackets.length} executed cleanly.`,
  "",
  "## Packets",
  "",
  ...packetResults.map((p) => `- ${p.ok ? "✅" : "⚠️"} **${p.id}** — ${p.result.summary}`),
  ...(gates.length > 0
    ? [
        "",
        "## Gates",
        "",
        ...gateOutcomes.map((o) => `- ${o.ok ? "✅" : "❌"} ${o.label}${repairsUsed > 0 ? ` (after ${repairsUsed} repair round(s))` : ""}`),
      ]
    : ["", "_No repository checks found; work is unverified by gates._"]),
  ...(verdicts.length > 0
    ? [
        "",
        "## File reviews",
        "",
        ...verdicts.map((v) => `- ${v.sound ? "✅" : "❌"} \`${v.file}\`${v.issues.length > 0 ? ` — ${v.issues.map((i) => i.what).join("; ")}` : ""}`),
      ]
    : []),
  ...(touched.length > 0 ? ["", `**Files touched (${touched.length}):** ${touched.map((f) => `\`${f}\``).join(", ")}`] : []),
  ...(diffText.length > 0 ? ["", "## Diff excerpt", "", "```diff", diffText, "```"] : []),
].join("\n");
await artifact.markdown("report", markdown, {
  title: `Implementation: ${task.slice(0, 80)}`,
  description: `${packets.length} packet(s), ${gates.length} gate(s)${gates.length > 0 ? `, ${gateOutcomes.filter((o) => o.ok).length}/${gateOutcomes.length} passing` : ""}, ${verdicts.length} file review(s).`,
  primary: true,
});

return {
  conclusion: `${packetResults.length - failedPackets.length}/${packets.length} packet(s) implemented${gates.length > 0 ? `; gates ${gatesPassed ? "all passing" : `${gateOutcomes.filter((o) => o.ok).length}/${gateOutcomes.length} passing`}` : "; no gates found"}; ${verdicts.filter((v) => v.sound).length}/${verdicts.length} reviewed files sound.`,
  findings: [
    ...failedPackets.map((p) => ({
      where: p.id,
      what: p.result.summary,
      evidence: p.id,
      status: "unconfirmed" as const,
      severity: "high" as const,
    })),
    ...openIssues.map((issue) => ({
      where: issue.split(":")[0] ?? "unknown",
      what: issue,
      evidence: issue,
      status: "unconfirmed" as const,
      severity: "medium" as const,
    })),
  ],
  verified: [
    ...(gates.length > 0 ? gateOutcomes.filter((o) => o.ok).map((o) => `${o.label} passed (exit 0)`) : []),
    ...verdicts.filter((v) => v.sound).map((v) => `independent review of ${v.file} found no problems`),
  ],
  notCovered: [
    ...(gates.length === 0 ? ["no repository check was found to run — the change is unverified by any gate"] : []),
    ...gateOutcomes.filter((o) => !o.ok).map((o) => `gate ${o.label} still failing after ${repairRounds} repair round(s)`),
    ...(reviewDeferred > 0 ? [`${reviewDeferred} touched file(s) beyond the review cap were not reviewed`] : []),
    ...plan.openQuestions,
    ...packetResults.filter((p) => p.ok).flatMap((p) => p.result.notes),
  ],
};