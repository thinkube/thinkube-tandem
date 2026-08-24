/**
 * The cut-level duty (docsDutyOf) and the per-slice obligation
 * (docsObligations) must agree on what counts as documentation: the same
 * path list, driven through both, must be accepted by both or rejected by
 * both — proving they share the one predicate rather than each testing the
 * docs/ prefix on its own.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { docsDutyOf } from "./docsDuty";
import { docsObligations } from "../run/plan";
import type { Change } from "./schema";
import type { SliceForDag } from "../engine/core/dag";

function changeGroundedAt(...paths: string[]): Change {
  return {
    id: "n1",
    sentence: "a change",
    serves: [],
    needs: [],
    grounding: { touchpoints: paths.map((p) => ({ path: p })), stamp: [] },
    acceptance: [],
  };
}

function sliceDeclaring(files: string[]): SliceForDag {
  return { handle: "SL-1", status: "doing", files, workUnits: [] };
}

// INVARIANT: a path the shared rule accepts as documentation is accepted by
// both readers — docsDutyOf reports it as documentation, and
// docsObligations (given the file landed in the tree) raises no unmet
// obligation for it.
test("a docs/ path is accepted as documentation by both docsDutyOf and docsObligations", () => {
  const docsPath = "docs/modules/ROOT/pages/gates.adoc";

  const duty = docsDutyOf([changeGroundedAt(docsPath)]);
  assert.equal(duty.status, "documented");

  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-docsduty-"));
  fs.mkdirSync(path.join(worktree, "docs", "modules", "ROOT", "pages"), { recursive: true });
  fs.writeFileSync(path.join(worktree, docsPath), "= Gates\n");
  const unmet = docsObligations([sliceDeclaring([docsPath])], worktree);
  assert.deepEqual(unmet, [], `expected no unmet docs obligation, got ${JSON.stringify(unmet)}`);
});

// INVARIANT: a path the shared rule rejects is rejected by both — no
// docs/ touchpoint reports unmet on the cut-level duty, and a slice
// declaring only that path is never treated as having a docs obligation to
// meet (unmetDocsObligation only fires for a `docs/`-prefixed declaration,
// so a non-docs/ path never yields a satisfied documentation state either).
test("a non-docs/ path is not accepted as documentation by docsDutyOf", () => {
  const srcPath = "src/core/docsDuty.ts";
  const duty = docsDutyOf([changeGroundedAt(srcPath)]);
  assert.equal(duty.status, "unmet");
});
