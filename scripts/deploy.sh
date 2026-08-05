#!/usr/bin/env bash
#
# Build → package → install this extension into the local code-server, one step.
# Two encoded constraints (from the field): the vsix MUST include node_modules
# (the Agent SDK is a runtime dependency loaded dynamically), and code-server's
# CLI refuses extension management when it inherits the parent server's IPC
# env — those variables are stripped before install.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="$(node -p "require('./package.json').version")"
VSIX="thinkube-tandem-${VERSION}.vsix"

echo "▸ compile (tsc + webview)…"
npm run compile

echo "▸ package ${VSIX} (with dependencies)…"
npx vsce package -o "${VSIX}" --allow-star-activation 2>&1 | tail -2

echo "▸ install into code-server…"
env -u CODE_SERVER_PARENT_PID -u VSCODE_IPC_HOOK_CLI -u VSCODE_IPC_HOOK \
    -u VSCODE_CWD -u VSCODE_NLS_CONFIG -u VSCODE_HANDLES_UNCAUGHT_ERRORS \
    -u VSCODE_PROXY_URI -u VSCODE_ESM_ENTRYPOINT \
    /usr/lib/code-server/bin/code-server --install-extension "${VSIX}" --force

echo "▸ done — reload the window (Developer: Reload Window) to activate."
