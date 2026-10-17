/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A supervisor is never asked to read a brief its unit was not given: an
 * empty or unrecorded brief is an error naming the slice, before any round
 * is dispatched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { briefOf, makeSupervisor } from "./oracle";

test("an unrecorded or empty brief is an error naming the slice", () => {
  assert.throws(() => briefOf({ briefBySlice: new Map() }, "SL-2-tests-4"), /no brief is recorded for SL-2-tests-4/);
  assert.throws(() => briefOf({ briefBySlice: new Map([["SL-1", "  \n"]]) }, "SL-1"), /no brief is recorded for SL-1/);
  assert.equal(briefOf({ briefBySlice: new Map([["SL-1", "build the token check"]]) }, "SL-1"), "build the token check");
});

test("the supervisor dispatches no round without the brief, and reads it when it is there", async () => {
  const rounds: string[] = [];
  const said: string[] = [];
  const args = (briefs: Map<string, string>) =>
    ({
      briefBySlice: briefs,
      sliceProbes: new Map(),
      testerWt: "/nowhere",
      worktree: "/nowhere",
      model: "test",
      log: (l: string) => said.push(l),
      supervisorRound: async (_d: unknown, prompt: string) => (rounds.push(prompt), "CAPABILITY: the brief states it"),
    }) as never;
  const testFault = async () => "";
  await assert.rejects(makeSupervisor(args(new Map()), testFault)("SL-2-tests-4")("red", [1]), /no brief is recorded for SL-2-tests-4/);
  assert.equal(rounds.length, 0, "no supervisor round was dispatched");
  assert.ok(said.some((l) => /no brief is recorded for SL-2-tests-4/.test(l)), said.join("\n"));
  await makeSupervisor(args(new Map([["SL-1", "THE MAINTAINER'S BRIEF"]])), testFault)("SL-1")("red", [1]);
  assert.equal(rounds.length, 1);
  assert.ok(rounds[0].includes("THE MAINTAINER'S BRIEF"));
});
