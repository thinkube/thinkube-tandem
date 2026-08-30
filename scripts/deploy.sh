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

# The packaged extension is a COPY: git can say nothing about where it came
# from, and the closing gate needs that answer to know whether a run judges
# its own machinery. The build is the only place that knows, so it writes it
# down beside the rules it built (src/run/selfHosted.ts reads this).
echo "▸ stamp the repository this build came from…"
node -e '
const { execFileSync } = require("child_process"), fs = require("fs");
const git = (a) => { try { return execFileSync("git", a, { encoding: "utf8" }).trim() || undefined; } catch { return undefined; } };
const stamp = {
  remote: git(["remote", "get-url", "origin"]),
  gitDir: git(["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  commit: git(["rev-parse", "HEAD"]),
};
fs.writeFileSync("out/builtFrom.json", JSON.stringify(stamp, null, 2));
console.log("  " + (stamp.remote ?? stamp.gitDir ?? "no repository — the gate will refuse a self-hosted run"));
'

echo "▸ package ${VSIX} (with dependencies)…"
npx vsce package -o "${VSIX}" --allow-star-activation 2>&1 | tail -2

echo "▸ install into code-server…"
env -u CODE_SERVER_PARENT_PID -u VSCODE_IPC_HOOK_CLI -u VSCODE_IPC_HOOK \
    -u VSCODE_CWD -u VSCODE_NLS_CONFIG -u VSCODE_HANDLES_UNCAUGHT_ERRORS \
    -u VSCODE_PROXY_URI -u VSCODE_ESM_ENTRYPOINT \
    /usr/lib/code-server/bin/code-server --install-extension "${VSIX}" --force

# Repoint the version-stable launcher symlink BEFORE pruning: the Claude
# process wrapper resolves through extension-current, and a prune that
# outruns the repoint leaves it dangling — every Claude spawn then fails
# until a reload (the 2.0.0 outage; caught by the human).
echo "▸ repoint extension-current → v${VERSION}…"
STORAGE="${HOME}/.local/share/code-server/User/globalStorage/thinkube.thinkube-tandem"
mkdir -p "$STORAGE"
ln -sfn "${HOME}/.local/share/code-server/extensions/thinkube.thinkube-tandem-${VERSION}" \
  "$STORAGE/extension-current"

# A window that has not reloaded still runs an OLDER build, and pruning it
# out from under the live extension host ENOENTs every lazy require — which
# kills a run in flight. Keeping two was not enough on a day of many
# deploys: a run started on 2.0.127 died when 2.0.130 pruned it. Keep the
# last ten, and never prune a directory a live process is reading.
echo "▸ prune stale versions (keeping the last ten, and any version in use)…"
EXT_ROOT="${HOME}/.local/share/code-server/extensions"
KEEP=$(ls -d "${EXT_ROOT}"/thinkube.thinkube-tandem-* 2>/dev/null | sort -V | tail -10)
IN_USE=$(ls -l /proc/*/cwd /proc/*/exe 2>/dev/null | grep -o "thinkube.thinkube-tandem-[0-9.]*" | sort -u)
for v in $IN_USE; do KEEP="${KEEP}
${EXT_ROOT}/${v}"; done
for d in "${EXT_ROOT}"/thinkube.thinkube-tandem-*; do
  [ -d "$d" ] || continue
  echo "$KEEP" | grep -qx "$d" || { rm -rf "$d" && echo "  − $(basename "$d")"; }
done
for f in thinkube-tandem-*.vsix; do
  [ "$f" = "$VSIX" ] || rm -f "$f"
done

echo "▸ record the release (package.json version bump)…"
git add package.json package-lock.json 2>/dev/null || true
git commit -q -m "deploy: v${VERSION}" || true
git push -q || true

echo "▸ done — v${VERSION} installed. The Extensions panel now shows the update; reload when prompted."
