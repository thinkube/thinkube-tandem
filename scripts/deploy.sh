#!/usr/bin/env bash
#
# Build → package → install this extension into the local code-server, one step.
#
# Every deploy BUMPS THE PATCH VERSION first (v1's --bump, made mandatory):
# an identical version reinstalled looks like "nothing new" to code-server —
# no update badge, no Reload button in the Extensions panel, and the human
# gets zero signal that anything shipped. A version change is the signal.
#
# Two more encoded constraints (from the field): the vsix MUST include
# node_modules (the Agent SDK is a runtime dependency loaded dynamically),
# and code-server's CLI refuses extension management when it inherits the
# parent server's IPC env — those variables are stripped before install.
set -euo pipefail
cd "$(dirname "$0")/.."

npm version patch --no-git-tag-version >/dev/null
VERSION="$(node -p "require('./package.json').version")"
VSIX="thinkube-tandem-${VERSION}.vsix"
echo "▸ version bumped to ${VERSION}"

echo "▸ compile (tsc + webview)…"
npm run compile

echo "▸ package ${VSIX} (with dependencies)…"
npx vsce package -o "${VSIX}" --allow-star-activation 2>&1 | tail -2

echo "▸ install into code-server…"
env -u CODE_SERVER_PARENT_PID -u VSCODE_IPC_HOOK_CLI -u VSCODE_IPC_HOOK \
    -u VSCODE_CWD -u VSCODE_NLS_CONFIG -u VSCODE_HANDLES_UNCAUGHT_ERRORS \
    -u VSCODE_PROXY_URI -u VSCODE_ESM_ENTRYPOINT \
    /usr/lib/code-server/bin/code-server --install-extension "${VSIX}" --force

echo "▸ prune stale versions (dirs + old vsix files)…"
EXT_ROOT="${HOME}/.local/share/code-server/extensions"
for d in "${EXT_ROOT}"/thinkube.thinkube-tandem-*; do
  [ -d "$d" ] || continue
  case "$d" in
    *"thinkube.thinkube-tandem-${VERSION}") ;;
    *) rm -rf "$d" && echo "  − $(basename "$d")" ;;
  esac
done
for f in thinkube-tandem-*.vsix; do
  [ "$f" = "$VSIX" ] || rm -f "$f"
done

echo "▸ record the release (package.json version bump)…"
git add package.json package-lock.json 2>/dev/null || true
git commit -q -m "deploy: v${VERSION}" || true
git push -q || true

echo "▸ done — v${VERSION} installed. The Extensions panel now shows the update; reload when prompted."
