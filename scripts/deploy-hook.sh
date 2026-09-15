#!/usr/bin/env bash
#
# Steps only this repository needs, called by scripts/deploy.sh with
# dependencies, pre-package and post-install.
set -euo pipefail
cd "$(dirname "$0")/.."

case "${1:?hook step}" in
  dependencies)
    # The map webview is its own package; compile builds it.
    npm --prefix webview/map ci
    ;;

  pre-package)
    # The ledger records what a RUN catches, and a run cannot catch a defect in
    # the machinery that runs it — so the tool's own repairs are read from the
    # commits that made them. A commit says `Defect: <what was wrong>`; every
    # deploy harvests the ones it has not harvested yet. A commit that says
    # nothing records nothing.
    echo "  harvest the tool's own repairs into the ledger…"
    node -e '
const { harvestSelfDefects } = require("./out/engine/selfDefects.js");
const store = process.env.TANDEM_STORE || require("path").join(process.env.HOME, "thinkube-tandem-store");
const version = require("./package.json").version;
try {
  const r = harvestSelfDefects({ repoRoot: process.cwd(), storeDir: store, version });
  console.log("  " + (r.recorded ? `${r.recorded} repair(s) recorded` : "nothing new to record"));
} catch (e) { console.log("  not recorded: " + e.message); }
' 2>/dev/null || echo "  (skipped — no build yet)"

    # The packaged extension is a COPY: git can say nothing about where it came
    # from, and the closing gate needs that answer to know whether a run judges
    # its own machinery. The build is the only place that knows, so it writes it
    # down beside the rules it built (src/run/selfHosted.ts reads this).
    echo "  stamp the repository this build came from…"
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
    ;;

  post-install)
    # The Claude process wrapper resolves through extension-current, so it
    # points at the version just installed before any prune runs.
    VERSION="$(node -p "require('./package.json').version")"
    STORAGE="${HOME}/.local/share/code-server/User/globalStorage/thinkube.thinkube-tandem"
    mkdir -p "$STORAGE"
    ln -sfn "${HOME}/.local/share/code-server/extensions/thinkube.thinkube-tandem-${VERSION}" \
      "$STORAGE/extension-current"
    echo "  extension-current → v${VERSION}"
    ;;

  *)
    echo "unknown hook step: $1" >&2
    exit 2
    ;;
esac
