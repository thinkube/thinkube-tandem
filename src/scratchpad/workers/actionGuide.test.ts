/**
 * Unit tests for the action guide + normalization seam (field defect,
 * 2026-07-16): a worker emitted {"tool":"proposeItem","section":"Context",...}
 * — a shape it invented because the prompt disclosed neither the Action type
 * nor any sectionId — and the reducer's exhaustive switch threw "Unknown
 * action" into the UI, aborting the round mid-dispatch.
 *
 * Run via the repo recipe: compiled by tsconfig.test.json, executed with
 * `node --test` (node:test + node:assert, no framework).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "../model";
import type { Action, WorkingModel } from "../model";
import {
  normalizeWorkerActions,
  renderActionGuide,
} from "./actionGuide";
import { GATES } from "./worker";

function modelWithItem(): { model: WorkingModel; itemId: string } {
  let model = emptyModel("tep");
  const constraints = model.sections.find((s) => s.kind === "constraints");
  assert.ok(constraints);
  const action: Action = {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: constraints.id,
    item: { text: "an existing item", modality: "optional", evals: {} },
  };
  const { model: next } = reduce(model, action);
  model = next;
  const itemId = model.sections.find((s) => s.kind === "constraints")!.items[0]
    .id;
  return { model, itemId };
}

// ── The exact payload from the field ─────────────────────────────────────────

test("the 2026-07-16 field payload is rejected with a readable reason, not a throw", () => {
  const model = emptyModel("tep");
  const fieldPayload = {
    tool: "proposeItem",
    section: "Context",
    text: "The orchestration graph currently does not include all steps — auditors and the closing gate node are missing from the visualization",
    checked: false,
    state: "active",
  };
  const { valid, rejected } = normalizeWorkerActions([fieldPayload], model, {
    defaultActor: "gap-filler",
    allowedTools: GATES.gapFiller.allowedTools,
  });
  // "Context" is not a real section kind — the action cannot be salvaged, but
  // it must land as a rejection with a reason instead of reaching the reducer.
  assert.equal(valid.length, 0);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /unknown section/);
});

test("the same drifted shape with a REAL section kind is fully salvaged", () => {
  const model = emptyModel("tep");
  const { valid, rejected } = normalizeWorkerActions(
    [
      {
        tool: "proposeItem",
        section: "Constraints",
        text: "salvageable item",
        checked: false,
        state: "active",
      },
    ],
    model,
    {
      defaultActor: "gap-filler",
      allowedTools: GATES.gapFiller.allowedTools,
    },
  );
  assert.equal(rejected.length, 0);
  assert.equal(valid.length, 1);
  const a = valid[0];
  assert.equal(a.type, "proposeItem");
  if (a.type !== "proposeItem") return;
  assert.equal(a.actor, "gap-filler");
  assert.equal(
    a.sectionId,
    model.sections.find((s) => s.kind === "constraints")!.id,
  );
  assert.equal(a.item.text, "salvageable item");
  assert.equal(a.item.modality, "optional");
  // And the reducer applies it cleanly.
  const { delta } = reduce(model, a);
  assert.equal(delta.kind, "applied");
});

// ── Shape coercion details ────────────────────────────────────────────────────

test("a canonical well-formed action passes through unchanged", () => {
  const model = emptyModel("tep");
  const sectionId = model.sections.find((s) => s.kind === "elements")!.id;
  const canonical: Action = {
    type: "proposeItem",
    actor: "research",
    sectionId,
    item: { text: "canonical", modality: "mandatory", evals: { risk: 3 } },
  };
  const { valid, rejected } = normalizeWorkerActions([canonical], model, {
    defaultActor: "research",
    allowedTools: GATES.research.allowedTools,
  });
  assert.equal(rejected.length, 0);
  assert.deepEqual(valid[0], canonical);
});

test("gate enforcement: an out-of-gate action type is rejected", () => {
  const model = emptyModel("tep");
  const { valid, rejected } = normalizeWorkerActions(
    [{ type: "editGoal", text: "worker tries to rewrite the goal" }],
    model,
    {
      defaultActor: "gap-filler",
      allowedTools: GATES.gapFiller.allowedTools, // proposeItem, addItemNote only
    },
  );
  assert.equal(valid.length, 0);
  assert.match(rejected[0].reason, /outside this worker's gate/);
});

test("items cannot be proposed on the goal section", () => {
  const model = emptyModel("tep");
  const { valid, rejected } = normalizeWorkerActions(
    [{ type: "proposeItem", section: "goal", text: "sneaky goal item" }],
    model,
    {
      defaultActor: "gap-filler",
      allowedTools: GATES.gapFiller.allowedTools,
    },
  );
  assert.equal(valid.length, 0);
  assert.match(rejected[0].reason, /goal section/);
});

test("item-targeting actions resolve real item ids and reject invented ones", () => {
  const { model, itemId } = modelWithItem();
  const { valid, rejected } = normalizeWorkerActions(
    [
      { type: "addItemNote", itemId, text: "a note" },
      { type: "addItemNote", itemId: "item-invented-99", text: "ghost note" },
    ],
    model,
    {
      defaultActor: "integrator",
      allowedTools: GATES.integrator.allowedTools,
    },
  );
  assert.equal(valid.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /unknown item/);
});

test("attachEvidence fills a missing checkedAt from nowIso and applies", () => {
  const { model, itemId } = modelWithItem();
  const { valid, rejected } = normalizeWorkerActions(
    [
      {
        type: "attachEvidence",
        itemId,
        evidence: { source: "npm registry", method: "tk-package-version" },
      },
    ],
    model,
    {
      defaultActor: "research",
      allowedTools: GATES.research.allowedTools,
      nowIso: "2026-07-16T00:00:00.000Z",
    },
  );
  assert.equal(rejected.length, 0);
  const a = valid[0];
  assert.equal(a.type, "attachEvidence");
  if (a.type !== "attachEvidence") return;
  assert.equal(a.evidence.checkedAt, "2026-07-16T00:00:00.000Z");
  const { delta } = reduce(model, a);
  assert.equal(delta.kind, "applied");
});

test("non-object and typeless entries are rejected without throwing", () => {
  const model = emptyModel("tep");
  const { valid, rejected } = normalizeWorkerActions(
    ["just a string", null, { sectionId: "sec-1" }],
    model,
    {
      defaultActor: "gap-filler",
      allowedTools: GATES.gapFiller.allowedTools,
    },
  );
  assert.equal(valid.length, 0);
  assert.equal(rejected.length, 3);
});

// ── renderActionGuide ─────────────────────────────────────────────────────────

test("the guide discloses live sectionIds and the exact proposeItem shape", () => {
  const model = emptyModel("tep");
  const guide = renderActionGuide(
    model,
    GATES.gapFiller.allowedTools,
    "gap-filler",
  );
  // Every non-goal section id is disclosed verbatim.
  for (const sec of model.sections) {
    if (sec.kind === "goal") continue;
    assert.ok(guide.includes(`"${sec.id}"`), `guide missing ${sec.id}`);
  }
  // The worked example uses the canonical keys.
  assert.ok(guide.includes('"type":"proposeItem"'));
  assert.ok(guide.includes('"actor":"gap-filler"'));
  assert.ok(guide.includes('"sectionId"'));
  assert.ok(guide.includes('never "tool"'));
});

test("the reframe guide leaks no section/item IDs (editGoal takes none)", () => {
  const { model } = modelWithItem();
  const guide = renderActionGuide(model, ["editGoal"], "integrator");
  // reframe's contract: the prompt carries checked items only — the guide must
  // not re-introduce item texts or IDs the gate's tools never consume.
  assert.ok(!guide.includes("an existing item"));
  assert.ok(!guide.includes("Live sections"));
  assert.ok(!guide.includes("Live items"));
  assert.ok(guide.includes('"type":"editGoal"'));
});

// ── Dependency edges (requires) ──────────────────────────────────────────────

test("requires edges resolve: existing id, existing text, and intra-batch text → predicted id", () => {
  const { model, itemId } = modelWithItem(); // "an existing item" in constraints
  const { valid, rejected } = normalizeWorkerActions(
    [
      {
        type: "proposeItem",
        section: "elements",
        text: "first new item",
        requires: [itemId, "ghost reference"],
      },
      {
        type: "proposeItem",
        section: "elements",
        text: "second new item",
        // References by TEXT: one existing item, one from earlier in this batch.
        requires: ["an existing item", "first new item"],
      },
    ],
    model,
    { defaultActor: "gap-filler", allowedTools: GATES.gapFiller.allowedTools },
  );
  assert.equal(valid.length, 2);
  // The unresolvable edge is dropped with a reason; the item survives.
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /unresolvable requires reference/);

  const first = valid[0];
  const second = valid[1];
  if (first.type !== "proposeItem" || second.type !== "proposeItem") {
    assert.fail("expected proposeItem actions");
  }
  assert.deepEqual(first.item.requires, [itemId]);
  const elementsId = model.sections.find((s) => s.kind === "elements")!.id;
  // "first new item" resolves to its PREDICTED id (item-<sectionId>-0).
  assert.deepEqual(second.item.requires, [itemId, `item-${elementsId}-0`]);

  // And the prediction holds through the reducer: applying both in order
  // yields real ids matching the predicted edges.
  let m = model;
  m = reduce(m, first).model;
  m = reduce(m, second).model;
  const elements = m.sections.find((s) => s.kind === "elements")!;
  assert.equal(elements.items[0].id, `item-${elementsId}-0`);
  assert.deepEqual(elements.items[1].requires, [itemId, `item-${elementsId}-0`]);
});

// ── Interpreter (human) vocabulary ───────────────────────────────────────────

test("interpreter path: dropItem with a real id normalizes, stamps actor:human, and applies", () => {
  const { model, itemId } = modelWithItem();
  const { valid, rejected } = normalizeWorkerActions(
    [
      // canonical
      { type: "dropItem", actor: "human", itemId },
      // drifted shape: "tool" key, "item" field, wrong actor — salvaged
      { tool: "dropItem", actor: "integrator", item: itemId },
      // invented id — rejected with a reason
      { type: "dropItem", itemId: "item-ghost-1" },
    ],
    model,
    { defaultActor: "human", allowedTools: GATES.interpreter.allowedTools },
  );
  assert.equal(valid.length, 2);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /unknown item/);
  for (const a of valid) {
    assert.equal(a.type, "dropItem");
    assert.equal((a as { actor: string }).actor, "human");
  }
  const { delta } = reduce(model, valid[0]);
  assert.equal(delta.kind, "applied");
});

test("interpreter path: freeze and worker-only tools are rejected by the gate", () => {
  const { model, itemId } = modelWithItem();
  const { valid, rejected } = normalizeWorkerActions(
    [
      { type: "freeze" },
      { type: "proposeItem", sectionId: "sec-1", text: "worker move" },
      { type: "setEval", itemId, facet: "risk", value: 2 },
    ],
    model,
    { defaultActor: "human", allowedTools: GATES.interpreter.allowedTools },
  );
  assert.equal(valid.length, 1);
  assert.equal(valid[0].type, "setEval");
  assert.equal(rejected.length, 2);
});

test("interpreter path: setEval validates facet and value; addItem resolves section by kind name", () => {
  const { model, itemId } = modelWithItem();
  const { valid, rejected } = normalizeWorkerActions(
    [
      { type: "setEval", itemId, facet: "urgency", value: 2 },
      { type: "setEval", itemId, facet: "risk", value: 7 },
      { type: "addItem", section: "Elements", text: "a human item" },
    ],
    model,
    { defaultActor: "human", allowedTools: GATES.interpreter.allowedTools },
  );
  assert.equal(rejected.length, 2);
  assert.equal(valid.length, 1);
  const a = valid[0];
  assert.equal(a.type, "addItem");
  if (a.type !== "addItem") return;
  assert.equal(a.actor, "human");
  assert.equal(a.sectionId, model.sections.find((s) => s.kind === "elements")!.id);
});

test("the interpreter guide shows the human shapes with live ids", () => {
  const { model, itemId } = modelWithItem();
  const guide = renderActionGuide(
    model,
    GATES.interpreter.allowedTools,
    "human",
  );
  assert.ok(guide.includes('"type":"dropItem"'));
  assert.ok(guide.includes('"actor":"human"'));
  assert.ok(guide.includes(`"${itemId}"`));
  assert.ok(!guide.includes("proposeItem"));
});

test("guide + normalizer agree: items list appears iff an item-taking tool is allowed", () => {
  const { model } = modelWithItem();
  const researchGuide = renderActionGuide(
    model,
    GATES.research.allowedTools,
    "research",
  );
  assert.ok(researchGuide.includes("Live items"));
  assert.ok(researchGuide.includes("an existing item"));
});

// ── Duplicate wall: tombstones + paraphrases (field defect 2026-07-17:
//    "It has replaced a gap by another gap rephrasing") ───────────────────────

function modelWithGap(
  text: string,
  finalState?: "dropped" | "resolved",
): { model: WorkingModel; itemId: string; gapSectionId: string } {
  let model = emptyModel("tep");
  const gap = model.sections.find((s) => s.kind === "gap");
  assert.ok(gap);
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: gap.id,
    item: { text, modality: "optional", evals: {} },
  }).model;
  const itemId = model.sections.find((s) => s.kind === "gap")!.items[0].id;
  if (finalState === "dropped") {
    model = reduce(model, { type: "dropItem", actor: "human", itemId }).model;
  } else if (finalState === "resolved") {
    model = reduce(model, { type: "resolveItem", actor: "human", itemId }).model;
  }
  return { model, itemId, gapSectionId: gap.id };
}

test("wall rejects re-proposing a DROPPED item's exact text (human veto is permanent)", () => {
  const { model, gapSectionId } = modelWithGap(
    "Which storage backend should the digest use?",
    "dropped",
  );
  const { valid, rejected } = normalizeWorkerActions(
    [
      {
        type: "proposeItem",
        actor: "gap-filler",
        sectionId: gapSectionId,
        item: { text: "Which storage backend should the digest use?" },
      },
    ],
    model,
    { defaultActor: "gap-filler", allowedTools: GATES.gapFiller.allowedTools },
  );
  assert.equal(valid.length, 0);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reason.includes("DROPPED"));
});

test("wall rejects a PARAPHRASE of a resolved item (token overlap, not exact match)", () => {
  const { model, gapSectionId } = modelWithGap(
    "Which storage backend should the context digest use for persistence?",
    "resolved",
  );
  const { valid, rejected } = normalizeWorkerActions(
    [
      {
        type: "proposeItem",
        actor: "gap-filler",
        sectionId: gapSectionId,
        item: {
          // Rephrased: shares most content words, different wording.
          text: "Which storage backend should the context digest rely on for persistence?",
        },
      },
    ],
    model,
    { defaultActor: "gap-filler", allowedTools: GATES.gapFiller.allowedTools },
  );
  assert.equal(valid.length, 0);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reason.includes("ANSWERED"));
});

test("wall lets a genuinely different item through", () => {
  const { model, gapSectionId } = modelWithGap(
    "Which storage backend should the digest use?",
    "resolved",
  );
  const { valid, rejected } = normalizeWorkerActions(
    [
      {
        type: "proposeItem",
        actor: "gap-filler",
        sectionId: gapSectionId,
        item: { text: "How is the freeze signing key rotated in production?" },
      },
    ],
    model,
    { defaultActor: "gap-filler", allowedTools: GATES.gapFiller.allowedTools },
  );
  assert.equal(rejected.length, 0);
  assert.equal(valid.length, 1);
});

test("wall catches a paraphrase WITHIN the same batch (predicted items count too)", () => {
  const model = emptyModel("tep");
  const gap = model.sections.find((s) => s.kind === "gap")!;
  const { valid, rejected } = normalizeWorkerActions(
    [
      {
        type: "proposeItem",
        actor: "gap-filler",
        sectionId: gap.id,
        item: { text: "How should the panic button confirm destructive resets with the human?" },
      },
      {
        type: "proposeItem",
        actor: "gap-filler",
        sectionId: gap.id,
        item: { text: "How should the panic button confirm destructive resets with the user?" },
      },
    ],
    model,
    { defaultActor: "gap-filler", allowedTools: GATES.gapFiller.allowedTools },
  );
  assert.equal(valid.length, 1);
  assert.equal(rejected.length, 1);
});

test("gap-filler prompt tombstones dropped/resolved items and forbids any-wording re-proposal", () => {
  const { model } = modelWithGap("Which storage backend should the digest use?", "dropped");
  const run = require("./worker").gapFiller({
    loadQuery: () => async function* () {},
    model: "m",
  });
  const prompt: string = run.buildPrompt(model, []);
  assert.ok(prompt.includes("VETOED by the human"));
  assert.ok(prompt.includes("IN ANY WORDING"));
});

test("expansion doctrine covers the WHOLE journal, goal included, elements first (2026-07-18)", () => {
  let model = emptyModel("tep");
  model = reduce(model, { type: "seedGoal", text: "extend the graph" }).model;
  model = reduce(model, {
    type: "addRoughRequest",
    text: "harden the verification layer",
  }).model;
  model = reduce(model, {
    type: "addRoughRequest",
    text: "resolve the open questions",
  }).model;
  const run = require("./worker").gapFiller({
    loadQuery: () => async function* () {},
    model: "m",
  });
  const prompt: string = run.buildPrompt(model, []);
  // The goal is journal entry 1; every entry is numbered and in scope.
  assert.ok(prompt.includes("1. extend the graph"));
  assert.ok(prompt.includes("2. harden the verification layer"));
  assert.ok(prompt.includes("3. resolve the open questions"));
  assert.ok(prompt.includes("absorb the WHOLE journal"));
  assert.ok(prompt.includes("ELEMENTS FIRST"));
  assert.ok(!prompt.includes("NEWEST entry only"));
  assert.ok(prompt.includes("ONLY when every journal entry is already covered"));
});
