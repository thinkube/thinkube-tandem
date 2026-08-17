import { test } from "node:test";
import assert from "node:assert/strict";
import { missingModulesIn, treeNotReady } from "./repair";

test("a missing module that another unit will still create is the tree not being ready — from a build, a relative import, or a runner's own words", () => {
  const pending = ["src/engine/engineWiring.ts", "src/core/docHomes.ts"];
  const build = {
    kind: "build-failed" as const,
    testFault: false,
    errorFiles: ["src/engine/engineWiring.test.ts"],
    output: "src/engine/engineWiring.test.ts(3,40): error TS2307: Cannot find module './engineWiring' or its corresponding type declarations.",
  };
  assert.deepEqual(treeNotReady(build, pending, build.errorFiles), ["src/engine/engineWiring.ts"], "a relative import resolves against the erroring file");
  const run = {
    kind: "results" as const,
    results: [{ ac: 1, pass: false, evidence: "$ node --test p.mjs → exit 1\nthe runner said, before any test ran:\n  Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/runner/out-test/core/docHomes.js' imported from /runner/probes/p.mjs" }],
  };
  assert.deepEqual(treeNotReady(run, pending), ["src/core/docHomes.ts"], "a compiled path maps back to the planned source");
  assert.deepEqual(treeNotReady(run, ["src/other.ts"]), [], "a missing module nobody plans is not the tree's");
  assert.deepEqual(missingModulesIn("Cannot find module 'a' and Cannot find module './b'"), ["a", "./b"]);
});
