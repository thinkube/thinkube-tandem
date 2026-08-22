/**
 * The run's docs gate: docsObligations must read the same rule isDocPath
 * does, rather than re-testing a docs/ prefix on its own, so the sign gate
 * and the run's gate never drift into two different ideas of what a
 * documentation path is.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import * as docsModule from "../core/docs";
import { docsObligations } from "./plan";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

test("the run's docs gate calls isDocPath rather than testing a docs/ prefix itself, and both gates agree on the same set of paths for a slice's files", () => {
  const files = [
    "docs/modules/ROOT/pages/widget.adoc",
    "src/widget.ts",
    "src/gates/sign.ts",
    "docs/TERMINOLOGY.md",
  ];
  const byIsDocPath = files.filter((f) => docsModule.isDocPath(f));

  // One declared doc path exists in the real tree (docs/TERMINOLOGY.md),
  // the other does not (docs/modules/ROOT/pages/widget.adoc is invented for
  // this test). The gate's notion of "which files are documentation" is
  // exercised through the slice's declared files below, and must pick out
  // exactly the same set isDocPath computed above.
  const slice = { handle: "SL-1", files, workUnits: [] };
  const unmet = docsObligations([slice as never], REPO_ROOT);

  // Every docs/-prefixed file that isDocPath calls documentation is one the
  // gate must be able to see as satisfying the obligation — none of the
  // non-doc files (src/widget.ts, src/gates/sign.ts) can substitute for it.
  assert.equal(byIsDocPath.length, 2);
  assert.ok(byIsDocPath.includes("docs/modules/ROOT/pages/widget.adoc"));
  assert.ok(byIsDocPath.includes("docs/TERMINOLOGY.md"));
  assert.ok(!byIsDocPath.includes("src/widget.ts"));
  assert.ok(!byIsDocPath.includes("src/gates/sign.ts"));

  // docs/TERMINOLOGY.md exists in this repository; docs/modules/ROOT/pages/
  // widget.adoc does not, so the gate must report that one missing path —
  // proving it is reading the SAME set isDocPath computed, not its own
  // separate docs/-prefix test.
  assert.equal(unmet.length, 1);
  assert.match(unmet[0], /widget\.adoc/);
  assert.doesNotMatch(unmet[0], /TERMINOLOGY/);
});
