#!/usr/bin/env bash
#
# Build → package → install this extension into the local code-server in ONE step.
#
# Captures the EXACT working recipe so a redeploy is never re-derived by hand.
# (TEP-th3i18 #21: the ship path was manual, multi-artifact, and undocumented —
# every redeploy became a 20-minute archaeological dig. This script is the fix.)
#
# Two non-obvious gotchas this encodes — do NOT "simplify" them away:
#   1. `vsce package` MUST include node_modules (no `--no-dependencies`): the MCP
#      server requires node-pty / @octokit/rest at runtime (esbuild marks them
#      external). A deps-less vsix installs but the server fails to start.
#   2. code-server's CLI refuses extension management when it inherits the parent
#      server's IPC env (CODE_SERVER_PARENT_PID / VSCODE_IPC_HOOK_CLI) — it errors
#      "not spawned with IPC". We strip those so it runs as a standalone CLI.
#
# Usage:
#   scripts/deploy.sh           # compile, package, reinstall the CURRENT version (dev loop)
#   scripts/deploy.sh --bump    # bump the patch version first (a real release)
#
# After it finishes, reload the code-server window (Command Palette →
# "Developer: Reload Window") so the extension reactivates, repoints the
# `extension-current` symlink, and respawns the kanban MCP server from the new build.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${1:-}" = "--bump" ]; then
  npm version patch --no-git-tag-version
fi
VERSION="$(node -p "require('./package.json').version")"
VSIX="thinkube-tandem-${VERSION}.vsix"

echo "▸ compile (tsc + assets + bundle:mcp + webview)…"
npm run compile

# One-time: migrate globalStorage (signing key + approval store) from the old
# extension id to the new one before first use, so previously signed
# ac_verifications and pending approval tokens survive the rename.
# Guarded by a sentinel so it only runs once even on repeated deploys.
OLD_STORAGE="${HOME}/.local/share/code-server/User/globalStorage/thinkube.thinkube-ai-integration"
NEW_STORAGE="${HOME}/.local/share/code-server/User/globalStorage/thinkube.thinkube-tandem"
if [ -d "$OLD_STORAGE" ] && [ ! -f "$NEW_STORAGE/.migrated-from-thinkube-ai-integration" ]; then
  echo "▸ migrating globalStorage signing/ and approval store to thinkube.thinkube-tandem…"
  mkdir -p "$NEW_STORAGE"
  # Copy the signing key (AC-verification signatures and provenance).
  if [ -d "$OLD_STORAGE/signing" ]; then
    cp -r "$OLD_STORAGE/signing" "$NEW_STORAGE/signing"
  fi
  # Copy approval token files and any other top-level state, skipping dirs
  # that are version-specific or regenerated on first run.
  for item in "$OLD_STORAGE"/*; do
    base="$(basename "$item")"
    case "$base" in
      signing|extension-current|control|orchestrator-sessions) continue ;;
    esac
    cp -r "$item" "$NEW_STORAGE/$base" 2>/dev/null || true
  done
  touch "$NEW_STORAGE/.migrated-from-thinkube-ai-integration"
  echo "  ✓ migration done"
fi

# One-time: uninstall the old extension id so it doesn't run side-by-side
# (duplicate commands, two kanban MCP servers) after the rename.
echo "▸ uninstalling old id (thinkube.thinkube-ai-integration) if present…"
env -u CODE_SERVER_PARENT_PID -u VSCODE_IPC_HOOK_CLI -u VSCODE_IPC_HOOK \
    -u VSCODE_CWD -u VSCODE_NLS_CONFIG -u VSCODE_HANDLES_UNCAUGHT_ERRORS \
    -u VSCODE_PROXY_URI -u VSCODE_ESM_ENTRYPOINT \
  /usr/lib/code-server/bin/code-server \
    --uninstall-extension thinkube.thinkube-ai-integration 2>/dev/null || true

echo "▸ package ${VSIX} (WITH node_modules — never --no-dependencies)…"
node_modules/.bin/vsce package

echo "▸ install into code-server (IPC env stripped so the CLI runs standalone)…"
env -u CODE_SERVER_PARENT_PID -u VSCODE_IPC_HOOK_CLI -u VSCODE_IPC_HOOK \
    -u VSCODE_CWD -u VSCODE_NLS_CONFIG -u VSCODE_HANDLES_UNCAUGHT_ERRORS \
    -u VSCODE_PROXY_URI -u VSCODE_ESM_ENTRYPOINT \
  /usr/lib/code-server/bin/code-server \
    --install-extension "$PWD/$VSIX" --force

echo
echo "✓ installed ${VSIX}"
echo "  → Now reload the window (Developer: Reload Window) to make it live."
