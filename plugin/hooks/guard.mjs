#!/usr/bin/env node
// Ultracode destructive-op guard (PreToolUse, matcher: Bash).
// Deny (exit 2 + stderr reason) only high-confidence irreversible commands;
// everything else passes silently (exit 0). A denied call should become a
// question to the user, not a workaround — the reason text says so.

import { readFileSync } from "node:fs";

const REASON_PREFIX = "[ultracode guard]";

function readCommand(stdinText) {
  try {
    const payload = JSON.parse(stdinText);
    const input = payload?.tool_input ?? {};
    return typeof input.command === "string" ? input.command : "";
  } catch {
    return "";
  }
}

// System roots nobody means to recursive-delete intentionally — at any depth.
const DANGEROUS_ROOTS = [
  /^\/$/,                      // /
  /^~$/,                       // ~
  /^\$\{?HOME\}?$/,            // $HOME / ${HOME}
  /^\*$/,                      // * (rm -rf * in the wrong cwd)
  /^\/(etc|usr|bin|sbin|var|opt|boot|System|Library|Applications|private)(\/|$)/,
  /^\/(Users|home)(\/[^/]+)?\/?$/, // /Users, /home — and one level: a whole account
];

function rmTargets(cmd) {
  // Tokens after `rm` that are not flags, stopping at shell separators.
  const tokens = cmd.trim().split(/\s+/);
  const out = [];
  let seen = false;
  for (const tok of tokens) {
    if (!seen) {
      if (tok === "rm") seen = true;
      continue;
    }
    if (/^[;&|]/.test(tok) || tok === "&&" || tok === "||") break;
    if (tok.startsWith("-")) continue;
    out.push(tok.replace(/^["']|["']$/g, ""));
  }
  return out;
}

function check(cmd) {
  if (!cmd) return null;

  // 1) sudo rm -rf — essentially never what a coding agent should run unattended.
  if (/\bsudo\s+rm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*|--recursive|--force)/.test(cmd)) {
    return "sudo + recursive rm is blocked outright. Do it by hand if the user truly wants it.";
  }

  // 2) rm -rf against system roots / home / bare glob.
  if (/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*|--recursive\b[^|;&]*--force\b|--force\b[^|;&]*--recursive\b)/.test(cmd)) {
    const targets = rmTargets(cmd);
    const hit = targets.find((t) => DANGEROUS_ROOTS.some((re) => re.test(t)));
    if (hit !== undefined) {
      return `recursive delete of '${hit}' looks irreversible. Ask the user to run or approve it explicitly.`;
    }
  }

  // 3) force-push to (or defaulted to) a protected branch.
  if (/\bgit\s+push\b/.test(cmd) && /(\s--force(\s|=|$)|\s-f(\s|$))/.test(cmd) && !/--force-with-lease/.test(cmd)) {
    const refs = cmd.replace(/^.*\bgit\s+push\b/, "").trim();
    const named = refs.split(/\s+/).filter((t) => !t.startsWith("-"));
    const protect = named.some((t) => /(^|\/|:)(main|master)(\/|$|:|\^|$)/.test(t));
    if (protect || named.length === 0) {
      return "force-push to main/master (or the default upstream) rewrites shared history. Ask the user first.";
    }
  }

  // 4) pipe-to-shell as root.
  if (/\|\s*sudo\s+(sh|bash|zsh|dash|ksh)\b/.test(cmd) || /(?:curl|wget)\b[^|]*\|\s*sudo\s/.test(cmd)) {
    return "piping a download into a root shell. Ask the user to run it by hand if intended.";
  }

  // 5) raw-device writes / filesystem formatting.
  if (/\bdd\b[^|;&]*\bof=\/dev\/(disk|rdisk|sd|nvme|hd)/.test(cmd)) {
    return "dd to a raw disk device. Ask the user to run it by hand if intended.";
  }
  if (/\bmkfs(\.\w+)?\b[^|;&]*\/dev\//.test(cmd)) {
    return "mkfs on a device node. Ask the user to run it by hand if intended.";
  }

  return null;
}

const cmd = readCommand(readFileSync(0, "utf8"));
const reason = check(cmd);
if (reason !== null) {
  process.stderr.write(`${REASON_PREFIX} ${reason} If the user explicitly wants this, have them run it or approve it directly — do not retry the command verbatim.\n`);
  process.exit(2);
}
process.exit(0);
