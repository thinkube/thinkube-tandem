/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the coder's challenge tool says about its budget is what the run
 * counts: one constant, per check.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CHALLENGE_BUDGET, CHALLENGE_TOOL_TEXT } from "./challengeBudget";
import { makeChallenge } from "./challenge";

test("the tool's text states the budget the run counts, per check", () => {
  assert.ok(CHALLENGE_TOOL_TEXT.endsWith(`Budget: ${CHALLENGE_BUDGET} per check.`), CHALLENGE_TOOL_TEXT);
  assert.doesNotMatch(CHALLENGE_TOOL_TEXT, /per slice/);
});

test("the budget is spent per check: a spent check refuses, another check still reaches the judge", async () => {
  const testerWt = fs.mkdtempSync(path.join(os.tmpdir(), "budget-"));
  fs.mkdirSync(path.join(testerWt, "tests"));
  for (const ac of [1, 2]) fs.writeFileSync(path.join(testerWt, "tests", `x_AC-${ac}_test.py`), "def test_x():\n    assert False\n");
  let judged = 0;
  const challenge = makeChallenge({
    testerWt,
    worktree: testerWt,
    exec: async () => ({ code: 0, out: "" }),
    sliceProbes: new Map([["SL-1", ["tests/x_AC-1_test.py", "tests/x_AC-2_test.py"]]]),
    criterionOf: (_slice: string, ac: number) => ({ id: `c-${ac}`, text: `criterion ${ac}` }),
    model: "sonnet",
    supervisorRound: async () => {
      judged++;
      return "FAITHFUL\nthe probe renders the criterion";
    },
    log: () => {},
    defect: () => {},
  } as never)("SL-1", () => ({
    kind: "results",
    results: [
      { ac: 1, pass: false, evidence: "AssertionError" },
      { ac: 2, pass: false, evidence: "AssertionError" },
    ],
  }));
  for (let i = 0; i < CHALLENGE_BUDGET; i++) assert.match(await challenge(1, "wrong"), /^DENIED/);
  assert.match(await challenge(1, "wrong"), new RegExp(`challenged ${CHALLENGE_BUDGET} times`));
  assert.match(await challenge(2, "wrong"), /^DENIED/, "another check keeps its own budget");
  assert.equal(judged, CHALLENGE_BUDGET + 1);
});
