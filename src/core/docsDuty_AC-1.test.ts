/**
 * A cut that writes documentation must be reported as documented, and the
 * report must name every docs/ path a member's grounding touches — not just
 * that one exists — so the cut review and the TEP body can list them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { docsDutyOf } from "./docsDuty";
import type { Change } from "./schema";

/** A change grounded at the given touchpoint paths. */
function changeGroundedAt(...paths: string[]): Change {
  return {
    id: "n1",
    sentence: "a change",
    serves: [],
    needs: [],
    grounding: { touchpoints: paths.map((path) => ({ path })), stamp: [] },
    acceptance: [],
  };
}

// TRANSITION: docsDutyOf is new in this slice. This proves its first duty:
// a single docs/ touchpoint on a single member is reported as documented,
// naming that path.
test("docsDutyOf reports documented, naming the docs/ path, for a member grounded under docs/", () => {
  const duty = docsDutyOf([changeGroundedAt("docs/modules/ROOT/pages/gates.adoc")]);
  assert.equal(duty.status, "documented");
  assert.ok(
    "paths" in duty && duty.paths.includes("docs/modules/ROOT/pages/gates.adoc"),
    `expected the docs/ path among reported paths, got ${JSON.stringify(duty)}`,
  );
});

// INVARIANT: every docs/ path across every member is listed — not just the
// first one found — so a reviewer sees the whole documentation footprint of
// the cut, and a path from a second member is not dropped.
test("docsDutyOf lists every docs/ path across every member", () => {
  const members = [
    changeGroundedAt("docs/a.adoc", "src/x.ts"),
    changeGroundedAt("docs/b.adoc"),
  ];
  const duty = docsDutyOf(members);
  assert.equal(duty.status, "documented");
  assert.ok("paths" in duty);
  const paths = "paths" in duty ? duty.paths : [];
  assert.ok(paths.includes("docs/a.adoc"), `missing docs/a.adoc in ${JSON.stringify(paths)}`);
  assert.ok(paths.includes("docs/b.adoc"), `missing docs/b.adoc in ${JSON.stringify(paths)}`);
  assert.ok(!paths.includes("src/x.ts"), `non-docs path leaked into ${JSON.stringify(paths)}`);
});

// INVARIANT: any single member holding a docs/ touchpoint is enough — the
// duty is documented even when other members ground only src/ paths.
test("docsDutyOf is documented when only one of several members grounds a docs/ path", () => {
  const members = [changeGroundedAt("src/only.ts"), changeGroundedAt("docs/only.adoc")];
  const duty = docsDutyOf(members);
  assert.equal(duty.status, "documented");
});
