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
import { rehouseChecks, unreachableCheckHomes } from "./checkHomes";

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

/**
 * Where a check may live.
 *
 * Beside the repository's own tests — because that is the one place its
 * runner already reaches. A repository with no tests of its own refuses
 * nothing, since there is no convention to break; production paths are
 * never judged as homes at all; and a check placed where nothing can run
 * it is refused before anybody is graded on it.
 */
test("a check is placed where this repository already runs tests, or not at all", () => {
  {
  const repoFiles = [
    "src/hygiene.test.ts",
    "src/run/plan.test.ts",
    "src/surfaces/panel.ts",
    "webview/map/src/Rail.tsx",
  ];
  const slices = [
    { handle: "SL-14", workUnits: [{ role: "test", footprint: ["webview/map/src/Rail_AC-1.test.ts"] }] },
  ];
  const v = unreachableCheckHomes(slices, repoFiles);
  assert.deepEqual(v.where, ["SL-14: webview/map/src/Rail_AC-1.test.ts"]);
  assert.deepEqual(v.roots, ["src"]);
  }
  {
  const repoFiles = ["src/hygiene.test.ts", "src/run/plan.test.ts"];
  const slices = [
    { handle: "SL-14", workUnits: [{ role: "test", footprint: ["src/surfaces/Rail_AC-1.test.ts"] }] },
  ];
  assert.deepEqual(unreachableCheckHomes(slices, repoFiles).where, []);
  }
  {
  const slices = [
    { handle: "SL-1", workUnits: [{ role: "test", footprint: ["anywhere/thing_AC-1.test.ts"] }] },
  ];
  const v = unreachableCheckHomes(slices, ["src/index.ts", "README.md"]);
  assert.deepEqual(v.where, [], "the first test a repository ever gets must be allowed to land");
  assert.deepEqual(v.roots, []);
  }
  {
  const repoFiles = ["src/hygiene.test.ts"];
  const slices = [
    { handle: "SL-2", workUnits: [{ role: "code", footprint: ["webview/map/src/Rail.tsx"] }] },
  ];
  assert.deepEqual(unreachableCheckHomes(slices, repoFiles).where, []);
  }
  {
  const repoFiles = [
    "src/hygiene.test.ts",
    "src/surfaces/inbound.test.ts",
    "src/surfaces/panel.ts",
    "webview/map/src/Rail.tsx",
  ];
  const slices = [
    {
      handle: "SL-14",
      workUnits: [
        { role: "code", footprint: ["webview/map/src/Rail.tsx", "src/surfaces/panel.ts"] },
        { role: "test", footprint: ["probes/rail_AC-1.test.ts"] },
      ],
    },
  ];
  rehouseChecks(slices as never, repoFiles);
  const home = (slices[0].workUnits[1] as { footprint: string[] }).footprint[0];
  assert.equal(home.split("/")[0], "src", `minted at ${home}, which nothing compiles`);
  assert.deepEqual(unreachableCheckHomes(slices as never, repoFiles).where, []);
  }
});




