/**
 * TRANSITION — committedSlicesOf must widen from a bare slice-name list to
 * pairs of slice and run id: a commit's body now carries the run trailer
 * that made the slice standing, and a resumed run must read it back so a
 * standing-pass line can name the run that actually did the work. A commit
 * with no trailer (an older commit, from before this landed) must still
 * come back with the slice, only with no run id attached.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { committedSlicesOf } from "./refresh";

test("committedSlicesOf pairs a slice with the run id carried in its commit's trailer", () => {
  const log = [
    "tandem: TEP-cmxela-31 SL-1",
    "",
    "Tandem-Run: TEP-cmxela-31@abc123",
  ].join("\n");

  const out = committedSlicesOf(log, "TEP-cmxela-31");

  assert.deepEqual(
    out,
    [{ slice: "SL-1", runId: "TEP-cmxela-31@abc123" }],
    "the slice comes back paired with the run id from the trailer",
  );
});

test("committedSlicesOf returns the slice with no run id when the commit carries no trailer", () => {
  const log = "tandem: TEP-cmxela-31 SL-1";

  const out = committedSlicesOf(log, "TEP-cmxela-31");

  assert.deepEqual(
    out,
    [{ slice: "SL-1", runId: undefined }],
    "a commit with no trailer still names its slice, with no run id",
  );
});
