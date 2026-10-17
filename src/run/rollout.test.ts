/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * After a deploy, nothing is judged on the running service until the new
 * revision is the one serving: rolled out, and no pod of the previous one
 * left. The wait is bounded and its end names what it waited for.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { notRolledOut, waitForRollout, type DeploymentState } from "./rollout";

const state = (o: Partial<DeploymentState>): DeploymentState => ({
  revision: "7",
  generation: 7,
  observedGeneration: 7,
  replicas: 1,
  current: 1,
  updated: 1,
  available: 1,
  ...o,
});

test("a rollout is complete only on a new revision, seen, with every replica new and available and none old", () => {
  const before = state({});
  assert.match(notRolledOut(before, state({})) ?? "", /still at revision 7/);
  assert.match(notRolledOut(before, state({ revision: "8", generation: 8 })) ?? "", /not yet seen its newest spec/);
  assert.match(notRolledOut(before, state({ revision: "8", updated: 0 })) ?? "", /0 of 1 replica\(s\) run the new revision/);
  assert.match(notRolledOut(before, state({ revision: "8", available: 0 })) ?? "", /0 of 1 replica\(s\) are available/);
  assert.match(
    notRolledOut(before, state({ revision: "8", current: 2, available: 1 })) ?? "",
    /1 replica\(s\) of the previous revision still run/,
    "the old pod that still answers is waited out",
  );
  assert.equal(notRolledOut(before, state({ revision: "8" })), undefined);
  assert.equal(notRolledOut(undefined, state({ revision: "1" })), undefined, "a first deploy has no previous revision");
  assert.match(notRolledOut(undefined, undefined) ?? "", /does not exist yet/);
});

test("the wait follows the rollout until the new revision serves", async () => {
  const seen = [state({ revision: "8", current: 2 }), state({ revision: "8", current: 2 }), state({ revision: "8" })];
  let i = 0;
  let waited = 0;
  const stuck = await waitForRollout({
    namespace: "scoring",
    name: "scoring-scoring",
    before: state({}),
    read: async () => seen[Math.min(i++, seen.length - 1)],
    wait: async () => {
      waited++;
    },
  });
  assert.equal(stuck, undefined);
  assert.equal(waited, 2, "it waited while the previous pod still ran");
});

test("a rollout that never completes ends in an error naming the deployment and what it waited for", async () => {
  let t = 0;
  const stuck = await waitForRollout({
    namespace: "scoring",
    name: "scoring-scoring",
    before: state({}),
    read: async () => state({}),
    wait: async (ms) => {
      t += ms;
    },
    now: () => t,
    timeoutMs: 60_000,
  });
  assert.match(stuck ?? "", /^the deployment scoring\/scoring-scoring did not finish rolling out the new revision within 1 minute\(s\) — last, it is still at revision 7/);
});
