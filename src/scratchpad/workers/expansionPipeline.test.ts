/**
 * Staged expansion pipeline (2026-07-18): prompt builders enforce the
 * elements-root model — stage 1 iterates the journal and sets servesEntry;
 * stages 2-4 iterate elements and demand a requires edge (orphan rule at
 * the source).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "../model";
import type { WorkingModel } from "../model";
import {
  buildStagePrompt,
  EXPANSION_STAGES,
  journalEntries,
  liveElements,
} from "./expansionPipeline";

function seeded(): { model: WorkingModel; elementId: string } {
  let model = emptyModel("tep");
  model = reduce(model, { type: "seedGoal", text: "extend the graph" }).model;
  model = reduce(model, {
    type: "addRoughRequest",
    text: "harden verification",
  }).model;
  const elements = model.sections.find((s) => s.kind === "elements")!;
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: elements.id,
    item: { text: "auditor nodes", modality: "optional", evals: {}, servesEntry: 1 },
  }).model;
  const elementId = model.sections.find((s) => s.kind === "elements")!.items[0].id;
  return { model, elementId };
}

test("stages are elements → constraints → gap → acceptance", () => {
  assert.deepEqual(EXPANSION_STAGES, [
    "elements",
    "constraints",
    "gap",
    "acceptance",
  ]);
});

test("journal entries number the goal as entry 1", () => {
  const { model } = seeded();
  assert.deepEqual(journalEntries(model), [
    "extend the graph",
    "harden verification",
  ]);
});

test("stage 1 (elements) iterates the journal, demands servesEntry, targets only elements", () => {
  const { model } = seeded();
  const p = buildStagePrompt("elements", model);
  assert.ok(p.includes("STAGE 1"));
  assert.ok(p.includes("1. extend the graph"));
  assert.ok(p.includes("2. harden verification"));
  assert.ok(p.includes("servesEntry"));
  const elId = model.sections.find((s) => s.kind === "elements")!.id;
  assert.ok(p.includes(`Propose ONLY into the elements section ("${elId}")`));
});

test("stages 2-4 list the live elements and demand a requires edge (orphan rule)", () => {
  const { model, elementId } = seeded();
  for (const stage of ["constraints", "gap", "acceptance"] as const) {
    const p = buildStagePrompt(stage, model);
    assert.ok(p.includes(elementId), `${stage} must list the element id`);
    assert.ok(p.includes("auditor nodes"), `${stage} lists element text`);
    assert.ok(
      p.includes('"requires" edge'),
      `${stage} must demand a requires edge`,
    );
    assert.ok(p.includes("ORPHAN"), `${stage} states the orphan rule`);
  }
});

test("liveElements returns active elements with ids", () => {
  const { model, elementId } = seeded();
  assert.deepEqual(liveElements(model), [
    { id: elementId, text: "auditor nodes" },
  ]);
});

test("parking a group defers its elements + private context, keeps shared context (2026-07-18)", async () => {
  const { groupItemIds } = await import("./expansionPipeline");
  let model = emptyModel("tep");
  // two elements, one per entry
  const propose = (kind: "elements" | "constraints", text: string, servesEntry?: number, requires?: string[]) => {
    const sectionId = model.sections.find((s) => s.kind === kind)!.id;
    model = reduce(model, {
      type: "proposeItem",
      actor: "gap-filler",
      sectionId,
      item: { text, modality: "optional", evals: {}, ...(servesEntry ? { servesEntry } : {}), ...(requires ? { requires } : {}) },
    }).model;
    const items = model.sections.find((s) => s.kind === kind)!.items;
    return items[items.length - 1].id;
  };
  const e1 = propose("elements", "entry-1 element", 1);
  const e2 = propose("elements", "entry-2 element", 2);
  const privC = propose("constraints", "private to e1", undefined, [e1]);
  const shared = propose("constraints", "shared", undefined, [e1, e2]);

  const parked = groupItemIds(model, 1);
  assert.ok(parked.includes(e1), "e1 element parked");
  assert.ok(parked.includes(privC), "e1's private constraint parked");
  assert.ok(!parked.includes(shared), "shared constraint stays live");
  assert.ok(!parked.includes(e2), "other group's element untouched");
});

test("reclassifyItem promotes an orphan into elements, preserving id + edges", () => {
  let model = emptyModel("tep");
  const cId = model.sections.find((s) => s.kind === "constraints")!.id;
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: cId,
    item: { text: "self-test harnesses", modality: "optional", evals: {} },
  }).model;
  const orphanId = model.sections.find((s) => s.kind === "constraints")!.items[0].id;
  // an acceptance item depends on it
  const aId = model.sections.find((s) => s.kind === "acceptance")!.id;
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: aId,
    item: { text: "harnesses fail loudly", modality: "optional", evals: {}, requires: [orphanId] },
  }).model;
  const { model: next, delta } = reduce(model, {
    type: "reclassifyItem",
    actor: "integrator",
    itemId: orphanId,
    toKind: "elements",
    servesEntry: 2,
  });
  assert.equal(delta.kind, "applied");
  const el = next.sections.find((s) => s.kind === "elements")!.items.find((it) => it.id === orphanId);
  assert.ok(el, "orphan now lives in elements");
  assert.equal(el!.servesEntry, 2);
  assert.equal(next.sections.find((s) => s.kind === "constraints")!.items.length, 0);
  // the acceptance edge still points at the (now element) id — no longer orphan
  const { computeIntegrity } = require("../integrityGate") as {
    computeIntegrity: (m: typeof next) => { orphans: unknown[] };
  };
  assert.equal(computeIntegrity(next).orphans.length, 0);
});

test("buildRepairPrompt lists orphans + elements and forbids drop/invent", async () => {
  const { buildRepairPrompt } = await import("./expansionPipeline");
  let model = emptyModel("tep");
  const elId = model.sections.find((s) => s.kind === "elements")!.id;
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: elId,
    item: { text: "an element", modality: "optional", evals: {}, servesEntry: 1 },
  }).model;
  const p = buildRepairPrompt(model, [
    { id: "item-x", kind: "constraints", text: "orphan constraint" },
  ]);
  assert.ok(p.includes("ORPHAN-REPAIR"));
  assert.ok(p.includes("orphan constraint"));
  assert.ok(p.includes("reclassifyItem"));
  assert.ok(p.includes("Do NOT invent elements or drop"));
});
