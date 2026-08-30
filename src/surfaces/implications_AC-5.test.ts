/**
 * TRANSITION — the implication controls now have declared doors: before
 * this, a surface could stop rendering the apply/set-aside/apply-all
 * controls without the build noticing. verifiedDoors(), called with no
 * built surface to check against, must still list a human door for each
 * of accept-impact, dismiss-impact and apply-all-impacts — each naming the
 * surface it lives on and the gesture a person uses.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifiedDoors } from "../gates/doors";

test("verifiedDoors with no bundle lists a human door for accept-impact, dismiss-impact and apply-all-impacts", () => {
  const doors = verifiedDoors();
  const byAction = new Map(doors.map((d) => [d.action, d]));

  for (const action of ["accept-impact", "dismiss-impact", "apply-all-impacts"]) {
    const door = byAction.get(action);
    assert.ok(door, `verifiedDoors names a door for ${action}`);
    assert.ok(door!.surface && door!.surface.length > 0, `${action}'s door names the surface it lives on`);
    assert.ok(door!.gesture && door!.gesture.length > 0, `${action}'s door names the gesture a person uses`);
  }
});
