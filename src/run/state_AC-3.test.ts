/**
 * TRANSITION — tapGrades is a new wrapper: it must forward the per-AC
 * results of BOTH verify() and confirmGreen() to onGrade, while passing the
 * wrapped oracle's own verdict through unchanged — the grading tap must
 * never alter what the worker or the gate sees.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tapGrades } from "./oracle";
import type { VerifyOracle, VerifyResult } from "../engine/verifyOracle";

function fakeOracle(verdict: VerifyResult): VerifyOracle {
  return {
    verify: async () => verdict,
    invocations: () => 0,
    confirmGreen: async () => ({ green: verdict.kind === "results" && verdict.results.every((r) => r.pass), result: verdict }),
    last: () => undefined,
  } as unknown as VerifyOracle;
}

test("tapGrades reports verify()'s per-AC results to onGrade and returns the verdict unchanged", async () => {
  const verdict: VerifyResult = {
    kind: "results",
    results: [
      { ac: 1, pass: true, evidence: "$ ok" },
      { ac: 2, pass: false, evidence: "$ not ok" },
    ],
  };
  const seen: unknown[] = [];
  const wrapped = tapGrades(fakeOracle(verdict), (results) => seen.push(results));

  const out = await wrapped.verify();

  assert.deepEqual(out, verdict, "verify()'s own verdict travels through unchanged");
  assert.equal(seen.length, 1, "one grading was reported");
  assert.deepEqual(seen[0], verdict.results, "the results reported to onGrade match verify()'s own results");
});

test("tapGrades reports confirmGreen()'s per-AC results to onGrade and returns the verdict unchanged", async () => {
  const verdict: VerifyResult = {
    kind: "results",
    results: [{ ac: 1, pass: true, evidence: "$ ok" }],
  };
  const seen: unknown[] = [];
  const wrapped = tapGrades(fakeOracle(verdict), (results) => seen.push(results));

  const out = await wrapped.confirmGreen();

  assert.deepEqual(out, { green: true, result: verdict }, "confirmGreen()'s own verdict travels through unchanged");
  assert.equal(seen.length, 1, "one grading was reported");
  assert.deepEqual(seen[0], verdict.results, "the results reported to onGrade match confirmGreen()'s own results");
});
