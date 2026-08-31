/**
 * TRANSITION — when the built surface is absent, the door proof says so
 * plainly instead of reporting every door as verified — the opposite of
 * what an absent build should ever be read as proving.
 *
 * This pins the negative path beside AC-18's positive one: builtSurfaceText
 * given a reader that fails (the shape of a missing build) returns empty
 * string, and verifiedDoors driven from that empty text reports no door
 * verified at all, never every declared door.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { builtSurfaceText, verifiedDoors } from "./doors";
import { AFFORDANCES } from "./affordances";

test("when the built surface is absent, the check says so plainly and does not report every door as verified", () => {
  const humanCount = Object.values(AFFORDANCES).filter((e) => e.kind === "human").length;
  assert.ok(humanCount > 0, "set up: at least one human door is declared");

  const builtText = builtSurfaceText(() => {
    throw new Error("ENOENT: media/map/index.html not found — run npm run compile");
  });
  assert.equal(builtText, "", "an absent build reads as empty text, not a thrown error swallowed into a false positive");

  const verified = verifiedDoors(builtText);

  assert.deepEqual(verified, [], "an absent build verifies no door — never every declared door as if it had been proved");
});
