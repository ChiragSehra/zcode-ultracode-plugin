#!/usr/bin/env bash
# ultracode-glm installer.
#
# Usage:
#   ./scripts/install.sh            # install workflows globally (~/​.zcode/workflows)
#   ./scripts/install.sh --local    # workflows stay project-scoped (.zcode/workflows) — default behavior anyway
#
# The plugin itself is installed by registering this repo as a local marketplace in ZCode
# (Settings → Plugins → Add marketplace → directory → this repo), then installing
# `ultracode@ultracode-local`. Commands/skills/agents/hooks load from the plugin; the six
# pattern workflows are plain files and can also be copied to user scope below.

set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p "$HOME/.zcode/workflows"

copied=0
for f in .zcode/workflows/*.dwf.ts; do
  [ -e "$f" ] || { echo "No .dwf.ts workflows found — run this after the workflows are authored."; exit 1; }
  name="$(basename "$f")"
  if [ ! -f "$HOME/.zcode/workflows/$name" ] || ! cmp -s "$f" "$HOME/.zcode/workflows/$name"; then
    cp "$f" "$HOME/.zcode/workflows/$name"
    echo "installed ~/.zcode/workflows/$name"
    copied=$((copied + 1))
  fi
done

echo "Done. $copied workflow(s) copied to user scope (available in every project)."
echo "Project-scope copies in .zcode/workflows/ remain the source of truth — re-run this after editing them."
echo
echo "To install the plugin: ZCode → Settings → Plugins → Add marketplace → directory:"
echo "  $(pwd)"
echo "then install: ultracode@ultracode-local"
