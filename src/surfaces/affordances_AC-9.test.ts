/**
 * INVARIANT — with no surface text to check against, verifiedDoors must
 * return no door at all, never every declared door treated as if it had
 * been proved.
 *
 * Absence of proof is not proof of presence: a caller with nothing built to
 * check against must never be told every door verified, or a delivery page
 * rendered before any build exists would print "see it" lines for doors
 * nobody has shown render. This must hold for as long as verifiedDoors
 * exists.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifiedDoors } from "./doors";
import { AFFORDANCES } from "./affordances";

test("verifiedDoors called with no surface text returns no door at all", () => {
  const humanCount = Object.values(AFFORDANCES).filter((e) => e.kind === "human").length;
  assert.ok(humanCount > 0, "set up: the registry declares at least one human door");

  const verified = verifiedDoors(undefined);

  assert.deepEqual(verified, [], "no surface text means nothing is proved — not every declared door");
});
