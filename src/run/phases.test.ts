/**
 * The door and the delivery are phases of the run: each has a state, says
 * what it is doing, and owns the lines written while it is in progress —
 * so each is a card with a log, like every worker.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RunState } from "./state";

test("a line with no step of its own is filed under the phase in progress", () => {
  const st = new RunState(() => {});
  st.phase("door", "running", "provisioning");
  st.log("provisioning the worktree");
  st.phase("door", "done", "the tree is ready");
  st.log("SL-1#eu-0 starts");
  st.phase("delivery", "running", "opening the delivery");
  st.log("pushed the branch");
  assert.deepEqual(st.logTail("door").lines, ["provisioning the worktree"]);
  assert.deepEqual(st.logTail("run").lines, ["SL-1#eu-0 starts"]);
  assert.deepEqual(st.logTail("delivery").lines, ["pushed the branch"]);
  assert.equal(st.view().phases.door.state, "done");
  assert.equal(st.view().phases.delivery.doing, "opening the delivery");
});

test("a refusal at the door fails the door, and the record keeps both phases", () => {
  const st = new RunState(() => {});
  st.phase("door", "running", "proving");
  st.phase("door", "failed", "the single-test command did not hold");
  const v = st.view();
  assert.equal(v.phases.door.state, "failed");
  assert.match(v.phases.door.doing ?? "", /did not hold/);
  const back = RunState.from({ units: [], logs: [], stepLogs: {}, phases: v.phases }, () => {});
  assert.deepEqual(back.view().phases.door, v.phases.door);
});
