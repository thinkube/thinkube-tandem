/**
 * Board integrity tests (2026-07-17 redesign): the reading/sovereignty
 * surface. Pure builder — script syntax, one-selection semantics, state
 * rendering, action bar, no truncation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "../model";
import type { Action, WorkingModel } from "../model";
import { buildBoardHtml } from "./board";

function apply(model: WorkingModel, action: Action): WorkingModel {
  const { model: next, delta } = reduce(model, action);
  assert.equal(delta.kind, "applied", JSON.stringify(delta));
  return next;
}

function seeded(): { model: WorkingModel; itemId: string } {
  let model = emptyModel("tep");
  const elements = model.sections.find((s) => s.kind === "elements")!;
  const longText =
    "a deliberately long element text that the old surfaces would have truncated into illegibility and the board must render whole ".repeat(
      3,
    );
  model = apply(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: elements.id,
    item: { text: longText.trim(), modality: "optional", evals: {} },
  });
  const itemId = model.sections.find((s) => s.kind === "elements")!.items[0].id;
  return { model, itemId };
}

test("board script parses as valid JavaScript", () => {
  const html = buildBoardHtml(emptyModel("tep"), { selection: [], cut: [] });
  const script = html.slice(
    html.indexOf("<script>") + 8,
    html.lastIndexOf("</script>"),
  );
  assert.doesNotThrow(() => new Function(script));
});

test("full item text renders untruncated", () => {
  const { model } = seeded();
  const html = buildBoardHtml(model, { selection: [], cut: [] });
  assert.ok(
    html.includes(
      "the board must render whole a deliberately long element text",
    ),
  );
});

test("selection renders as .sel, cut as .cut with badge; action bar shows only with selection", () => {
  const { model, itemId } = seeded();
  const none = buildBoardHtml(model, { selection: [], cut: [] });
  assert.ok(!none.includes('class="item sel"'));
  assert.ok(none.includes('class="bar "') || !none.includes('class="bar show"'));
  const withSel = buildBoardHtml(model, { selection: [itemId], cut: [itemId] });
  assert.ok(withSel.includes("item sel cut"));
  assert.ok(withSel.includes('class="badge cutb"'));
  assert.ok(withSel.includes('class="bar show"'));
  assert.ok(withSel.includes("1 selected"));
});

test("settled state is a checked checkbox; the row carries data-item for selection", () => {
  let { model, itemId } = seeded();
  model = apply(model, { type: "checkItem", actor: "human", itemId });
  const html = buildBoardHtml(model, { selection: [], cut: [] });
  assert.ok(html.includes(`data-check="${itemId}" checked`));
  assert.ok(html.includes(`data-item="${itemId}"`));
});

test("detail carries provenance notes, eval controls, and pending-edit resolution", () => {
  let { model, itemId } = seeded();
  model = apply(model, {
    type: "addItemNote",
    actor: "human",
    itemId,
    text: "Why: it matters.",
  });
  const html = buildBoardHtml(model, { selection: [], cut: [] });
  assert.ok(html.includes('<span class="noteby">human</span>'));
  assert.ok(html.includes("<b>Why:</b> it matters."));
  assert.ok(html.includes(`data-eval="complexity" data-val="2" data-id="${itemId}"`));
  assert.ok(html.includes(`data-resolve="${itemId}"`));
});

test("action bar carries every approved verb and no others", () => {
  const { model, itemId } = seeded();
  const html = buildBoardHtml(model, { selection: [itemId], cut: [] });
  for (const needle of [
    'data-verb="check"',
    'data-verb="defer"',
    'data-verb="drop"',
    'data-act="setcut"',
    'data-act="ask"',
    'data-act="clearsel"',
  ]) {
    assert.ok(html.includes(needle), needle);
  }
  // No per-row buttons: research/why/explain never appear on board rows.
  assert.ok(!html.includes("data-research"));
  assert.ok(!html.includes("Prefill"));
});

test("panic is a top-bar sovereign act wired to the panic message", () => {
  const html = buildBoardHtml(emptyModel("tep"), { selection: [], cut: [] });
  assert.ok(html.includes('data-act="panic"'));
  assert.ok(html.includes("journal and assumptions survive"));
  const script = html.slice(
    html.indexOf("<script>") + 8,
    html.lastIndexOf("</script>"),
  );
  assert.ok(script.includes("act==='panic'"));
});

test("freeze button disabled while the gate blocks; journal fold lists entries", () => {
  let model = emptyModel("tep");
  model = apply(model, { type: "addRoughRequest", text: "second entry" });
  const html = buildBoardHtml(model, { selection: [], cut: [] });
  assert.ok(html.includes('data-act="freeze" disabled'));
  assert.ok(html.includes("Journal (2)"));
  assert.ok(html.includes("second entry"));
});

test("Why/Impact/Modality notes render as three bold-labeled lines (2026-07-18)", async () => {
  const { splitExplainNote } = await import("./board");
  const parts = splitExplainNote(
    "Why: the journal requires it. Impact: without it the gate lies. Modality: mandatory because the goal names it.",
  );
  assert.deepEqual(
    parts?.map((p) => p.label),
    ["Why", "Impact", "Modality"],
  );
  assert.ok(parts?.[0].body.startsWith("the journal requires it"));
  assert.ok(parts?.[2].body.startsWith("mandatory because"));
  // Unstructured notes pass through untouched.
  assert.equal(splitExplainNote("just a remark"), null);

  let model = emptyModel("tep");
  const elements = model.sections.find((s) => s.kind === "elements")!;
  model = apply(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: elements.id,
    item: {
      text: "an element",
      modality: "optional",
      evals: {},
      note: "Why: reason. Impact: consequence. Modality: optional because minor.",
    },
  });
  const html = buildBoardHtml(model, { selection: [], cut: [] });
  assert.ok(html.includes("<b>Why:</b> reason."));
  assert.ok(html.includes("<b>Impact:</b> consequence."));
  assert.ok(html.includes("<b>Modality:</b> optional because minor."));
  assert.ok(html.includes('class="noteby"'));
});
