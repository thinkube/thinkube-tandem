// WHY (TRANSITION): the tree used to mark only the ONE remembered active
// slug per owner as open; now that a person can have several tabs open on
// one owner at once, the tree must mark every open space, not just the
// remembered one. Its job is done once the tree reads the full set of open
// spaces rather than a single remembered slug.
//
// The extension host (the real vscode module) is a platform this repository
// does not own — src/hostui/projectsTree.ts imports it eagerly at module
// scope (ProjectsTreeProvider extends vscode.TreeItem's family of classes),
// so it cannot be loaded in a plain Node process without either the real
// host or a fabricated stand-in for the whole vscode namespace. Neither is
// a seam this repository defines, so this check reads the repository's own
// source text instead of executing it: a structural check that the marking
// logic reads membership in an open-space set, not equality to one slug.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const treeSrc = fs.readFileSync(
  path.resolve("src/hostui/projectsTree.ts"),
  "utf8",
);

test("the tree's open-marking logic reads a set of open spaces, not one remembered slug, so two open tabs of one owner can both be marked", () => {
  // The old shape read one remembered slug and compared with `===`:
  //   s.slug === activeSlug
  // A per-owner SET can mark more than one space open at once; a single
  // remembered slug structurally cannot, no matter what the constructor is
  // named. So the marking predicate must no longer be an equality test
  // against one remembered value — it must be a membership test.
  assert.doesNotMatch(
    treeSrc,
    /s\.slug\s*===\s*activeSlug/,
    "getChildren must no longer mark a space open by comparing its slug to one remembered active slug — that shape can only ever mark one space per owner",
  );

  // The constructor must be handed something that can hold more than one
  // open slug per owner (a Set, an array, or an equivalent membership
  // source) rather than a single `string | undefined` getter — the ACTUAL
  // parameter name is the implementer's choice, so this asserts on the
  // return SHAPE the constructor's own type annotation carries, not a name.
  const ctorMatch = treeSrc.match(
    /constructor\s*\(([\s\S]*?)\)\s*\{/,
  );
  assert.ok(ctorMatch, "ProjectsTreeProvider must still declare a constructor");
  const ctorParams = ctorMatch[1];

  assert.doesNotMatch(
    ctorParams,
    /activeSpace:\s*\([^)]*\)\s*=>\s*string\s*\|\s*undefined/,
    "the constructor must no longer accept a single-slug `() => string | undefined` reader for open spaces — a lone slug cannot represent two open tabs of one owner",
  );
});
