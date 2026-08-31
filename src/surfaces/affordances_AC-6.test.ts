/**
 * TRANSITION — missingDoors becomes a seam a test can drive directly, fed a
 * surface text and a door list rather than reading the AFFORDANCES registry
 * and a bundle file itself.
 *
 * Before this change the function's behaviour could only be observed
 * indirectly. This pins that a door whose handle AND quoted action are both
 * absent from the given surface text comes back as missing, and a door
 * whose handle is present does not. Its job is done once missingDoors takes
 * surface text and a door list as its own arguments.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { missingDoors, Door } from "./doors";

function doorFor(action: string): Door {
  return {
    action,
    page: "work",
    label: "the work page",
    gesture: `press ${action}`,
    handle: `data-${action}`,
  };
}

test("missingDoors returns a door whose handle and quoted action are both absent from the surface text", () => {
  const door = doorFor("build");
  const surfaceText = "<div>nothing relevant here</div>";

  const missing = missingDoors(surfaceText, [door]);

  assert.equal(missing.length, 1, "the door with no handle and no quoted action anywhere in the text is missing");
  assert.equal(missing[0].action, "build");
});

test("missingDoors returns nothing for a door whose handle is present", () => {
  const door = doorFor("build");
  const surfaceText = `<button data-build>Build</button>`;

  const missing = missingDoors(surfaceText, [door]);

  assert.deepEqual(missing, [], "a door whose handle appears in the surface text is not reported missing");
});
