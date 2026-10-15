/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A challenge reaches the check it names, whatever suffix the repository's
 * tests wear.
 *
 * A check born in a Python test directory is `main_AC-2_test.py`: no dot
 * follows its ordinal. Looked up as `_AC-2.`, it was never found, every
 * challenge was answered "no check 2 exists on this slice", and a coder with
 * a correct implementation and a wrong check had no way out but UNDELIVERED.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { makeChallenge } from "./challenge";
import { checkOrdinalOf, isCheckOf } from "../core/testShape";

test("a check's ordinal is read whatever suffix follows it", () => {
  assert.equal(checkOrdinalOf("tests/main_AC-2_test.py"), 2);
  assert.equal(checkOrdinalOf("src/x_AC-12.test.ts"), 12);
  assert.equal(checkOrdinalOf("probes/space__SL-1_AC-3.test.mjs"), 3);
  assert.equal(checkOrdinalOf("tests/test_health.py"), undefined);
  assert.equal(isCheckOf("tests/main_AC-12_test.py", 1), false, "check 1 is not check 12");
});

test("a challenge to a Python check reaches the judge", async () => {
  const testerWt = fs.mkdtempSync(path.join(os.tmpdir(), "challenge-"));
  fs.mkdirSync(path.join(testerWt, "tests"));
  fs.writeFileSync(path.join(testerWt, "tests", "main_AC-2_test.py"), "def test_x():\n    assert False\n");
  let judged = "";
  const challenge = makeChallenge({
    testerWt,
    sliceProbes: new Map([["SL-1", ["tests/main_AC-1_test.py", "tests/main_AC-2_test.py"]]]),
    criterionOf: (_slice: string, ac: number) => (ac === 2 ? { id: "c-2", text: "the route declares its model" } : undefined),
    model: "sonnet",
    supervisorRound: async (_r: unknown, prompt: string) => {
      judged = prompt;
      return "FAITHFUL\nthe probe renders the criterion";
    },
    log: () => {},
    defect: () => {},
  } as never)("SL-1", () => ({ kind: "results", results: [{ ac: 2, pass: false, evidence: "AssertionError: no /health route" }] }));
  const reply = await challenge(2, "the route is registered under an included router");
  assert.match(reply, /^DENIED/, `the judge ruled; got: ${reply}`);
  assert.match(judged, /assert False/, "the judge saw the Python check's source");
});
