// WHY (TRANSITION): "active" used to mean "the remembered slug", which
// stays remembered even after its tab is closed — so a closed tab kept
// showing as open in the tree forever. This proves the provider now takes
// a dependency that can report a space's tab as no-longer-open (fed by the
// live tab register), rather than only the persisted remembered slug.
// src/hostui/projectsTree.ts extends vscode.TreeItem and constructs a live
// vscode.EventEmitter, so it cannot be loaded under plain node:test (no
// vscode module is resolvable outside the running editor) — this reads the
// provider's source text, the one seam this probe can honestly observe
// without starting the extension host.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/hostui/projectsTree.ts", import.meta.url), "utf8");

test("ProjectsTreeProvider is constructed with an open-state dependency queried per space, not only the remembered activeSpace", () => {
  const ctorStart = src.indexOf("constructor(");
  assert.ok(ctorStart >= 0, "ProjectsTreeProvider must declare a constructor");
  const ctorEnd = src.indexOf(") {}", ctorStart);
  const ctorParams = src.slice(ctorStart, ctorEnd);
  // The old shape carried only `activeSpace: (ownerKey) => slug | undefined`
  // — a single remembered slug per owner. A space dropped from the live
  // register (its tab closed) must stop being reported as open even while
  // it is still the remembered slug, which a single-slug dependency cannot
  // express. The provider must therefore gain a way to ask per-space
  // whether a tab is currently open.
  assert.ok(
    /is(SpaceOpen|Open|TabOpen)\s*:/.test(ctorParams) ||
      /is(SpaceOpen|Open|TabOpen)\s*\(/.test(ctorParams),
    "the constructor must take a per-space open-state query (e.g. isSpaceOpen/isOpen), " +
      "not only the single remembered activeSpace slug, so a closed tab can stop being marked open " +
      "independently of what slug is still remembered",
  );
});
