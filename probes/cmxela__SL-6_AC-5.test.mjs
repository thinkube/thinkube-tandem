// WHY (TRANSITION): deactivate used to dispose one module-level panel; now
// that many space tabs can be open at once, deactivate must dispose the
// WHOLE register instead, so no tab survives the extension shutting down.
// Its job is done once deactivate delegates to the register's own dispose
// rather than to a single remembered panel.
//
// The extension host (the real vscode module) is a platform this repository
// does not own — src/extension.ts imports it eagerly at module scope, so it
// cannot be loaded in a plain Node process without either the real host or
// a fabricated stand-in for the whole vscode namespace. Neither is a seam
// this repository defines, so this check reads the repository's own source
// text instead of executing it: a structural check on the wiring, not a
// simulation of a platform we do not own.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const extensionSrc = fs.readFileSync(
  path.resolve("src/extension.ts"),
  "utf8",
);

function bodyOf(fnName) {
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
  const spaceTabsSrc = fs.readFileSync(
    path.resolve("src/surfaces/spaceTabs.ts"),
    "utf8",
  );
  assert.match(
    spaceTabsSrc,
    /class\s+SpaceTabs\b/,
    "src/surfaces/spaceTabs.ts must export the SpaceTabs register deactivate is expected to delegate to",
  );
});
