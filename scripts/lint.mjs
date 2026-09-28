#!/usr/bin/env node
// Markdown internal-reference lint (`npm run lint`). Zero dependencies.
// Every backticked repo-relative path must exist; every /uc:* or /ultracode mention
// must match a shipped command file. Roughly what the sweep dogfood run did by hand.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p) => join(root, p);

function walkMd(dir) {
  const out = [];
  for (const e of readdirSync(rel(dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walkMd(p));
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

const files = ["README.md", "AGENTS.md", "DESIGN.md", "CONTRIBUTING.md", ...walkMd("docs"), ...walkMd("plugin")];
const ROOT_PREFIXES = ["docs/", "plugin/", "examples/", "scripts/", ".zcode/", ".github/", ".claude-plugin/", "marketplace.json", "LICENSE", "package.json"];
const PATH_EXT = /\.(md|ts|js|mjs|json|sh|ya?ml|toml|lockb)$/;
// A repo-relative path must start at a real top-level entry; anything else
// (e.g. `claude-security/workflows/scan.js` from another plugin) is external.
const topLevel = new Set(readdirSync(root));

let checked = 0;
let failures = 0;

function isPathCandidate(t) {
  if (/[\s<>{*$]/.test(t)) return false; // placeholders, globs, spaced prose
  if (/^(https?:|~|\/)/.test(t)) return false; // external, home, absolute
  if (!t.includes("/")) return false;
  if (ROOT_PREFIXES.some((p) => t === p || t.startsWith(p))) return true;
  if (!PATH_EXT.test(t) || !/^[A-Za-z0-9._-]+\//.test(t)) return false;
  return topLevel.has(t.split("/")[0]);
}

for (const f of files) {
  const text = readFileSync(rel(f), "utf8");
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const t = m[1];
    if (isPathCandidate(t)) {
      checked += 1;
      if (!existsSync(rel(t))) {
        failures += 1;
        console.error(`FAIL ${f}: references missing path \`${t}\``);
      }
    }
    const cmd = /^\/(uc:[a-z][a-z0-9-]*|ultracode)$/.exec(t);
    if (cmd !== null) {
      checked += 1;
      const p = t.startsWith("/uc:") ? `plugin/commands/uc/${t.slice(4)}.md` : "plugin/commands/ultracode.md";
      if (!existsSync(rel(p))) {
        failures += 1;
        console.error(`FAIL ${f}: references missing command ${t} (${p})`);
      }
    }
  }
}

console.log(`ok   ${checked} internal references checked across ${files.length} markdown files`);
if (failures > 0) {
  console.error(`\n${failures} broken reference(s)`);
  process.exit(1);
}
