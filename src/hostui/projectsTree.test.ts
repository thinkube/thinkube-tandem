/**
 * ProjectsTreeProvider must mark a space "open" by testing membership in
 * a freshly read set of open spaces per owner, never by comparing against
 * one remembered active slug — so two open tabs of one owner are both
 * marked, and a tab closed between two renders stops being marked on the
 * very next render.
 *
 * The extension host (the real `vscode` module) is a platform this
 * repository does not own — src/hostui/projectsTree.ts imports it eagerly
 * at module scope (ProjectsTreeProvider extends vscode.TreeItem's family
 * of classes), so it cannot be loaded in a plain Node process without
 * either the real host or a fabricated stand-in for the whole vscode
 * namespace. Neither is a seam this repository defines, so this reads the
 * repository's own source text instead of executing it: a structural
 * check on the wiring, not a simulation of a platform we do not own.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const treeSrc = fs.readFileSync(path.join(REPO_ROOT, "src", "hostui", "projectsTree.ts"), "utf8");

function bodyOf(className: string): string {
  const marker = `class ${className}`;
  const start = treeSrc.indexOf(marker);
  assert.ok(start >= 0, `projectsTree.ts must still declare ${className}`);
  const braceOpen = treeSrc.indexOf("{", start);
  let depth = 0;
  let i = braceOpen;
  for (; i < treeSrc.length; i++) {
    if (treeSrc[i] === "{") depth++;
    else if (treeSrc[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return treeSrc.slice(braceOpen, i + 1);
}

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
  const ctorMatch = treeSrc.match(/constructor\s*\(([\s\S]*?)\)\s*\{/);
  assert.ok(ctorMatch, "ProjectsTreeProvider must still declare a constructor");
  const ctorParams = ctorMatch![1];

  assert.doesNotMatch(
    ctorParams,
    /activeSpace:\s*\([^)]*\)\s*=>\s*string\s*\|\s*undefined/,
    "the constructor must no longer accept a single-slug `() => string | undefined` reader for open spaces — a lone slug cannot represent two open tabs of one owner",
  );
});

test("a closed tab's space is no longer marked open because getChildren re-reads the open-space source on every call, never a value captured once", () => {
  const providerBody = bodyOf("ProjectsTreeProvider");
  const ctorMatch = providerBody.match(/constructor\s*\(([\s\S]*?)\)\s*\{/);
  assert.ok(ctorMatch, "ProjectsTreeProvider must still declare a constructor");

  // The constructor must not snapshot the open-space source into a plain
  // field at construction time — the tree is rebuilt from a live query on
  // every render, so a tab closed between two renders must be reflected on
  // the very next one. A `private readonly openSpaces = ...(fixed value)`
  // captured once would let a closed tab's dot outlive the tab itself.
  const ctorBodyStart = providerBody.indexOf("{", providerBody.indexOf("constructor"));
  let depth = 0;
  let j = ctorBodyStart;
  for (; j < providerBody.length; j++) {
    if (providerBody[j] === "{") depth++;
    else if (providerBody[j] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const ctorBody = providerBody.slice(ctorBodyStart, j + 1);
  assert.doesNotMatch(
    ctorBody,
    /this\.\w+\s*=\s*\w+\(\)/,
    "the constructor must not call an open-space reader and store its RESULT on `this` — that would freeze the open set at construction time instead of re-reading it on every render",
  );

  // getChildren must mark a space open by testing membership (an open SET
  // can drop an entry the moment its tab closes) rather than equality to
  // one remembered value (which cannot represent "was open, now isn't"
  // for anything but the single slug it already held).
  const getChildrenStart = providerBody.indexOf("getChildren(");
  assert.ok(getChildrenStart >= 0, "ProjectsTreeProvider must still declare getChildren");
  const getChildrenBody = providerBody.slice(getChildrenStart);

  assert.match(
    getChildrenBody,
    /\.(includes|has)\(/,
    "getChildren must mark a space open by testing membership in a freshly read open-space collection (.includes/.has), so a space dropped from that collection when its tab closes is no longer marked",
  );
});
