/**
 * The roles, and the shape of the paths each may hold.
 *
 * The coder never writes a check and the maintainer writes nothing else.
 * Both halves are decided from the plan before any worker starts, so a
 * plan that breaks them is refused rather than discovered by a worker
 * grinding against a fence it cannot see.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { coderTestPaths, isMaintainUnit } from "./plan";

/**
 * A maintainer owns test-shaped paths — that is what it is for. A check
 * born in the repository's own idiom is named `<stem>_AC-<k>`, so it is a
 * test home AND answers to the probe shape at once. A maintainer holding
 * one standing test beside one new check must still read as a maintainer:
 * read as a coder, the plan refuses itself before dispatch, and had it
 * passed, the unit would be briefed as a coder and refused again for
 * reading a check.
 */
test("a maintainer that owns a newly born check is not read as a coder", () => {
  const maintainer = {
    role: undefined,
    footprint: ["src/hygiene.test.ts", "src/surfaces/inbound_AC-1.test.ts"],
  };
  assert.equal(isMaintainUnit(maintainer), true);

  // One whose whole footprint is newly born checks is a maintainer too.
  assert.equal(isMaintainUnit({ footprint: ["src/surfaces/signedIdle_AC-1.test.ts"] }), true);

  // A coder holding one test-shaped path is still refused — the rule the
  // roles rest on is untouched.
  assert.equal(isMaintainUnit({ footprint: ["src/surfaces/panel.ts", "src/panel_AC-1.test.ts"] }), false);

  const slices = [
    { handle: "SL-9-tests", workUnits: [maintainer] },
    { handle: "SL-16-tests", workUnits: [{ footprint: ["src/surfaces/signedIdle_AC-1.test.ts"] }] },
  ] as unknown as Parameters<typeof coderTestPaths>[0];
  assert.deepEqual(coderTestPaths(slices), []);
});

test("a coder handed a test is still refused before dispatch", () => {
  const slices = [
    { handle: "SL-3", workUnits: [{ footprint: ["src/surfaces/panel.ts", "src/surfaces/panel_AC-1.test.ts"] }] },
  ] as unknown as Parameters<typeof coderTestPaths>[0];
  assert.deepEqual(coderTestPaths(slices), ["SL-3#eu-0: src/surfaces/panel_AC-1.test.ts"]);
});
