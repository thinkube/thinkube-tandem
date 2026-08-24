/**
 * The provisions preflight is a GUARD, and a guard nobody calls guards
 * nothing. These pin two halves of the same criterion:
 *
 *   1. What the guard refuses: an unresolvable parent TEP body — the one
 *      embedded intent artifact — and NOT a missing separate spec body,
 *      which no longer exists as a provision to be missing.
 *   2. That the guard is actually WIRED into the run's pre-dispatch path,
 *      so the refusal happens before a worker starts rather than surfacing
 *      as a red gate rounds later.
 *
 * STANDING INVARIANT — preflightProvisionFailures decides a run on the TEP
 * body, never on a separate spec body, and the dispatcher calls it before
 * dispatching any worker.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { preflightProvisionFailures } from "./preflight";

const provisionedUnit = {
  id: "SL-1#eu-1",
  slice: "SL-1",
  note: "do the thing",
  footprint: ["src/a.ts"],
  hasAuthoredUnits: true,
  multiUnitSlice: false,
};

test("a fully provisioned run, with no separate spec body anywhere, raises no failure", () => {
  const failures = preflightProvisionFailures({
    tepBody: "## The asks\nDo the thing.\n",
    implementsRef: "TEP-1",
    units: [provisionedUnit],
  });
  assert.deepEqual(
    failures,
    [],
    "the TEP body is the one intent artifact — nothing else may be demanded",
  );
});

test("an unresolvable TEP body is refused, and the message names the TEP as the one embedded intent artifact", () => {
  const failures = preflightProvisionFailures({
    tepBody: "   \n  ",
    implementsRef: "TEP-1",
    units: [provisionedUnit],
  });
  assert.equal(failures.length, 1, "exactly the TEP body failure");
  assert.match(failures[0]!, /parent TEP body unresolvable/i);
  assert.match(
    failures[0]!,
    /one intent artifact/i,
    "the message must explain the TEP is the single embedded intent artifact",
  );
  assert.doesNotMatch(
    failures[0]!,
    /spec body/i,
    "a missing separate spec body is not what this check reports",
  );
});

test("no failure message anywhere in the check demands a separate spec body", () => {
  const failures = preflightProvisionFailures({
    tepBody: "",
    implementsRef: undefined,
    units: [
      { ...provisionedUnit, note: "", footprint: [] },
      {
        id: "SL-2#eu-1",
        slice: "SL-2",
        note: "n",
        footprint: ["src/b.ts"],
        hasAuthoredUnits: true,
        multiUnitSlice: true,
      },
    ],
  });
  assert.ok(failures.length > 0, "this input is genuinely unprovisioned");
  for (const f of failures)
    assert.doesNotMatch(
      f,
      /\bspec body\b|\bspecBody\b/i,
      `no provision failure may be about a separate spec body: ${f}`,
    );
});

test("the dispatcher wires the provisions preflight into its pre-dispatch path", () => {
  // __dirname is this compiled test's own directory under out-test/engine/core/,
  // mirroring its source location under src/ — three source levels plus one for
  // out-test reaches the repo root, where the source tree is read.
  const repo = path.resolve(__dirname, "..", "..", "..", "..");
  const dispatchSrc = fs.readFileSync(
    path.join(repo, "src", "run", "dispatch.ts"),
    "utf8",
  );
  assert.match(
    dispatchSrc,
    /import\s*\{[^}]*\bpreflightProvisionFailures\b[^}]*\}\s*from\s*["'][^"']*preflight["']/,
    "dispatch.ts must import the provisions preflight",
  );
  assert.match(
    dispatchSrc,
    /\bpreflightProvisionFailures\s*\(/,
    "dispatch.ts must CALL the provisions preflight — an uncalled guard guards nothing",
  );
  // The call must precede the worker dispatch it is supposed to gate.
  const calledAt = dispatchSrc.indexOf("preflightProvisionFailures(");
  const dispatchedAt = dispatchSrc.indexOf("buildWorkerPrompt(");
  assert.ok(calledAt > 0 && dispatchedAt > 0);
  assert.ok(
    calledAt < dispatchedAt,
    "the provisions check must run BEFORE any worker prompt is built",
  );
});
