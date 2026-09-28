#!/usr/bin/env node
// The repo's deterministic gate (`npm test`). Zero dependencies: node builtins only.
// Checks the things this repo has actually gotten wrong: manifest drift, invalid
// frontmatter (the unquoted-': ' bug class), missing pattern workflows, guard regressions.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p) => join(root, p);
let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`FAIL ${msg}`);
};
const pass = (msg) => console.log(`ok   ${msg}`);

// --- JSON manifests parse, and agree on name/version ---
const jsonFiles = [
  "plugin/.zcode-plugin/plugin.json",
  "plugin/.claude-plugin/plugin.json",
  "plugin/hooks/hooks.json",
  "marketplace.json",
];
const parsed = {};
for (const f of jsonFiles) {
  try {
    parsed[f] = JSON.parse(readFileSync(rel(f), "utf8"));
    pass(`${f} parses`);
  } catch (e) {
    fail(`${f}: ${e.message}`);
  }
}
const canonical = parsed["plugin/.zcode-plugin/plugin.json"];
const alias = parsed["plugin/.claude-plugin/plugin.json"];
const entry = parsed["marketplace.json"]?.plugins?.[0];
if (
  canonical !== undefined &&
  alias !== undefined &&
  entry !== undefined &&
  (entry.name !== canonical.name || entry.version !== canonical.version || alias.version !== canonical.version)
) {
  fail(`name/version drift: marketplace ${entry.name}@${entry.version}, canonical ${canonical.name}@${canonical.version}, alias ${alias.version}`);
} else {
  pass("marketplace and both manifests agree on name/version");
}
for (const dir of ["commands", "skills", "agents", "hooks"]) {
  if (canonical !== undefined && !existsSync(rel(join("plugin", dir)))) {
    fail(`manifest declares missing dir plugin/${dir}`);
  }
}
pass("manifest component dirs exist");

// --- Frontmatter: minimal YAML subset that rejects the unquoted-': ' bug class ---
function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (m === null) return { error: "no --- frontmatter block" };
  const fields = {};
  const lines = m[1].split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const mm = /^([A-Za-z][A-Za-z0-9_-]*):\s?(.*)$/.exec(line);
    if (mm === null) return { error: `frontmatter line ${i + 1} is not key: value` };
    const value = mm[2];
    if (value === "") return { error: `frontmatter line ${i + 1}: key '${mm[1]}' has no value` };
    const quoted = value.startsWith('"') || value.startsWith("'");
    const array = value.startsWith("[");
    if (!quoted && !array && /:\s/.test(value)) {
      return { error: `frontmatter line ${i + 1}: unquoted value contains ': ' — quote the value` };
    }
    fields[mm[1]] = value;
  }
  return { fields };
}

{
  const bad = parseFrontmatter("---\nargument-hint: <target: files>\n---\n");
  if (bad.error !== undefined && bad.error.includes("unquoted")) {
    pass("frontmatter colon rule catches the known bug class (selftest)");
  } else {
    fail("frontmatter colon rule failed its selftest");
  }
}

function walkMd(dir) {
  const out = [];
  for (const e of readdirSync(rel(dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walkMd(p));
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

const requiredKeys = (f) =>
  f.includes("/commands/")
    ? ["description", "argument-hint"]
    : f.includes("/agents/")
      ? ["name", "description", "model"]
      : f.includes("/skills/")
        ? ["name", "description"]
        : [];
let fmChecked = 0;
for (const f of walkMd("plugin")) {
  const fm = parseFrontmatter(readFileSync(rel(f), "utf8"));
  fmChecked += 1;
  if (fm.error !== undefined) {
    fail(`${f}: ${fm.error}`);
    continue;
  }
  for (const k of requiredKeys(f)) {
    if (fm.fields[k] === undefined) fail(`${f}: missing frontmatter key '${k}'`);
  }
}
pass(`frontmatter valid on ${fmChecked} plugin markdown file(s)`);

// --- Claude Code workflow ports parse as ESM ---
if (existsSync(rel("plugin/workflows"))) {
  const ccFiles = readdirSync(rel("plugin/workflows")).filter((f) => f.endsWith(".js"));
  for (const f of ccFiles) {
    try {
      execFileSync("node", ["--input-type=module", "--check"], {
        input: readFileSync(rel(`plugin/workflows/${f}`), "utf8"),
        stdio: ["pipe", "pipe", "pipe"],
      });
      pass(`plugin/workflows/${f} parses as ESM`);
    } catch (e) {
      fail(`plugin/workflows/${f}: ${e.stderr !== undefined && e.stderr !== "" ? e.stderr : e.message}`);
    }
  }
}

// --- the six pattern workflows exist and keep their shape ---
const patterns = ["research", "implement", "audit", "decide", "converge", "sweep"];
for (const name of patterns) {
  const p = `.zcode/workflows/${name}.dwf.ts`;
  if (!existsSync(rel(p))) {
    fail(`missing saved workflow ${p}`);
    continue;
  }
  const text = readFileSync(rel(p), "utf8");
  if (!text.includes("phase(")) fail(`${p}: no phase() marker`);
  if (!/return\s*\{/.test(text)) fail(`${p}: no report-shaped return`);
}
pass("six pattern workflows present, with phase markers and report returns");

// --- shell syntax, guard behavior, toy tests ---
try {
  execFileSync("bash", ["-n", "scripts/install.sh"], { stdio: "pipe" });
  pass("scripts/install.sh parses");
} catch (e) {
  fail(`scripts/install.sh: ${e.message}`);
}

function guardExit(command) {
  const r = spawnSync("node", [rel("plugin/hooks/guard.mjs")], {
    input: JSON.stringify({ tool_input: { command } }),
  });
  return r.status;
}
if (guardExit("echo hi") !== 0) fail("guard hook: benign command was not allowed (exit 0 expected)");
if (guardExit("rm -rf /etc/x") !== 2) fail("guard hook: destructive command was not denied (exit 2 expected)");
if (guardExit("git push --force origin main") !== 2) fail("guard hook: force-push to main was not denied (exit 2 expected)");
pass("guard hook allows benign, denies destructive (3 cases)");

try {
  const out = execFileSync("node", ["examples/toy/run_tests.js"], { encoding: "utf8" });
  pass(`toy calculator tests: ${out.trim()}`);
} catch (e) {
  fail(`toy calculator tests failed: ${e.message}`);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
