// SP-21/3 AC-10 — A new item can supersede a shipped one.
//
// WHY (INVARIANT): When a new active item declares it supersedes a locked shipped
// item, the reducer must write supersedes on the new item AND supersededBy on the
// shipped item — both ends of the link. Both markers must appear in the rendered HTML
// (data-supersedes on the new item's element, data-superseded-by on the shipped
// item's element). The delta projection must include the superseding item (because it
// is checked+active) and must exclude the shipped item (because its state is "shipped").
// The projection's body must record the supersede relationship.
//
// This must hold forever — any refactor that records only one end of the link, or
// that drops the supersede annotation from the projection body, silently breaks the
// revision trail of the intent.

import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "../scratchpad/model";
import type { Action, WorkingModel } from "../scratchpad/model";
import { buildScratchpadHtml } from "../scratchpad/views/document";
import type { Delta } from "../scratchpad/model";
import { projectDelta } from "../scratchpad/projection";

// ── Local SP-3 type helpers ───────────────────────────────────────────────────

interface SP3Item {
  id: string;
  text: string;
  checked: boolean;
  modality: string;
  evals: { complexity?: number; risk?: number };
  origin: string;
  state: string;
  shippedIn?: string;
  supersedes?: string;
  supersededBy?: string;
  evidence: unknown[];
  notes: unknown[];
}

interface SP3Section {
  id: string;
  kind: string;
  items: SP3Item[];
}

interface SP3Model {
  sections: SP3Section[];
}

type AnyDelta = {
  kind: string;
  reason?: string;
  field?: string;
  before?: unknown;
  after?: unknown;
};

type ReduceResult = { model: WorkingModel; delta: AnyDelta };

function apply(
  model: WorkingModel,
  action: Record<string, unknown>,
): ReduceResult {
  return reduce(model, action as unknown as Action) as unknown as ReduceResult;
}

function sp3(model: WorkingModel): SP3Model {
  return model as unknown as SP3Model;
}

// ── Test model builder ────────────────────────────────────────────────────────

/**
 * Build the test scenario:
 *   1. Add a human item (constraints section) → born-checked, active.
 *   2. stampShipped → item becomes state:'shipped', shippedIn:'TEP-SHIPPED'.
 *   3. Add a new human item → born-checked, active (the superseding candidate).
 * Returns the model and both item ids.
 */
function buildScenario(): {
  model: WorkingModel;
  shippedItemId: string;
  newItemId: string;
  sectionId: string;
  shippedItemText: string;
  newItemText: string;
} {
  const shippedItemText = "SHIPPEDITEMTEXT";
  const newItemText = "NEWITEMSUPERSEDESTEXT";

  let model = emptyModel("tep");
  const constraintsSec = sp3(model).sections.find(
    (s) => s.kind === "constraints",
  );
  assert.ok(
    constraintsSec,
    "emptyModel (SP-3) must seed a constraints section — precondition for AC-10",
  );
  const sectionId = constraintsSec.id;

  // 1. Add first item as human (born-checked, active)
  ({ model } = apply(model, {
    type: "addItem",
    actor: "human",
    sectionId,
    text: shippedItemText,
  }));

  const shippedItemId = sp3(model).sections.find(
    (s) => s.kind === "constraints",
  )!.items[0].id;

  // 2. Stamp as shipped — state:'shipped', shippedIn set
  ({ model } = apply(model, {
    type: "stampShipped",
    itemIds: [shippedItemId],
    tepId: "TEP-SHIPPED",
  }));

  assert.equal(
    sp3(model)
      .sections.find((s) => s.kind === "constraints")!
      .items.find((i) => i.id === shippedItemId)!.state,
    "shipped",
    "precondition: first item must be state:'shipped' after stampShipped",
  );

  // 3. Add the new superseding item as human (born-checked, active)
  ({ model } = apply(model, {
    type: "addItem",
    actor: "human",
    sectionId,
    text: newItemText,
  }));

  const newItemId = sp3(model)
    .sections.find((s) => s.kind === "constraints")!
    .items.find((i) => i.text === newItemText)!.id;

  return {
    model,
    shippedItemId,
    newItemId,
    sectionId,
    shippedItemText,
    newItemText,
  };
}

// ── supersedeItem writes BOTH ends of the link ────────────────────────────────

