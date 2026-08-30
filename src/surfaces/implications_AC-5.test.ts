/**
 * TRANSITION — the implication controls now have declared doors: before
 * this, a surface could stop rendering the apply/set-aside/apply-all
 * controls without the build noticing. declaredDoors() must still list a
 * human door for each of accept-impact, dismiss-impact and
 * apply-all-impacts — each naming the page it lives on and the gesture a
 * person uses.
 *
 * This used to be pinned on verifiedDoors() called with no bundle: an
 * earlier rule treated "nobody looked" as "assume present" and handed back
 * every declared door. verifiedDoors() now proves a door only by finding
 * it in a real surface, so with no bundle it verifies nothing at all — the
 * registry-level claim these three doors exist is pinned on declaredDoors()
 * instead, which is what verifiedDoors filters.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { declaredDoors, verifiedDoors } from "../gates/doors";

test("declaredDoors lists a human door for accept-impact, dismiss-impact and apply-all-impacts", () => {
  const doors = declaredDoors();
  const byAction = new Map(doors.map((d) => [d.action, d]));

  for (const action of ["accept-impact", "dismiss-impact", "apply-all-impacts"]) {
    const door = byAction.get(action);
    assert.ok(door, `declaredDoors names a door for ${action}`);
    assert.ok(door!.page && door!.page.length > 0, `${action}'s door names the page it lives on`);
    assert.ok(door!.gesture && door!.gesture.length > 0, `${action}'s door names the gesture a person uses`);
  }
});

test("verifiedDoors with no bundle verifies nothing — a door is proved by finding it, not assumed", () => {
  const doors = verifiedDoors();
  assert.deepEqual(doors, [], "no surface text means nothing was looked at, so nothing is verified");
});
