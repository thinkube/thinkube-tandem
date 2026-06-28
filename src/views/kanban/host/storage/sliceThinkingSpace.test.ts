/**
 * Unit tests for the pure slice→Thinking Space projection. Run via `npm test`. No vscode
 * or fs — the projection is a pure function of slice records.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildSliceThinkingSpace,
  deriveSpecMeta,
  sliceHandle,
  columnIdToStatus,
  statusToColumnId,
  SliceInput,
} from "./sliceThinkingSpace";

test("the card's identity is its string handle (opaque spec id, SP-7)", () => {
  assert.equal(sliceHandle("tw7n0g", 3), "SP-tw7n0g_SL-3");
  const thinkingSpace = buildSliceThinkingSpace(
    [{ specNumber: "tw7n0g", sliceNumber: 3, title: "a", status: "ready" }],
    "demo",
  );
  const card = thinkingSpace.tasks["SP-tw7n0g_SL-3"];
  assert.ok(card);
  assert.equal(card.parentId, "tw7n0g"); // chip + colour by parent Spec id
});

test("status ↔ column mapping is total and round-trips the four columns", () => {
  assert.equal(statusToColumnId("ready"), "column-ready");
  assert.equal(statusToColumnId("doing"), "column-doing");
  assert.equal(statusToColumnId("requires-attention"), "column-attention");
  assert.equal(statusToColumnId("done"), "column-done");
  assert.equal(statusToColumnId(undefined), "column-ready"); // default
  assert.equal(columnIdToStatus("column-doing"), "doing");
  assert.equal(columnIdToStatus("column-attention"), "requires-attention");
});

test("buildSliceThinkingSpace lays out three columns and places slices by status", () => {
  const slices: SliceInput[] = [
    { specNumber: "3", sliceNumber: 1, title: "a", status: "ready" },
    { specNumber: "3", sliceNumber: 2, title: "b", status: "doing" },
    { specNumber: "7", sliceNumber: 1, title: "c", status: "done" },
  ];
  const thinkingSpace = buildSliceThinkingSpace(slices, "demo");
  assert.deepEqual(
    thinkingSpace.columns.map((c) => c.title),
    ["Ready", "Doing", "Needs Attention", "Done"],
  );
  const ready = thinkingSpace.columns.find((c) => c.title === "Ready")!;
  // Slice cards only — each Spec also gets an auto-derived `_accept` close card.
  assert.deepEqual(
    ready.tasksIds.filter((id) => !id.endsWith("_accept")),
    ["SP-3_SL-1"],
  );
  const card = thinkingSpace.tasks["SP-3_SL-1"];
  assert.equal(card.parentId, "3"); // grouped/coloured by parent Spec id
  assert.equal(card.description, "a");
});

// ── org-scoped nested tree projection (SP-th8m5b / TEP-th8lzj, AC 5) ──
// Slices discovered at `<org>/teps/TEP-n/SP-m/SL-k.md` carry their parent TEP
// number. The projection flattens each handle to the tep-qualified
// `TEP-n_SP-m_SL-k` form and groups under the tep-qualified spec key, so bare
// SP/SL numbers that repeat across TEPs never collide.

test("buildSliceThinkingSpace projects the nested tree: tep-qualified handles grouped under their parent spec", () => {
  const slices: SliceInput[] = [
    {
      tepNumber: 1,
      specNumber: "1",
      sliceNumber: 1,
      title: "a",
      status: "ready",
    },
    {
      tepNumber: 1,
      specNumber: "1",
      sliceNumber: 2,
      title: "b",
      status: "doing",
    },
    {
      tepNumber: 1,
      specNumber: "2",
      sliceNumber: 1,
      title: "c",
      status: "done",
    },
    // Same bare SP-1 / SL-1 under a DIFFERENT TEP — must stay distinct.
    {
      tepNumber: 2,
      specNumber: "1",
      sliceNumber: 1,
      title: "d",
      status: "ready",
    },
  ];
  const thinkingSpace = buildSliceThinkingSpace(slices, "demo");

  // Handles are tep-qualified and unique even though SP-1/SL-1 repeats.
  assert.ok(thinkingSpace.tasks["TEP-1_SP-1_SL-1"]);
  assert.ok(thinkingSpace.tasks["TEP-2_SP-1_SL-1"]);
  assert.notEqual(
    thinkingSpace.tasks["TEP-1_SP-1_SL-1"].id,
    thinkingSpace.tasks["TEP-2_SP-1_SL-1"].id,
  );

  // Grouped under their parent spec: parentId is the tep-qualified spec key,
  // and a Spec's slices share a colour.
  assert.equal(thinkingSpace.tasks["TEP-1_SP-1_SL-1"].parentId, "TEP-1_SP-1");
  assert.equal(thinkingSpace.tasks["TEP-1_SP-1_SL-2"].parentId, "TEP-1_SP-1");
  assert.equal(
    thinkingSpace.tasks["TEP-1_SP-1_SL-1"].colorSlug,
    thinkingSpace.tasks["TEP-1_SP-1_SL-2"].colorSlug,
  );
  assert.equal(thinkingSpace.tasks["TEP-1_SP-2_SL-1"].parentId, "TEP-1_SP-2");
  assert.equal(thinkingSpace.tasks["TEP-2_SP-1_SL-1"].parentId, "TEP-2_SP-1");

  // Column placement still follows status.
  const ready = thinkingSpace.columns.find((c) => c.title === "Ready")!;
  assert.ok(ready.tasksIds.includes("TEP-1_SP-1_SL-1"));
  assert.ok(ready.tasksIds.includes("TEP-2_SP-1_SL-1"));
  const doing = thinkingSpace.columns.find((c) => c.title === "Doing")!;
  assert.ok(doing.tasksIds.includes("TEP-1_SP-1_SL-2"));

  // One acceptance close-card per parent spec, tep-qualified + unique.
  assert.ok(thinkingSpace.tasks["TEP-1_SP-1_accept"]?.isAcceptance);
  assert.ok(thinkingSpace.tasks["TEP-1_SP-2_accept"]?.isAcceptance);
  assert.ok(thinkingSpace.tasks["TEP-2_SP-1_accept"]?.isAcceptance);
  assert.equal(thinkingSpace.tasks["TEP-1_SP-1_accept"].slicesTotal, 2);
  assert.equal(thinkingSpace.tasks["TEP-1_SP-2_accept"].slicesDone, 1);
  assert.equal(
    thinkingSpace.tasks["TEP-1_SP-1_accept"].description,
    "TEP-1_SP-1",
  );
});

test("nested specMeta is keyed by the tep-qualified spec key", () => {
  const thinkingSpace = buildSliceThinkingSpace(
    [
      {
        tepNumber: 1,
        specNumber: "1",
        sliceNumber: 1,
        title: "x",
        status: "done",
      },
    ],
    "demo",
    new Map([
      [
        "TEP-1_SP-1",
        {
          accepted: true,
          allAcsChecked: true,
          criteria: [{ label: "a", checked: true }],
          archived: false,
        },
      ],
    ]),
  );
  // Accepted → the close card rests in Done, keyed by the tep-qualified spec.
  assert.equal(
    thinkingSpace.tasks["TEP-1_SP-1_accept"].columnId,
    "column-done",
  );
  assert.equal(thinkingSpace.tasks["TEP-1_SP-1_accept"].accepted, true);
});

test("an archived nested Spec drops its slices AND acceptance card off the thinking space", () => {
  const thinkingSpace = buildSliceThinkingSpace(
    [
      {
        tepNumber: 1,
        specNumber: "1",
        sliceNumber: 1,
        title: "live",
        status: "done",
      },
      {
        tepNumber: 1,
        specNumber: "2",
        sliceNumber: 1,
        title: "gone",
        status: "done",
      },
    ],
    "demo",
    new Map([
      [
        "TEP-1_SP-2",
        {
          accepted: true,
          allAcsChecked: true,
          criteria: [{ label: "a", checked: true }],
          archived: true,
        },
      ],
    ]),
  );
  assert.ok(thinkingSpace.tasks["TEP-1_SP-1_SL-1"]);
  assert.ok(thinkingSpace.tasks["TEP-1_SP-1_accept"]);
  assert.equal(thinkingSpace.tasks["TEP-1_SP-2_SL-1"], undefined);
  assert.equal(thinkingSpace.tasks["TEP-1_SP-2_accept"], undefined);
});

test("archived slices are excluded from the thinking space", () => {
  const thinkingSpace = buildSliceThinkingSpace(
    [
      { specNumber: "1", sliceNumber: 1, title: "live", status: "ready" },
      { specNumber: "1", sliceNumber: 2, title: "dead", status: "archived" },
    ],
    "demo",
  );
  // One slice card (the archived one excluded); the Spec's `_accept` close card
  // is also present but isn't a slice.
  const sliceCards = Object.keys(thinkingSpace.tasks).filter(
    (id) => !id.endsWith("_accept"),
  );
  assert.equal(sliceCards.length, 1);
  assert.ok(thinkingSpace.tasks["SP-1_SL-1"]);
  assert.equal(thinkingSpace.tasks["SP-1_SL-2"], undefined);
});

test("buildSliceThinkingSpace carries delivery provenance (commit/commitUrl/pr) onto the card", () => {
  const thinkingSpace = buildSliceThinkingSpace(
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
  const done = thinkingSpace.tasks["SP-2_SL-1"];
  assert.equal(done.commit, "ea7d4fea08878be3af577857709fac561aefda3d");
  assert.equal(
    done.commitUrl,
    "https://github.com/cmxela/thinkube-ai-integration/commit/ea7d4fea08878be3af577857709fac561aefda3d",
  );
  assert.equal(
    done.pr,
    "https://github.com/cmxela/thinkube-ai-integration/pull/13",
  );
  const pending = thinkingSpace.tasks["SP-2_SL-2"];
  assert.equal(pending.commit, undefined);
  assert.equal(pending.commitUrl, undefined);
  assert.equal(pending.pr, undefined);
});

test("a slice whose stamped hash differs from the current Spec hash is stale", () => {
  const thinkingSpace = buildSliceThinkingSpace(
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
  assert.equal(thinkingSpace.tasks["SP-1_SL-1"].specStale, true);
  assert.equal(thinkingSpace.tasks["SP-1_SL-1"].specChange, "requirements");
  assert.equal(thinkingSpace.tasks["SP-1_SL-2"].specStale, false);
});

test("close card: one per Spec with slices, carrying checklist + progress (TEP-0010)", () => {
  const crit = [
    { label: "one", checked: true },
    { label: "two", checked: false },
  ];

  // Mid-progress Spec (not accepted) → a card in Ready, NOT accept-ready,
  // carrying the criteria checklist + slice progress.
  const mid = buildSliceThinkingSpace(
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
  const ready = buildSliceThinkingSpace(
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
  const accepted = buildSliceThinkingSpace(
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

// ── archived Specs leave the thinking space (TEP-tg86v7 / SP-tg8f9b) ──

test("an archived Spec drops its slices AND acceptance card off the thinking space", () => {
  const meta = (archived: boolean) => ({
    accepted: archived,
    allAcsChecked: true,
    criteria: [{ label: "a", checked: true }],
    archived,
  });
  const thinkingSpace = buildSliceThinkingSpace(
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
  assert.ok(thinkingSpace.tasks["SP-1_SL-1"]);
  assert.ok(thinkingSpace.tasks["SP-1_accept"]);
  // The archived Spec contributes nothing — no slice, no acceptance card.
  assert.equal(thinkingSpace.tasks["SP-2_SL-1"], undefined);
  assert.equal(thinkingSpace.tasks["SP-2_accept"], undefined);
});

test("a Spec with no SpecMeta (no archived flag) is unaffected (back-compat)", () => {
  const thinkingSpace = buildSliceThinkingSpace(
    [{ specNumber: "1", sliceNumber: 1, title: "x", status: "ready" }],
    "demo",
  );
  assert.ok(thinkingSpace.tasks["SP-1_SL-1"]);
  assert.ok(thinkingSpace.tasks["SP-1_accept"]);
});
