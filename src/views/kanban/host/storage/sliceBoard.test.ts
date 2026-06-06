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
  // Slice cards only — each Spec also gets an auto-derived `_accept` close card.
  assert.deepEqual(
    ready.tasksIds.filter((id) => !id.endsWith("_accept")),
    ["SP-3_SL-1"],
  );
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
  // One slice card (the archived one excluded); the Spec's `_accept` close card
  // is also present but isn't a slice.
  const sliceCards = Object.keys(board.tasks).filter(
    (id) => !id.endsWith("_accept"),
  );
  assert.equal(sliceCards.length, 1);
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

test("close card: one per Spec with slices, carrying checklist + progress (TEP-0010)", () => {
  const crit = [
    { label: "one", checked: true },
    { label: "two", checked: false },
  ];

  // Mid-progress Spec (not accepted) → a card in Ready, NOT accept-ready,
  // carrying the criteria checklist + slice progress.
  const mid = buildSliceBoard(
    [
      { specNumber: "9", sliceNumber: 1, title: "x", status: "done" },
      { specNumber: "9", sliceNumber: 2, title: "y", status: "doing" },
    ],
    "demo",
    new Map([
      [
        "9",
        {
          accepted: false,
          allAcsChecked: false,
          criteria: crit,
          archived: false,
        },
      ],
    ]),
  );
  const card = mid.tasks["SP-9_accept"];
  assert.ok(card?.isAcceptance);
  assert.equal(card.columnId, "column-ready");
  assert.equal(card.acceptReady, false);
  assert.equal(card.slicesDone, 1);
  assert.equal(card.slicesTotal, 2);
  assert.deepEqual(card.acceptanceCriteria, crit);

  // All slices Done + all ACs checked → accept-ready, still in Ready.
  const ready = buildSliceBoard(
    [{ specNumber: "9", sliceNumber: 1, title: "x", status: "done" }],
    "demo",
    new Map([
      [
        "9",
        {
          accepted: false,
          allAcsChecked: true,
          criteria: [{ label: "one", checked: true }],
          archived: false,
        },
      ],
    ]),
  );
  assert.equal(ready.tasks["SP-9_accept"].acceptReady, true);
  assert.equal(ready.tasks["SP-9_accept"].columnId, "column-ready");

  // Accepted → card rests in Done (kept as a record, not hidden).
  const accepted = buildSliceBoard(
    [{ specNumber: "9", sliceNumber: 1, title: "x", status: "done" }],
    "demo",
    new Map([
      [
        "9",
        {
          accepted: true,
          allAcsChecked: true,
          criteria: [{ label: "one", checked: true }],
          archived: false,
        },
      ],
    ]),
  );
  assert.equal(accepted.tasks["SP-9_accept"].columnId, "column-done");
  assert.equal(accepted.tasks["SP-9_accept"].accepted, true);
});

test("deriveSpecMeta reads accepted, all-ACs-checked, and the criteria checklist", () => {
  const allChecked = `## Acceptance Criteria\n- [x] one\n- [x] two\n`;
  const someUnchecked = `## Acceptance Criteria\n- [x] one\n- [ ] two\n`;

  // No stamp, every box checked — criteria returned as a checklist.
  assert.deepEqual(deriveSpecMeta(undefined, allChecked), {
    accepted: false,
    allAcsChecked: true,
    criteria: [
      { label: "one", checked: true },
      { label: "two", checked: true },
    ],
    archived: false,
  });
  // A non-empty `accepted:` stamp flips accepted; an empty string does not.
  assert.equal(
    deriveSpecMeta({ accepted: "2026-06-06" }, allChecked).accepted,
    true,
  );
  assert.equal(deriveSpecMeta({ accepted: "" }, allChecked).accepted, false);
  // Any unchecked box → not all-checked, but still surfaced in the checklist.
  const partial = deriveSpecMeta(undefined, someUnchecked);
  assert.equal(partial.allAcsChecked, false);
  assert.deepEqual(partial.criteria, [
    { label: "one", checked: true },
    { label: "two", checked: false },
  ]);
  // No `## Acceptance Criteria` at all → not all-checked, empty checklist.
  assert.equal(
    deriveSpecMeta(undefined, "no criteria here").allAcsChecked,
    false,
  );
  assert.deepEqual(deriveSpecMeta(undefined, "no criteria here").criteria, []);
});

// ── archived Specs leave the board (TEP-tg86v7 / SP-tg8f9b) ──

test("an archived Spec drops its slices AND acceptance card off the board", () => {
  const meta = (archived: boolean) => ({
    accepted: archived,
    allAcsChecked: true,
    criteria: [{ label: "a", checked: true }],
    archived,
  });
  const board = buildSliceBoard(
    [
      { specNumber: "1", sliceNumber: 1, title: "live", status: "done" },
      { specNumber: "2", sliceNumber: 1, title: "archived", status: "done" },
    ],
    "demo",
    new Map([
      ["1", meta(false)],
      ["2", meta(true)],
    ]),
  );
  // The live Spec keeps its slice + acceptance card.
  assert.ok(board.tasks["SP-1_SL-1"]);
  assert.ok(board.tasks["SP-1_accept"]);
  // The archived Spec contributes nothing — no slice, no acceptance card.
  assert.equal(board.tasks["SP-2_SL-1"], undefined);
  assert.equal(board.tasks["SP-2_accept"], undefined);
});

test("a Spec with no SpecMeta (no archived flag) is unaffected (back-compat)", () => {
  const board = buildSliceBoard(
    [{ specNumber: "1", sliceNumber: 1, title: "x", status: "ready" }],
    "demo",
  );
  assert.ok(board.tasks["SP-1_SL-1"]);
  assert.ok(board.tasks["SP-1_accept"]);
});
