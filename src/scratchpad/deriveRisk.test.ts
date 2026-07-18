/**
 * Derived-risk tests (expansion redesign 2026-07-18): risk = a pure function
 * of open gaps reachable through requires edges; falls as gaps close;
 * rationale names the drivers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "./model";
import type { Action, WorkingModel } from "./model";
import { computeElementRisk, riskBucket } from "./deriveRisk";

function apply(model: WorkingModel, action: Action): WorkingModel {
  const { model: next, delta } = reduce(model, action);
  assert.equal(delta.kind, "applied", JSON.stringify(delta));
  return next;
}

function propose(
  model: WorkingModel,
  kind: "elements" | "gap" | "constraints",
  text: string,
): { model: WorkingModel; id: string } {
  const sectionId = model.sections.find((s) => s.kind === kind)!.id;
  const next = apply(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId,
    item: { text, modality: "optional", evals: {} },
  });
  const items = next.sections.find((s) => s.kind === kind)!.items;
  return { model: next, id: items[items.length - 1].id };
}

test("bucket thresholds: 0 → 1, 1-2 → 2, 3+ → 3", () => {
  assert.equal(riskBucket(0), 1);
  assert.equal(riskBucket(1), 2);
  assert.equal(riskBucket(2), 2);
  assert.equal(riskBucket(3), 3);
  assert.equal(riskBucket(9), 3);
});

test("an element with no gaps in reach is risk 1", () => {
  const { model, id } = propose(emptyModel("tep"), "elements", "an element");
  const r = computeElementRisk(model, id);
  assert.equal(r.score, 1);
  assert.equal(r.openGaps.length, 0);
  assert.ok(r.rationale.includes("no open gaps"));
});

test("risk rises with linked open gaps and the rationale names them", () => {
  let { model, id: elementId } = propose(
    emptyModel("tep"),
    "elements",
    "the graph element",
  );
  const gapTexts = ["auditor metadata source", "log-capture sites", "renderer"];
  const gapIds: string[] = [];
  for (const t of gapTexts) {
    const r = propose(model, "gap", t);
    model = r.model;
    gapIds.push(r.id);
  }
  // Link all three gaps to the element (derivation records the edges).
  model = apply(model, {
    type: "linkItems",
    actor: "integrator",
    itemId: elementId,
    requires: gapIds,
  });
  const r = computeElementRisk(model, elementId);
  assert.equal(r.score, 3);
  assert.equal(r.openGaps.length, 3);
  assert.ok(r.rationale.includes("auditor metadata source"));

  // Resolve one gap → still 2 open → risk 2.
  model = apply(model, {
    type: "resolveItem",
    actor: "human",
    itemId: gapIds[0],
  });
  assert.equal(computeElementRisk(model, elementId).score, 2);

  // Resolve the rest → 0 open → risk 1.
  model = apply(model, { type: "resolveItem", actor: "human", itemId: gapIds[1] });
  model = apply(model, { type: "resolveItem", actor: "human", itemId: gapIds[2] });
  const done = computeElementRisk(model, elementId);
  assert.equal(done.score, 1);
  assert.ok(done.rationale.includes("no open gaps"));
});

test("gaps reachable transitively (element ← constraint ← gap) still count", () => {
  let { model, id: elementId } = propose(
    emptyModel("tep"),
    "elements",
    "el",
  );
  const c = propose(model, "constraints", "a constraint");
  model = c.model;
  const g = propose(model, "gap", "an unknown");
  model = g.model;
  // element ← constraint, constraint ← gap
  model = apply(model, {
    type: "linkItems",
    actor: "integrator",
    itemId: c.id,
    requires: [elementId],
  });
  model = apply(model, {
    type: "linkItems",
    actor: "integrator",
    itemId: g.id,
    requires: [c.id],
  });
  assert.equal(computeElementRisk(model, elementId).openGaps.length, 1);
});
