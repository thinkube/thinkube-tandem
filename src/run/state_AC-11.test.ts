/**
 * INVARIANT — a finished run read back from disk must answer logTail("gate")
 * exactly as the live run did: own lines, then "gate#closer", then any
 * other sub-step, in the same order. The fold-in belongs to logTail itself,
 * not to some extra bookkeeping only the live RunState keeps, so restoring
 * from a plain record must reproduce it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RunState } from "./state";

test('logTail("gate") on a restored RunState matches the live RunState before it finished', () => {
  const live = new RunState(() => {});
  live.log("gate: opening line", "gate");
  live.log("closer: round one", "gate#closer");
  live.log("finisher: a repair", "gate#finisher");
  live.log("closer: round two", "gate#closer");
  live.log("gate: closing line", "gate");

  const before = live.logTail("gate");

  const record = {
    units: [],
    logs: [...live.logs],
    stepLogs: Object.fromEntries([...live.stepLogs].map(([k, v]) => [k, [...v]])),
    runId: "run-1",
  };

  const restored = RunState.from(record, () => {});
  const after = restored.logTail("gate");

  assert.deepEqual(
    after.lines,
    before.lines,
    "the restored run answers logTail(\"gate\") with the same lines, in the same order",
  );
});
