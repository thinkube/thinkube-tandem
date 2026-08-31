/**
 * TRANSITION — tapGrades must stay silent for verdicts that carry no
 * per-AC results (build-failed, stalled, exhausted): reporting a grade for
 * one of these would tell the audit card a slice's criteria were judged
 * when nothing was actually checked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tapGrades } from "./oracle";
import type { VerifyOracle, VerifyResult } from "../engine/verifyOracle";

function fakeOracle(verdict: VerifyResult): VerifyOracle {
  return {
    verify: async () => verdict,
    invocations: () => 0,
    confirmGreen: async () => ({ green: false, result: verdict }),
    last: () => undefined,
  } as unknown as VerifyOracle;
}

test("tapGrades reports nothing to onGrade for a build-failed verdict", async () => {
  const seen: unknown[] = [];
  const wrapped = tapGrades(
    fakeOracle({ kind: "build-failed", testFault: false, errorFiles: [], output: "" }),
    (results) => seen.push(results),
  );

  await wrapped.verify();

  assert.deepEqual(seen, [], "build-failed carries no per-AC results to grade");
});

test("tapGrades reports nothing to onGrade for a stalled verdict", async () => {
  const seen: unknown[] = [];
  const wrapped = tapGrades(fakeOracle({ kind: "stalled", rounds: 3 }), (results) => seen.push(results));

  await wrapped.verify();

  assert.deepEqual(seen, [], "stalled carries no per-AC results to grade");
});

test("tapGrades reports nothing to onGrade for an exhausted verdict", async () => {
  const seen: unknown[] = [];
  const wrapped = tapGrades(fakeOracle({ kind: "exhausted", invocations: 20 }), (results) => seen.push(results));

  await wrapped.verify();

  assert.deepEqual(seen, [], "exhausted carries no per-AC results to grade");
});
