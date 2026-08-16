import { test } from "node:test";
import assert from "node:assert/strict";
import { evidenceKey, failuresByOwner, ownerOf } from "./owner";

const importFailure = [
  "$ node --test probes/x.test.mjs → exit 1",
  "the runner said, before any test ran:",
  "  Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/runner/out/core/schema.js' imported from /runner/probes/x.test.mjs",
  "  code: 'ERR_MODULE_NOT_FOUND',",
  "failing tests:",
  "  - /runner/probes/x.test.mjs",
].join("\n");

test("every failure has an owner: a check that could not run is the check's, an assertion is the code's, a missing tool is the environment's", () => {
  assert.equal(ownerOf(importFailure), "check");
  assert.equal(ownerOf("$ node --test p.mjs → exit 124\n[timed out after 600000 ms]"), "check");
  assert.equal(
    ownerOf("$ node --test p.mjs → exit 1\nfailing tests:\n  - greet returns hello\nnot ok 1 - greet returns hello\n  error: expected 'hello' got 'hi'"),
    "code",
  );
  assert.equal(ownerOf("$ npx tsc -p t.json → exit 127\nsh: 1: tsc: not found"), "environment");
});

test("the same failure has the same key across rounds; times and paths do not make it new", () => {
  const a = evidenceKey(importFailure + "\n  duration_ms: 57.25");
  const b = evidenceKey(importFailure.replace("/runner/", "/tmp/other-runner-9/") + "\n  duration_ms: 61.02");
  assert.equal(a, b, "a path or a duration is not a new failure");
  assert.notEqual(a, evidenceKey("not ok 1 - greet\n  error: expected 'hello' got 'hi'"), "a different error is a different failure");
});

test("a round's failures come back grouped by owner", () => {
  const owners = failuresByOwner({
    kind: "results",
    results: [
      { ac: 1, pass: true, evidence: "$ x → exit 0" },
      { ac: 2, pass: false, evidence: importFailure },
      { ac: 3, pass: false, evidence: "$ x → exit 1\nnot ok 1 - it\n  error: expected 1 got 2" },
    ],
  } as never);
  assert.deepEqual(owners.map((o) => [o.ac, o.owner]), [[2, "check"], [3, "code"]]);
});
