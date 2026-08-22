/**
 * deactivate must dispose the space-tabs register rather than a single
 * remembered panel, so no tab outlives the extension. pushActive must
 * raise a delivery-ready notification for the space key the change came
 * from, and open that key's own tab — never the space remembered as
 * active. src/extension.ts imports the real `vscode` module eagerly at
 * module scope — a platform this repository does not own and cannot
 * fabricate a stand-in for — so this reads the repository's own source
 * text instead of executing it: a structural check on the wiring, not a
 * simulation of a platform we do not own.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");
const extensionSrc = fs.readFileSync(path.join(REPO_ROOT, "src", "extension.ts"), "utf8");

function bodyOf(fnName: string): string {
  const marker = `function ${fnName}(`;
  const start = extensionSrc.indexOf(marker);
  assert.ok(start >= 0, `extension.ts must still declare ${fnName}`);
  // Walk brace depth from the function's opening "{" to find its matching
  // close — good enough for one well-formed top-level function body.
  const braceOpen = extensionSrc.indexOf("{", start);
  let depth = 0;
  let i = braceOpen;
  for (; i < extensionSrc.length; i++) {
    if (extensionSrc[i] === "{") depth++;
    else if (extensionSrc[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return extensionSrc.slice(braceOpen, i + 1);
}

test("deactivate disposes the register rather than a single panel, so no tab outlives the extension", () => {
  const deactivateBody = bodyOf("deactivate");

  assert.match(
    deactivateBody,
    /\.dispose\(\)/,
    "deactivate must still call dispose() on something",
  );
  assert.doesNotMatch(
    deactivateBody,
    /panel\?\.\s*dispose\(\)|panel\.dispose\(\)/,
    "deactivate must no longer dispose a single module-level `panel` — that was the one-tab shape this change replaces",
  );

  // The register's own type must exist at its contracted home so the
  // dispose-the-register claim has something real to point at.
  const spaceTabsSrc = fs.readFileSync(path.join(REPO_ROOT, "src", "surfaces", "spaceTabs.ts"), "utf8");
  assert.match(
    spaceTabsSrc,
    /class\s+SpaceTabs\b/,
    "src/surfaces/spaceTabs.ts must export the SpaceTabs register deactivate is expected to delegate to",
  );
});

test("a delivery-ready message raised for one space opens that space's tab, not the space remembered as active", () => {
  const pushActiveBody = bodyOf("pushActive");

  // The old shape resolved the ONE session to push and to notify about from
  // context alone — pushActive(context, message) with no space key. A push
  // that must reach one space's own tab needs that space's key threaded
  // through, so the function signature itself must now carry a key.
  const sigMatch = extensionSrc.match(/function pushActive\(([^)]*)\)/);
  assert.ok(sigMatch, "extension.ts must still declare pushActive");
  assert.match(
    sigMatch![1],
    /key/i,
    "pushActive must take the space key the change came from, so it can push and notify for that exact space rather than re-deriving 'the active session'",
  );

  // Inside pushActive, opening the space from the notification's pick must
  // route through the key that was passed in — never blindly through the
  // remembered-active resolution path (activateProject with no id, or a
  // command that re-reads the remembered active project/slug).
  assert.doesNotMatch(
    pushActiveBody,
    /executeCommand\(\s*["']thinkube-tandem\.openSpace["']\s*\)/,
    "the delivery-ready notification must not open 'the' remembered space via the no-argument openSpace command — it must open the space the message came from",
  );
});
