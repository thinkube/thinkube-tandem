/**
 * Tests for the native items tree's pure core (Phase D, 2026-07-17):
 * description/tooltip rendering, protection, cut ranking, gate report.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "../model";
import type { Action, WorkingModel } from "../model";
import {
  isProtectedItem,
  itemDescription,
  itemTooltip,
  rankElementsForCut,
  renderGateReport,
} from "./itemsTreeCore";

function apply(model: WorkingModel, action: Action): WorkingModel {
  const { model: next, delta } = reduce(model, action);
  assert.equal(delta.kind, "applied", JSON.stringify(delta));
  return next;
}

function withElement(text = "an element"): {
  model: WorkingModel;
  itemId: string;
} {
  let model = emptyModel("tep");
  const elements = model.sections.find((s) => s.kind === "elements")!;
  model = apply(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: elements.id,
    item: { text, modality: "optional", evals: {} },
  });
  const itemId = model.sections.find((s) => s.kind === "elements")!.items[0].id;
  return { model, itemId };
}

test("description carries evals, modality, flags, and non-active state", () => {
  let { model, itemId } = withElement();
  model = apply(model, {
    type: "setEval",
    actor: "human",
    itemId,
    facet: "complexity",
    value: 2,
  });
  model = apply(model, {
    type: "setEval",
    actor: "human",
    itemId,
    facet: "risk",
    value: 3,
  });
  model = apply(model, {
    type: "setModality",
    actor: "human",
    itemId,
    modality: "mandatory",
  });
  const item = model.sections.find((s) => s.kind === "elements")!.items[0];
  const desc = itemDescription(item);
  assert.ok(desc.includes("C2"));
  assert.ok(desc.includes("R3"));
  assert.ok(desc.includes("mandatory"));
});

test("flagged and shipped items are protected; plain active items are not", () => {
  const { model, itemId } = withElement();
  const item = model.sections.find((s) => s.kind === "elements")!.items[0];
  assert.equal(isProtectedItem(item), false);
  const flagged = { ...item, flaggedBy: ["TEP-1"] };
  assert.equal(isProtectedItem(flagged), true);
  const shipped = { ...item, state: "shipped" as const };
  assert.equal(isProtectedItem(shipped), true);
  assert.ok(itemDescription(flagged).includes("⚑TEP-1"));
  void itemId;
});

test("tooltip lists notes with provenance and dependency edges by text", () => {
  let { model, itemId } = withElement("the element");
  const constraints = model.sections.find((s) => s.kind === "constraints")!;
  model = apply(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: constraints.id,
    item: { text: "a constraint", modality: "optional", evals: {} },
  });
  const constraintId = model.sections.find((s) => s.kind === "constraints")!
    .items[0].id;
  model = apply(model, {
    type: "linkItems",
    actor: "integrator",
    itemId,
    requires: [constraintId],
  });
  model = apply(model, {
    type: "addItemNote",
    actor: "human",
    itemId,
    text: "Why: because.",
  });
  const item = model.sections.find((s) => s.kind === "elements")!.items[0];
  const tip = itemTooltip(item, model);
  assert.ok(tip.includes("**human**: Why: because."));
  assert.ok(tip.includes("requires: a constraint"));
});

test("cut ranking orders settled elements by fewest blockers", () => {
  let model = emptyModel("tep");
  const elements = model.sections.find((s) => s.kind === "elements")!;
  for (const text of ["heavy element", "light element"]) {
    model = apply(model, {
      type: "proposeItem",
      actor: "gap-filler",
      sectionId: elements.id,
      item: { text, modality: "optional", evals: {} },
    });
  }
  const [heavy, light] = model.sections.find((s) => s.kind === "elements")!
    .items;
  model = apply(model, { type: "checkItem", actor: "human", itemId: heavy.id });
  model = apply(model, { type: "checkItem", actor: "human", itemId: light.id });
  // Give "light" linked settled criteria+verification so it has fewer blockers.
  for (const kind of ["acceptance"] as const) {
    const sec = model.sections.find((s) => s.kind === kind)!;
    model = apply(model, {
      type: "proposeItem",
      actor: "gap-filler",
      sectionId: sec.id,
      item: { text: `${kind} for light`, modality: "optional", evals: {} },
    });
    const linked = model.sections
      .find((s) => s.kind === kind)!
      .items.slice(-1)[0];
    model = apply(model, {
      type: "checkItem",
      actor: "human",
      itemId: linked.id,
    });
    model = apply(model, {
      type: "linkItems",
      actor: "integrator",
      itemId: light.id,
      requires: [linked.id],
    });
  }
  const ranked = rankElementsForCut(model);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].text, "light element");
  assert.ok(ranked[0].blockers < ranked[1].blockers);
});

test("gate report renders verdict, per-element blockers, and journal coverage", () => {
  const { model, itemId } = withElement("the element");
  const checked = apply(model, {
    type: "checkItem",
    actor: "human",
    itemId,
  });
  const report = renderGateReport(checked);
  assert.ok(report.startsWith("# Gate report"));
  assert.ok(report.includes("BLOCKED"));
  assert.ok(report.includes("the element"));
  assert.ok(report.includes("BLOCKER:"));
  assert.ok(report.includes("## Journal coverage"));
});

test("unsettled spaces produce an empty ranking", () => {
  const { model } = withElement();
  assert.deepEqual(rankElementsForCut(model), []);
});
