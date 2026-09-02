/**
 * The page follows the state, in the order the work moves.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pageFor, flowViewFor } from "./pageFor";
import { pushFor, quietPush } from "./pages.fixture";

test("nothing written, or a reading not kept: the write page", () => {
  assert.equal(pageFor(quietPush({ sentences: [], subjects: [] })), "write");
  assert.equal(pageFor(quietPush({ pendingModel: { subjects: [], texts: ["a"], fresh: ["a"], missing: [] } as never })), "write");
});

test("sentences read, nothing chosen: your sentences", () => {
  assert.equal(pageFor(pushFor("intent")), "intent");
});

test("a thing chosen and worked out: what it will do", () => {
  assert.equal(pageFor(pushFor("work")), "work");
});

test("a thing chosen and still being worked out: your sentences, where the progress is", () => {
  const p = pushFor("work");
  assert.equal(pageFor({ ...p, cost: { subjects: 1, rounds: 4 } }), "intent");
});

test("running, or delivered and not accepted: the run", () => {
  assert.equal(pageFor(quietPush({ running: true })), "flow");
  assert.equal(pageFor(pushFor("flow")), "flow");
  assert.equal(flowViewFor(quietPush({ running: true })), "workers");
  assert.equal(flowViewFor(pushFor("flow")), "report");
});

test("accepted: back to your sentences", () => {
  const p = pushFor("flow");
  assert.equal(pageFor({ ...p, deliveries: p.deliveries.map((d) => ({ ...d, accepted: true })) }), "intent");
});
