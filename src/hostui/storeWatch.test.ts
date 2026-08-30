/**
 * A space follows outside writes, except under the session doing the work.
 *
 * The guard is the whole risk in both directions. A session mid-round holds
 * state the records do not carry yet, so re-folding underneath it would
 * throw away the work being done. But a session that is only WATCHING a run
 * holds nothing of the kind — and the guard used to stop for it too, because
 * adopting a live run sets `running` exactly as executing one does. From
 * that moment every further write to the run was ignored, so the window kept
 * the frame it happened to catch and a card read "mending 1 check" long
 * after that unit had finished and the next one had too.
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

test("the session executing a run does not re-fold underneath itself", () => {
  assert.equal(
    shouldFollow({ load() {}, activity: undefined, running: { tep: "TEP-1" }, driving: true }),
    false,
  );
});

test("a window watching a run someone else drives keeps following it", () => {
  assert.equal(
    shouldFollow({ load() {}, activity: undefined, running: { tep: "TEP-1" }, driving: false }),
    true,
    "watching is not doing: the record is the only picture it has, and it moves every second",
  );
});
