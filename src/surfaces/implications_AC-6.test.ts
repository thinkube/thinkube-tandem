/**
 * INVARIANT — a declared door is only "verified" when the built surface
 * text actually carries it: for each of accept-impact, dismiss-impact and
 * apply-all-impacts, verifiedDoors() omits that action's door when the
 * given bundle text is missing its marker string, and includes it once the
 * bundle text contains both that marker AND the handle of the page the
 * door lives on — accept-impact, dismiss-impact and apply-all-impacts all
 * live on the write page (`data-write-page`), per the affordance registry.
 * A control's own marker is no longer enough by itself: a door needs its
 * page to render too, or it is not a way in.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifiedDoors } from "../gates/doors";

const ACTIONS = ["accept-impact", "dismiss-impact", "apply-all-impacts"] as const;
const PAGE_HANDLE = "data-write-page";

for (const action of ACTIONS) {
  test(`verifiedDoors omits ${action}'s door when its marker is absent from the bundle`, () => {
    const bundleWithoutThisOne = [
      PAGE_HANDLE,
      ...ACTIONS.filter((a) => a !== action).map((a) => `data-${a}`),
    ].join(" ");

    const doors = verifiedDoors(bundleWithoutThisOne);

    assert.ok(
      !doors.some((d) => d.action === action),
      `${action}'s door is omitted when the bundle carries none of its marker strings`,
    );
  });

  test(`verifiedDoors includes ${action}'s door when its marker is present in the bundle`, () => {
    const bundleWithAll = [PAGE_HANDLE, ...ACTIONS.map((a) => `data-${a}`)].join(" ");

    const doors = verifiedDoors(bundleWithAll);

    assert.ok(
      doors.some((d) => d.action === action),
      `${action}'s door is included once the bundle carries its marker string`,
    );
  });
}
