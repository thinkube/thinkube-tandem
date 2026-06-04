/**
 * Unit tests for the pure slice→Board projection. Run via `npm test`. No vscode
 * or fs — the projection is a pure function of slice records.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildSliceBoard,
  cardNumberFor,
  decodeCardNumber,
  columnIdToStatus,
  statusToColumnId,
  SliceInput,
} from "./sliceBoard";

test("card number is a reversible (spec, slice) composite", () => {
  const n = cardNumberFor(3, 42);
  assert.deepEqual(decodeCardNumber(n), { specNumber: 3, sliceNumber: 42 });
  // distinct across specs even when the slice number repeats
  assert.notEqual(cardNumberFor(3, 1), cardNumberFor(7, 1));
});

test("status ↔ column mapping is total and round-trips the three columns", () => {
  assert.equal(statusToColumnId("ready"), "column-ready");
  assert.equal(statusToColumnId("doing"), "column-doing");
  assert.equal(statusToColumnId("done"), "column-done");
  assert.equal(statusToColumnId(undefined), "column-ready"); // default
  assert.equal(columnIdToStatus("column-doing"), "doing");
});

test("buildSliceBoard lays out three columns and places slices by status", () => {
  const slices: SliceInput[] = [
    { specNumber: 3, sliceNumber: 1, title: "a", status: "ready" },
    { specNumber: 3, sliceNumber: 2, title: "b", status: "doing" },
    { specNumber: 7, sliceNumber: 1, title: "c", status: "done" },
  ];
  const board = buildSliceBoard(slices, "demo");
  assert.deepEqual(
    board.columns.map((c) => c.title),
    ["Ready", "Doing", "Done"],
  );
  const ready = board.columns.find((c) => c.title === "Ready")!;
  assert.deepEqual(ready.tasksIds, ["SP-3_SL-1"]);
  const card = board.tasks["SP-3_SL-1"];
  assert.equal(card.issueNumber, cardNumberFor(3, 1));
  assert.equal(card.parentNumber, 3); // grouped/coloured by parent Spec
  assert.equal(card.description, "a");
});

test("archived slices are excluded from the board", () => {
  const board = buildSliceBoard(
    [
      { specNumber: 1, sliceNumber: 1, title: "live", status: "ready" },
      { specNumber: 1, sliceNumber: 2, title: "dead", status: "archived" },
    ],
    "demo",
  );
  assert.equal(Object.keys(board.tasks).length, 1);
  assert.ok(board.tasks["SP-1_SL-1"]);
  assert.equal(board.tasks["SP-1_SL-2"], undefined);
});

test("buildSliceBoard carries delivery provenance (commit/commitUrl/pr) onto the card", () => {
  const board = buildSliceBoard(
    [
      {
        specNumber: 2,
        sliceNumber: 1,
        title: "delivered",
        status: "done",
        commit: "ea7d4fea08878be3af577857709fac561aefda3d",
        commitUrl:
          "https://github.com/cmxela/thinkube-ai-integration/commit/ea7d4fea08878be3af577857709fac561aefda3d",
        pr: "https://github.com/cmxela/thinkube-ai-integration/pull/13",
      },
      // A slice with no provenance leaves the fields undefined.
      { specNumber: 2, sliceNumber: 2, title: "pending", status: "ready" },
    ],
    "demo",
  );
  const done = board.tasks["SP-2_SL-1"];
  assert.equal(done.commit, "ea7d4fea08878be3af577857709fac561aefda3d");
  assert.equal(
    done.commitUrl,
    "https://github.com/cmxela/thinkube-ai-integration/commit/ea7d4fea08878be3af577857709fac561aefda3d",
  );
  assert.equal(
    done.pr,
    "https://github.com/cmxela/thinkube-ai-integration/pull/13",
  );
  const pending = board.tasks["SP-2_SL-2"];
  assert.equal(pending.commit, undefined);
  assert.equal(pending.commitUrl, undefined);
  assert.equal(pending.pr, undefined);
});

test("a slice whose stamped hash differs from the current Spec hash is stale", () => {
  const board = buildSliceBoard(
    [
      {
        specNumber: 1,
        sliceNumber: 1,
        title: "x",
        status: "done",
        stampedReqHash: "old",
        currentReqHash: "new",
      },
      {
        specNumber: 1,
        sliceNumber: 2,
        title: "y",
        status: "done",
        stampedReqHash: "same",
        currentReqHash: "same",
      },
    ],
    "demo",
  );
  assert.equal(board.tasks["SP-1_SL-1"].specStale, true);
  assert.equal(board.tasks["SP-1_SL-1"].specChange, "requirements");
  assert.equal(board.tasks["SP-1_SL-2"].specStale, false);
});
