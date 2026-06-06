/**
 * Unit tests for the pure slice→Board projection. Run via `npm test`. No vscode
 * or fs — the projection is a pure function of slice records.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildSliceBoard,
  deriveSpecMeta,
  sliceHandle,
  columnIdToStatus,
  statusToColumnId,
  SliceInput,
} from "./sliceBoard";

test("the card's identity is its string handle (opaque spec id, SP-7)", () => {
  assert.equal(sliceHandle("tw7n0g", 3), "SP-tw7n0g_SL-3");
  const board = buildSliceBoard(
    [{ specNumber: "tw7n0g", sliceNumber: 3, title: "a", status: "ready" }],
    "demo",
  );
  const card = board.tasks["SP-tw7n0g_SL-3"];
  assert.ok(card);
  assert.equal(card.parentId, "tw7n0g"); // chip + colour by parent Spec id
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
    { specNumber: "3", sliceNumber: 1, title: "a", status: "ready" },
    { specNumber: "3", sliceNumber: 2, title: "b", status: "doing" },
    { specNumber: "7", sliceNumber: 1, title: "c", status: "done" },
  ];
  const board = buildSliceBoard(slices, "demo");
  assert.deepEqual(
    board.columns.map((c) => c.title),
    ["Ready", "Doing", "Done"],
  );
  const ready = board.columns.find((c) => c.title === "Ready")!;
  assert.deepEqual(ready.tasksIds, ["SP-3_SL-1"]);
  const card = board.tasks["SP-3_SL-1"];
  assert.equal(card.parentId, "3"); // grouped/coloured by parent Spec id
  assert.equal(card.description, "a");
});

test("archived slices are excluded from the board", () => {
  const board = buildSliceBoard(
    [
      { specNumber: "1", sliceNumber: 1, title: "live", status: "ready" },
      { specNumber: "1", sliceNumber: 2, title: "dead", status: "archived" },
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
        specNumber: "2",
        sliceNumber: 1,
        title: "delivered",
        status: "done",
        commit: "ea7d4fea08878be3af577857709fac561aefda3d",
        commitUrl:
          "https://github.com/cmxela/thinkube-ai-integration/commit/ea7d4fea08878be3af577857709fac561aefda3d",
        pr: "https://github.com/cmxela/thinkube-ai-integration/pull/13",
      },
      // A slice with no provenance leaves the fields undefined.
      { specNumber: "2", sliceNumber: 2, title: "pending", status: "ready" },
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
        specNumber: "1",
        sliceNumber: 1,
        title: "x",
        status: "done",
        stampedReqHash: "old",
        currentReqHash: "new",
      },
      {
        specNumber: "1",
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

test("acceptance card appears only when accept-ready or accepted (TEP-0010)", () => {
  // Mid-progress Spec → no acceptance card.
  const mid = buildSliceBoard(
    [{ specNumber: "9", sliceNumber: 1, title: "x", status: "doing" }],
    "demo",
  );
  assert.equal(mid.tasks["SP-9_accept"], undefined);

  // All slices Done + all ACs checked → an accept-ready card in Ready.
  const ready = buildSliceBoard(
    [{ specNumber: "9", sliceNumber: 1, title: "x", status: "done" }],
    "demo",
    new Map([["9", { accepted: false, allAcsChecked: true }]]),
  );
  const card = ready.tasks["SP-9_accept"];
  assert.ok(card?.isAcceptance);
  assert.equal(card.acceptReady, true);
  assert.equal(card.columnId, "column-ready");

  // Accepted → card in Done.
  const accepted = buildSliceBoard(
    [{ specNumber: "9", sliceNumber: 1, title: "x", status: "done" }],
    "demo",
    new Map([["9", { accepted: true, allAcsChecked: true }]]),
  );
  assert.equal(accepted.tasks["SP-9_accept"].columnId, "column-done");
});

test("deriveSpecMeta reads the accepted stamp and all-ACs-checked from a Spec doc", () => {
  const allChecked = `## Acceptance Criteria\n- [x] one\n- [x] two\n`;
  const someUnchecked = `## Acceptance Criteria\n- [x] one\n- [ ] two\n`;

  // No stamp, every box checked.
  assert.deepEqual(deriveSpecMeta(undefined, allChecked), {
    accepted: false,
    allAcsChecked: true,
  });
  // A non-empty `accepted:` stamp flips accepted; an empty string does not.
  assert.equal(
    deriveSpecMeta({ accepted: "2026-06-06" }, allChecked).accepted,
    true,
  );
  assert.equal(deriveSpecMeta({ accepted: "" }, allChecked).accepted, false);
  // Any unchecked box → not all-checked.
  assert.equal(deriveSpecMeta(undefined, someUnchecked).allAcsChecked, false);
  // No `## Acceptance Criteria` at all → not all-checked (vacuous truth refused,
  // mirroring gateSpecAcceptance).
  assert.equal(
    deriveSpecMeta(undefined, "no criteria here").allAcsChecked,
    false,
  );
});
