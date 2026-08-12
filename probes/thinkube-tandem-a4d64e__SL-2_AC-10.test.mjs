// AC-10 (INVARIANT): folding two authors' records where one holds a cut
// undecided and the other holds it waived with a reason must not drop the
// waiver — first-writer-wins would silently discard the second author's
// documentation decision, which is exactly the loss the fold must avoid.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { emptySpace } = require("../out/core/schema.js");
const { foldSpaces } = require("../out/core/records.js");

function baseSpace() {
  return {
    ...emptySpace(),
    asks: [{ id: "ask-1", text: "add a CSV importer", at: "2026-08-01T00:00:00Z" }],
    nodes: [
      {
        id: "node-1",
        sentence: "a file picker imports a CSV into the table",
        serves: ["ask-1"],
        needs: [],
        acceptance: [{ id: "c1", text: "a CSV imports into the table" }],
        grounding: { touchpoints: [{ path: "src/import/csv.ts" }], stamp: [] },
      },
    ],
  };
}

test("folding an undecided cut against a waived one (same id) carries the waiver and its reason", () => {
  // Same cut id from both authors: alice never touched the documentation
  // decision, bob recorded a waiver with a reason. The fold must not let
  // alice's untouched record (first in fold order) silently win and drop
  // bob's waiver.
  const undecided = { id: "cut-1", changeIds: ["node-1"] };
  const waived = { id: "cut-1", changeIds: ["node-1"], docs: { waived: true, reason: "importer is dev-only tooling" } };

  const recA = {
    at: "2026-08-01T00:00:00Z",
    author: "alice",
    kind: "snapshot",
    space: { ...baseSpace(), cuts: [undecided] },
    cut: [],
  };
  const recB = {
    at: "2026-08-01T00:00:01Z",
    author: "bob",
    kind: "snapshot",
    space: { ...baseSpace(), cuts: [waived] },
    cut: [],
  };

  const folded = foldSpaces([recA, recB]);
  const cut = folded.cuts.find((c) => c.id === "cut-1" || c.id.startsWith("cut-1"));
  assert.ok(cut, "the cut survives the fold");
  assert.ok(
    cut.docs && cut.docs.waived && cut.docs.reason === "importer is dev-only tooling",
    "the waiver and its reason are not dropped by first-writer-wins",
  );
});

test("folding the same cut id waived with DIFFERENT reasons does not silently pick one", () => {
  const waivedA = { id: "cut-2", changeIds: ["node-1"], docs: { waived: true, reason: "no user-facing docs needed" } };
  const waivedB = { id: "cut-2", changeIds: ["node-1"], docs: { waived: true, reason: "already covered in the README" } };

  const recA = {
    at: "2026-08-01T00:00:00Z",
    author: "alice",
    kind: "snapshot",
    space: { ...baseSpace(), cuts: [waivedA] },
    cut: [],
  };
  const recB = {
    at: "2026-08-01T00:00:01Z",
    author: "bob",
    kind: "snapshot",
    space: { ...baseSpace(), cuts: [waivedB] },
    cut: [],
  };

  const folded = foldSpaces([recA, recB]);
  // The collision must be qualified (distinct cuts survive under distinct
  // ids) or surfaced as a conflict — never unified into one reason chosen
  // by merge order.
  const reasons = new Set(
    folded.cuts.filter((c) => c.docs && c.docs.waived).map((c) => c.docs.reason),
  );
  const surfacedAsQuestion = (folded.questions ?? []).some((q) =>
    q.text.includes("no user-facing docs needed") && q.text.includes("already covered in the README"),
  );
  assert.ok(
    (reasons.has("no user-facing docs needed") && reasons.has("already covered in the README")) ||
      surfacedAsQuestion,
    "a contradictory waiver reason is qualified or surfaced, never resolved by merge order alone",
  );
});
