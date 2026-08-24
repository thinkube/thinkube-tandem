/**
 * Where the engine-wiring ledger lives: ENGINE-WIRING.md sits at the
 * repository root (its own cut writes no docs/ path), so the one rule that
 * decides whether a cut is documented must still recognise it as this
 * cut's documentation — by path, not by prefix — or the cut that writes it
 * is refused at signing for lacking the very documentation it delivers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { docsDutyOf } from "./docsDuty";
import type { Change } from "./schema";

/** A change grounded solely at the repository-root engine-wiring ledger. */
function changeGroundedAt(path: string): Change {
  return {
    id: "n1",
    sentence: "write the engine-wiring ledger",
    serves: [],
    needs: [],
    grounding: { touchpoints: [{ path }], stamp: [] },
    acceptance: [],
  };
}

// TRANSITION: before this slice, docsDutyOf only recognised paths under
// docs/ — a cut whose sole documentation is the root-level ENGINE-WIRING.md
// ledger read as undocumented and would be refused at signing. This proves
// the rule now names that ledger as the cut's documentation instead.
test("docsDutyOf reports a cut documented by ENGINE-WIRING.md at the repository root, naming that path", () => {
  const duty = docsDutyOf([changeGroundedAt("ENGINE-WIRING.md")]);
  assert.equal(duty.status, "documented");
  assert.ok(
    "paths" in duty && duty.paths.includes("ENGINE-WIRING.md"),
    `expected ENGINE-WIRING.md among the reported documentation paths, got ${JSON.stringify(duty)}`,
  );
});

// INVARIANT: the ledger is recognised for what it is (a root-level ledger
// this rule counts), not merely because its name happens to match — a
// change grounded elsewhere at the root, with no docs/ touchpoint and no
// waiver, must still be reported unmet. This keeps the root-level carve-out
// narrow instead of quietly accepting any root file as documentation.
test("docsDutyOf still reports unmet for a cut grounded only at an unrelated root-level file", () => {
  const duty = docsDutyOf([changeGroundedAt("README.md")]);
  assert.equal(duty.status, "unmet");
});
