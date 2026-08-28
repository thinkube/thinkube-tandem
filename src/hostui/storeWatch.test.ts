/**
 * A space follows outside writes, except while it is mid-flight.
 *
 * The guard is the whole risk: a round in progress holds state the records
 * do not carry yet, so re-folding underneath it would throw away the work
 * being done. The write is never lost — it is on disk — it is only picked
 * up at the next quiet moment.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldFollow } from "./storeWatch";

test("an idle space follows what was written to it", () => {
  assert.equal(shouldFollow({ load() {}, activity: undefined, running: undefined }), true);
});

test("a space deriving does not re-fold underneath itself", () => {
  assert.equal(
    shouldFollow({
      load() {},
      activity: { label: "grounding", current: 1, total: 4 },
      running: undefined,
    }),
    false,
  );
});

test("a space with a run in flight does not re-fold underneath itself", () => {
  assert.equal(shouldFollow({ load() {}, activity: undefined, running: { tep: "TEP-1" } }), false);
});
