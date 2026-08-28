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
 * A check must be born where the repository can run it.
 *
 * SL-14's production code was correct and its checks were sound, but they
 * were written under `webview/map/src/`, which no build compiles: the
 * suite compiles `src` and runs `out-test/`. The checks emitted no `.js`,
 * matched nothing the runner looked at, and could never turn green. The
 * worker could not fix it — a build configuration is outside any worker's
 * clearance — so it declared UNDELIVERED, and five maintainers blocked
 * behind the unit that was failed for work that was right.
 */
test("a check born where the repository runs no test is refused", () => {
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
});

test("a check beside the repository's own tests is allowed", () => {
  const repoFiles = ["src/hygiene.test.ts", "src/run/plan.test.ts"];
  const slices = [
    { handle: "SL-14", workUnits: [{ role: "test", footprint: ["src/surfaces/Rail_AC-1.test.ts"] }] },
  ];
  assert.deepEqual(unreachableCheckHomes(slices, repoFiles).where, []);
});

test("a repository with no tests of its own refuses no placement", () => {
  const slices = [
    { handle: "SL-1", workUnits: [{ role: "test", footprint: ["anywhere/thing_AC-1.test.ts"] }] },
  ];
  const v = unreachableCheckHomes(slices, ["src/index.ts", "README.md"]);
  assert.deepEqual(v.where, [], "the first test a repository ever gets must be allowed to land");
  assert.deepEqual(v.roots, []);
});

test("production paths are never judged as check homes", () => {
  const repoFiles = ["src/hygiene.test.ts"];
  const slices = [
    { handle: "SL-2", workUnits: [{ role: "code", footprint: ["webview/map/src/Rail.tsx"] }] },
  ];
  assert.deepEqual(unreachableCheckHomes(slices, repoFiles).where, []);
});

/**
 * A slice whose work spans two trees mints its check where the repository
 * can run it.
 *
 * SL-14 changed a view under webview/map/src/ and its host under
 * src/surfaces/. Taking whichever code file came first put the check in
 * the view's tree, which no build compiles — so it emitted no runnable
 * file and failed a unit whose code was right. The fix was a build
 * configuration no worker is cleared for, so the round was unwinnable.
 */
test("a check is minted beside code the repository can run a test for", () => {
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
});
