/**
 * Closing integrity gate (2026-07-18): orphan + coverage (deterministic) and
 * near-duplicate detection over the derived space.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "./model";
import type { Action, WorkingModel } from "./model";
import { computeIntegrity, integritySummary } from "./integrityGate";

function apply(model: WorkingModel, action: Action): WorkingModel {
  const { model: next, delta } = reduce(model, action);
  assert.equal(delta.kind, "applied", JSON.stringify(delta));
  return next;
}
function propose(
  model: WorkingModel,
  kind: "elements" | "constraints" | "gap" | "acceptance",
  text: string,
  requires?: string[],
): { model: WorkingModel; id: string } {
  const sectionId = model.sections.find((s) => s.kind === kind)!.id;
  const next = apply(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId,
    item: { text, modality: "optional", evals: {}, ...(requires ? { requires } : {}) },
  });
  const items = next.sections.find((s) => s.kind === kind)!.items;
  return { model: next, id: items[items.length - 1].id };
}

test("a well-formed space (element + linked acceptance) is clean", () => {
  let { model, id: el } = propose(emptyModel("tep"), "elements", "an element");
  model = propose(model, "acceptance", "done when X", [el]).model;
  const r = computeIntegrity(model);
  assert.ok(r.clean, JSON.stringify(r));
  assert.ok(integritySummary(r).includes("clean"));
});

test("an unlinked constraint is an orphan", () => {
  let { model, id: el } = propose(emptyModel("tep"), "elements", "an element");
  model = propose(model, "acceptance", "done when X", [el]).model;
  model = propose(model, "constraints", "a floating constraint").model; // no edge
  const r = computeIntegrity(model);
  assert.equal(r.orphans.length, 1);
  assert.equal(r.orphans[0].kind, "constraints");
  assert.ok(!r.clean);
  assert.ok(integritySummary(r).includes("orphan"));
});

test("an element with no acceptance is uncovered", () => {
  const { model } = propose(emptyModel("tep"), "elements", "lonely element");
  const r = computeIntegrity(model);
  assert.equal(r.uncoveredElements.length, 1);
  assert.equal(r.uncoveredElements[0].text, "lonely element");
});

test("near-duplicate active items are surfaced as a pair", () => {
  let { model, id: el } = propose(emptyModel("tep"), "elements", "el");
  model = propose(
    model,
    "constraints",
    "the panel must page through output without leaving the graph view",
    [el],
  ).model;
  model = propose(
    model,
    "constraints",
    "the panel must page through output without leaving the graph screen",
    [el],
  ).model;
  const r = computeIntegrity(model);
  assert.equal(r.duplicates.length, 1);
});

test("transitive linkage (gap ← constraint ← element) is NOT an orphan", () => {
  let { model, id: el } = propose(emptyModel("tep"), "elements", "el");
  const c = propose(model, "constraints", "a constraint", [el]);
  model = c.model;
  model = propose(model, "gap", "an unknown", [c.id]).model;
  const r = computeIntegrity(model);
  assert.equal(r.orphans.length, 0);
});
