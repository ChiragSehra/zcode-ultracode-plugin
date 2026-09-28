/* zcode-workflow
description: "Implement with verification: planner emits typed task packets, a
  fresh reviewer checks the plan, packets execute in parallel, then
  auto-discovered deterministic gates (CI-believed tool, lockfile markers,
  lint/typecheck fast tiers, Makefile targets, git-diff fallback; overridable
  via gates.kind) drive a capped repair loop, then an independent reviewer per
  changed file with one capped fix round. Diff-summary artifact. Default run
  model: GLM-5.3-Flash$high."
whenToUse: Use when the user asks to implement or change something substantial
  enough to deserve plan → parallel execution → build/test gates → independent
  review (/uc:implement or /ultracode routed to implement). For a one-line fix
  or a single-file tweak, do it directly; for pure research, use research.
args:
  gates:
    type: json
    description: 'Optional gate override bypassing auto-discovery: {"kind":
      "npm|pnpm|yarn|bun|deno|make|make-check|cargo|go|pytest|gradle|mix|dotnet|node",
      "args": ["file.js"]} (node takes the test entry file(s) in args).'
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
type GateKind =
  | "npm" | "pnpm" | "yarn" | "bun" | "deno"
  | "npm-lint" | "npm-typecheck"
  | "make" | "make-check" | "cargo" | "go" | "pytest" | "gradle" | "mix" | "dotnet"
  | "node" | "gitcheck";
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
  if (kind === "pnpm") return { kind: "pnpm", argv: [], label: "pnpm test" };
  if (kind === "yarn") return { kind: "yarn", argv: [], label: "yarn test" };
  if (kind === "bun") return { kind: "bun", argv: [], label: "bun test" };
  if (kind === "deno") return { kind: "deno", argv: [], label: "deno test" };
  if (kind === "make") return { kind: "make", argv: [], label: "make test" };
  if (kind === "make-check") return { kind: "make-check", argv: [], label: "make check" };
  if (kind === "cargo") return { kind: "cargo", argv: [], label: "cargo test" };
  if (kind === "go") return { kind: "go", argv: [], label: "go test ./..." };
  if (kind === "pytest") return { kind: "pytest", argv: [], label: "pytest" };
  if (kind === "gradle") return { kind: "gradle", argv: [], label: "gradle test" };
  if (kind === "mix") return { kind: "mix", argv: [], label: "mix test" };
  if (kind === "dotnet") return { kind: "dotnet", argv: [], label: "dotnet test" };
  if (kind === "node") return { kind: "node", argv, label: "node test" };
  return null;
}

// Auto-discovery, in order of trust: the repo's own CI config names the tool it believes
// in; lockfiles and markers corroborate; fast tiers (lint/typecheck) precede the strong
// test gate; detection only ever selects among the compile-time literals in runGate.
async function detectGates(): Promise<GateSpec[]> {
  const found: GateSpec[] = [];
  const has = async (pattern: string) => (await files.glob(pattern)).length > 0;

  let ciTool: string | null = null;
  try {
    const ciRuns = await files.grep(
      "run:.{0,120}(npm|pnpm|yarn|bun|deno|cargo|go|pytest|gradle|mix|dotnet|make).{0,40}test",
      ".github/workflows/**",
    );
    const tools = ["pnpm", "yarn", "bun", "deno", "cargo", "pytest", "gradle", "mix", "dotnet", "make", "go", "npm"];
    for (const m of ciRuns.slice(0, 10)) {
      ciTool = tools.find((t) => new RegExp(`\\b${t}\\b`).test(m.text)) ?? null;
      if (ciTool !== null) break;
    }
  } catch {
    ciTool = null;
  }

  let pkg: unknown = null;
  try {
    pkg = JSON.parse(await files.read("package.json"));
  } catch {
    pkg = null;
  }
  const scripts = (pkg as { scripts?: Record<string, unknown> } | null)?.scripts;
  const hasTest = scripts !== undefined && typeof scripts.test === "string";
  if (scripts !== undefined && typeof scripts.lint === "string") {
    found.push({ kind: "npm-lint", argv: [], label: "npm run lint (fast)" });
  }
  if (scripts !== undefined && typeof scripts.typecheck === "string") {
    found.push({ kind: "npm-typecheck", argv: [], label: "npm run typecheck (fast)" });
  }
  if (hasTest) {
    const runner =
      ciTool === "pnpm" || ciTool === "yarn" || ciTool === "bun"
        ? ciTool
        : await has("pnpm-lock.yaml")
          ? "pnpm"
          : await has("yarn.lock")
            ? "yarn"
            : await has("bun.lockb")
              ? "bun"
              : "npm";
    found.push({ kind: runner as GateKind, argv: [], label: `${runner} test` });
  }
  if ((await has("deno.json*")) || ciTool === "deno") {
    found.push({ kind: "deno", argv: [], label: "deno test" });
  }
  if (await has("Cargo.toml") || ciTool === "cargo") {
    found.push({ kind: "cargo", argv: [], label: "cargo test" });
  }
  if (await has("go.mod") || ciTool === "go") {
    found.push({ kind: "go", argv: [], label: "go test ./..." });
  }
  if ((await has("pyproject.toml") && (await has("tests/**") || await has("test/**"))) || ciTool === "pytest") {
    found.push({ kind: "pytest", argv: [], label: "pytest" });
  }
  if (await has("build.gradle*") || ciTool === "gradle") {
    found.push({ kind: "gradle", argv: [], label: "gradle test" });
  }
  if (await has("mix.exs") || ciTool === "mix") {
    found.push({ kind: "mix", argv: [], label: "mix test" });
  }
  if ((await has("*.csproj") || await has("*.sln")) || ciTool === "dotnet") {
    found.push({ kind: "dotnet", argv: [], label: "dotnet test" });
  }
  if (await has("Makefile")) {
    let mk = "";
    try {
      mk = await files.read("Makefile");
    } catch {
      mk = "";
    }
    if (/(^|\n)test:/.test(mk) || ciTool === "make") {
      found.push({ kind: "make", argv: [], label: "make test" });
    } else if (/(^|\n)check:/.test(mk)) {
      found.push({ kind: "make-check", argv: [], label: "make check" });
    }
  }

  const capped = found.slice(0, 3);
  if (capped.length === 0) {
    let inGitRepo = true;
    try {
      await git.status();
    } catch {
      inGitRepo = false;
    }
    if (inGitRepo) {
      capped.push({ kind: "gitcheck", argv: [], label: "git diff --check" });
    }
  }
  return capped;
}

let gates: GateSpec[] = [];
const chosen = gateKind !== null ? gateFor(gateKind, gateArgv) : null;
if (chosen !== null) {
  gates = [chosen];
} else {
  gates = await detectGates();
}

function outcome(g: GateSpec, r: { exitCode: number; stdout: string; stderr: string }): { label: string; ok: boolean; output: string } {
  return { label: g.label, ok: r.exitCode === 0, output: `${r.stdout}\n${r.stderr}`.slice(0, 4000) };
}

async function runGate(g: GateSpec): Promise<{ label: string; ok: boolean; output: string }> {
  if (g.kind === "npm") return outcome(g, await world.run("npm", ["test"], { timeoutMs: 900000 }));
  if (g.kind === "pnpm") return outcome(g, await world.run("pnpm", ["test"], { timeoutMs: 900000 }));
  if (g.kind === "yarn") return outcome(g, await world.run("yarn", ["test"], { timeoutMs: 900000 }));
  if (g.kind === "bun") return outcome(g, await world.run("bun", ["test"], { timeoutMs: 900000 }));
  if (g.kind === "deno") return outcome(g, await world.run("deno", ["test"], { timeoutMs: 900000 }));
  if (g.kind === "npm-lint") return outcome(g, await world.run("npm", ["run", "lint"], { timeoutMs: 600000 }));
  if (g.kind === "npm-typecheck") return outcome(g, await world.run("npm", ["run", "typecheck"], { timeoutMs: 600000 }));
  if (g.kind === "make") return outcome(g, await world.run("make", ["test"], { timeoutMs: 900000 }));
  if (g.kind === "make-check") return outcome(g, await world.run("make", ["check"], { timeoutMs: 900000 }));
  if (g.kind === "cargo") return outcome(g, await world.run("cargo", ["test"], { timeoutMs: 900000 }));
  if (g.kind === "go") return outcome(g, await world.run("go", ["test", "./..."], { timeoutMs: 900000 }));
  if (g.kind === "pytest") return outcome(g, await world.run("python3", ["-m", "pytest"], { timeoutMs: 900000 }));
  if (g.kind === "gradle") return outcome(g, await world.run("gradle", ["test"], { timeoutMs: 1800000 }));
  if (g.kind === "mix") return outcome(g, await world.run("mix", ["test"], { timeoutMs: 900000 }));
  if (g.kind === "dotnet") return outcome(g, await world.run("dotnet", ["test"], { timeoutMs: 1800000 }));
  if (g.kind === "node") return outcome(g, await world.run("node", g.argv.length > 0 ? g.argv : ["test.js"], { timeoutMs: 900000 }));
  return outcome(g, await world.run("git", ["diff", "--check"], { timeoutMs: 60000 }));
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