test("supersedeItem (human actor) — writes supersedes on the new item AND supersededBy on the shipped item", () => {
  const { model: before, shippedItemId, newItemId } = buildScenario();

  const { model, delta } = apply(before, {
    type: "supersedeItem",
    actor: "human",
    itemId: newItemId,
    supersedes: shippedItemId,
  });

  assert.equal(
    delta.kind,
    "applied",
    "supersedeItem with actor:'human' must produce an 'applied' delta",
  );

  const sec = sp3(model).sections.find((s) => s.kind === "constraints")!;
  const newItem = sec.items.find((i) => i.id === newItemId)!;
  const shippedItem = sec.items.find((i) => i.id === shippedItemId)!;

  // New item: supersedes → shipped item's id
  assert.equal(
    newItem.supersedes,
    shippedItemId,
    "new item must carry supersedes pointing at the shipped item's id",
  );

  // Shipped item: supersededBy → new item's id
  assert.equal(
    shippedItem.supersededBy,
    newItemId,
    "shipped item must carry supersededBy pointing at the new item's id — both ends of the link",
  );
});

test("supersedeItem: new item remains checked+active after the link is written", () => {
  const { model: before, shippedItemId, newItemId } = buildScenario();
  const { model } = apply(before, {
    type: "supersedeItem",
    actor: "human",
    itemId: newItemId,
    supersedes: shippedItemId,
  });

  const newItem = sp3(model)
    .sections.find((s) => s.kind === "constraints")!
    .items.find((i) => i.id === newItemId)!;

  assert.equal(
    newItem.state,
    "active",
    "superseding item must remain state:'active' — supersedeItem only writes the link, not the state",
  );
  assert.equal(
    newItem.checked,
    true,
    "superseding item must remain checked — the human checked it via addItem",
  );
});

test("supersedeItem: shipped item remains state:'shipped' after the link is written", () => {
  const { model: before, shippedItemId, newItemId } = buildScenario();
  const { model } = apply(before, {
    type: "supersedeItem",
    actor: "human",
    itemId: newItemId,
    supersedes: shippedItemId,
  });

  const shippedItem = sp3(model)
    .sections.find((s) => s.kind === "constraints")!
    .items.find((i) => i.id === shippedItemId)!;

  assert.equal(
    shippedItem.state,
    "shipped",
    "shipped item must remain state:'shipped' — supersedeItem does not change it",
  );
  assert.equal(
    shippedItem.shippedIn,
    "TEP-SHIPPED",
    "shippedIn must still name the TEP that shipped it",
  );
});

// ── Both markers appear in the rendered HTML ──────────────────────────────────

test("renderedHtml: data-supersedes on the new item element and data-superseded-by on the shipped item element", () => {
  const { model: before, shippedItemId, newItemId } = buildScenario();
  const { model } = apply(before, {
    type: "supersedeItem",
    actor: "human",
    itemId: newItemId,
    supersedes: shippedItemId,
  });

  const html = buildScratchpadHtml(model, [] as unknown as Delta[]);

  // New item must carry data-supersedes="<shippedItemId>"
  assert.ok(
    html.includes(`data-supersedes="${shippedItemId}"`),
    `renderedHtml() must carry data-supersedes="${shippedItemId}" on the superseding item element`,
  );

  // Shipped item must carry data-superseded-by="<newItemId>"
  assert.ok(
    html.includes(`data-superseded-by="${newItemId}"`),
    `renderedHtml() must carry data-superseded-by="${newItemId}" on the shipped item element`,
  );
});

test("renderedHtml: both items appear in the panel after supersedeItem", () => {
  const {
    model: before,
    shippedItemId,
    newItemId,
    shippedItemText,
    newItemText,
  } = buildScenario();
  const { model } = apply(before, {
    type: "supersedeItem",
    actor: "human",
    itemId: newItemId,
    supersedes: shippedItemId,
  });

  const html = buildScratchpadHtml(model, [] as unknown as Delta[]);

  assert.ok(
    html.includes(shippedItemText),
    `renderedHtml() must include the shipped item text '${shippedItemText}' — ` +
      "shipped items remain visible (locked) in the panel",
  );
  assert.ok(
    html.includes(newItemText),
    `renderedHtml() must include the new item text '${newItemText}'`,
  );
});

test("renderedHtml: shipped item element carries data-state='shipped' and data-shipped-in", () => {
  const { model: before, shippedItemId, newItemId } = buildScenario();
  const { model } = apply(before, {
    type: "supersedeItem",
    actor: "human",
    itemId: newItemId,
    supersedes: shippedItemId,
  });

  const html = buildScratchpadHtml(model, [] as unknown as Delta[]);

  assert.ok(
    html.includes('data-state="shipped"'),
    "renderedHtml() must carry data-state='shipped' on the locked shipped item element",
  );
  assert.ok(
    html.includes('data-shipped-in="TEP-SHIPPED"'),
    "renderedHtml() must carry data-shipped-in='TEP-SHIPPED' on the shipped item element",
  );
});

// ── projectDelta includes the superseding item, not the shipped item ──────────

test("projectDelta — includes the superseding item (checked+active), excludes the shipped item", () => {
  const { model: before, shippedItemId, newItemId } = buildScenario();
  const { model } = apply(before, {
    type: "supersedeItem",
    actor: "human",
    itemId: newItemId,
    supersedes: shippedItemId,
  });

  const projection = projectDelta(model);

  assert.ok(
    projection.itemIds.includes(newItemId),
    "projectDelta must include the superseding item id — it is checked+active",
  );
  assert.ok(
    !projection.itemIds.includes(shippedItemId),
    "projectDelta must NOT include the shipped item id — state:'shipped' excludes it",
  );
});

test("projectDelta body — the superseding item's line carries a supersedes annotation", () => {
  const {
    model: before,
    shippedItemId,
    newItemId,
    shippedItemText,
  } = buildScenario();
  const { model } = apply(before, {
    type: "supersedeItem",
    actor: "human",
    itemId: newItemId,
    supersedes: shippedItemId,
  });

  const projection = projectDelta(model);

  // The contract says: "a superseding item's body line carries '(supersedes <shipped item text>)'"
  assert.ok(
    projection.body.toLowerCase().includes("supersedes"),
    "projectDelta.body must reference the supersede relationship — " +
      "the body line for the new item must carry a supersedes annotation",
  );
  assert.ok(
    projection.body.includes(shippedItemText),
    `projectDelta.body must include the shipped item text '${shippedItemText}' as the supersede target`,
  );
});

test("projectDelta: title and itemIds are well-formed", () => {
  const { model: before, shippedItemId, newItemId } = buildScenario();
  const { model } = apply(before, {
    type: "supersedeItem",
    actor: "human",
    itemId: newItemId,
    supersedes: shippedItemId,
  });

  const projection = projectDelta(model);

  assert.ok(
    typeof projection.title === "string",
    "projectDelta must return a string title",
  );
  assert.ok(
    Array.isArray(projection.itemIds),
    "projectDelta must return an itemIds array",
  );
  assert.ok(
    typeof projection.body === "string" && projection.body.length > 0,
    "projectDelta must return a non-empty body string",
  );
});

// ── Non-human actor on supersedeItem behaves per the gate ────────────────────
//
// WHY: supersedeItem itself is not a checked-affecting action, so whether non-human
// actors are permitted (as a proposal) or only human is a gate decision. The contract
// says: { type:"supersedeItem"; actor; itemId: string; supersedes: string } — the
// 'actor' field is unqualified. A non-human supersedeItem should be treated as a
// proposal (not rejected). This test documents the behaviour for a worker-sourced
// supersede action so the invariant is explicit.

test("supersedeItem with non-human actor (gap-filler) — applied as a proposal, not rejected", () => {
  const { model: before, shippedItemId, newItemId } = buildScenario();

  const { model, delta } = apply(before, {
    type: "supersedeItem",
    actor: "gap-filler",
    itemId: newItemId,
    supersedes: shippedItemId,
  });

  // supersedeItem is NOT a checked-affecting action — it should be applied (proposed)
  // even from a non-human actor. The gate does not reject it.
  assert.equal(
    delta.kind,
    "applied",
    "supersedeItem from a non-human actor must be applied — " +
      "it is not a checked-affecting action and does not violate the human-only invariant",
  );

  const sec = sp3(model).sections.find((s) => s.kind === "constraints")!;
  const newItem = sec.items.find((i) => i.id === newItemId)!;
  assert.equal(
    newItem.supersedes,
    shippedItemId,
    "supersedeItem from gap-filler must still write the supersedes link",
  );
});
