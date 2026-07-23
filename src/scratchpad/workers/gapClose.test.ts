/**
 * Gap-close JUDGE round: the researchable / decidable / intent-fork split and
 * the parse/validate seam (decide → constraint + closeGap).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "../model";
import type { WorkingModel } from "../model";
import {
  buildGapClosePrompt,
  openGaps,
  parseGapCloseActions,
  type OpenGap,
} from "./gapClose";

function withGaps(...texts: string[]): { model: WorkingModel; ids: string[] } {
  let model = emptyModel("tep");
  const gapSec = model.sections.find((s) => s.kind === "gap")!.id;
  const ids: string[] = [];
  for (const t of texts) {
    model = reduce(model, {
      type: "proposeItem",
      actor: "gap-filler",
      sectionId: gapSec,
      item: { text: t, modality: "optional", evals: {} },
    }).model;
    const items = model.sections.find((s) => s.kind === "gap")!.items;
    ids.push(items[items.length - 1].id);
  }
  return { model, ids };
}

const constraintsSec = (m: WorkingModel) =>
  m.sections.find((s) => s.kind === "constraints")!.id;
const gapMapOf = (model: WorkingModel) =>
  new Map<string, OpenGap>(openGaps(model).map((g) => [g.id, g]));

test("openGaps returns active gaps (id, text, requires) without a decision proposal", () => {
  const { model, ids } = withGaps("where are logs captured", "which library");
  const gaps = openGaps(model);
  assert.deepEqual(gaps.map((g) => g.id), ids);
  assert.ok(Array.isArray(gaps[0].requires));
});

test("prompt grounds in the digest and lists all three action shapes", () => {
  const { model, ids } = withGaps("where are logs captured");
  const p = buildGapClosePrompt(model, "DIGEST: logs live in Logger.ts (src/log.ts)");
  assert.ok(p.includes(ids[0]));
  assert.ok(p.includes("CONTEXT DIGEST"));
  assert.ok(p.includes("logs live in Logger.ts"));
  assert.ok(p.includes('"type":"closeGap"'));
  assert.ok(p.includes('"type":"decide"'));
  assert.ok(p.includes('"type":"proposeDecision"'));
  assert.ok(p.includes("Prefer DECIDABLE over INTENT FORK"));
});

test("parse: closeGap (researchable), decide→constraint+closeGap, proposeDecision (fork)", () => {
  const { model, ids } = withGaps("where are logs captured", "which mechanism", "single vs multi tenant");
  const secId = constraintsSec(model);
  const raw = `noise {"actions":[
    {"type":"closeGap","itemId":"${ids[0]}","evidence":{"source":"src/log.ts","summary":"logs captured in Logger.ts"}},
    {"type":"decide","itemId":"${ids[1]}","constraint":"status updates are delivered by polling","rationale":"the digest shows no push infra exists","evidence":{"source":"src/net.ts","summary":"no websockets present"}},
    {"type":"proposeDecision","itemId":"${ids[2]}","recommendation":"single-tenant","reasoning":"matches the stated intent"},
    {"type":"closeGap","itemId":"item-fake","evidence":{"source":"x"}}
  ]} trailing`;
  const actions = parseGapCloseActions(raw, gapMapOf(model), secId, "2026-07-18T00:00:00Z");
  // researchable → 1 closeGap; decide → proposeItem + closeGap; fork → proposeDecision
  assert.equal(actions.length, 4);
  const propose = actions.find((a) => a.type === "proposeItem");
  assert.ok(propose && propose.type === "proposeItem");
  if (propose.type === "proposeItem") {
    assert.equal(propose.sectionId, secId);
    assert.equal(propose.item.text, "status updates are delivered by polling");
    assert.ok((propose.item.note ?? "").includes("Decided"));
  }
  assert.ok(actions.some((a) => a.type === "proposeDecision"));
  assert.equal(actions.filter((a) => a.type === "closeGap").length, 2);
});

test("decide inherits the gap's element edges so the new constraint is not orphaned", () => {
  // seed an element and a gap that requires it
  let model = emptyModel("tep");
  const elSec = model.sections.find((s) => s.kind === "elements")!.id;
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: elSec,
    item: { text: "the graph view", modality: "mandatory", evals: {} },
  }).model;
  const elId = model.sections.find((s) => s.kind === "elements")!.items[0].id;
  const gapSec = model.sections.find((s) => s.kind === "gap")!.id;
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: gapSec,
    item: { text: "which render library", modality: "optional", evals: {}, requires: [elId], servesEntries: [2] },
  }).model;
  const gapId = model.sections.find((s) => s.kind === "gap")!.items[0].id;

  const raw = `{"actions":[{"type":"decide","itemId":"${gapId}","constraint":"the graph renders via the native canvas","rationale":"already available","evidence":{"source":"pkg.json"}}]}`;
  const actions = parseGapCloseActions(raw, gapMapOf(model), constraintsSec(model), "t");
  const propose = actions.find((a) => a.type === "proposeItem");
  if (propose && propose.type === "proposeItem") {
    // The decided constraint inherits the gap's ask (never orphaned).
    assert.deepEqual(propose.item.servesEntries, [2]);
  }
  assert.ok(propose && propose.type === "proposeItem");
  if (propose.type === "proposeItem") {
    assert.deepEqual(propose.item.requires, [elId]);
  }
});

test("closeGap resolves a gap + attaches evidence; proposeDecision flags it", () => {
  const { model, ids } = withGaps("researchable", "a decision");
  const closed = reduce(model, {
    type: "closeGap",
    actor: "research",
    itemId: ids[0],
    evidence: { source: "src/x.ts", method: "read — found it", checkedAt: "t" },
  });
  assert.equal(closed.delta.kind, "applied");
  const g0 = closed.model.sections.find((s) => s.kind === "gap")!.items.find((it) => it.id === ids[0]);
  assert.equal(g0!.state, "resolved");
  assert.equal(g0!.evidence.length, 1);

  const proposed = reduce(closed.model, {
    type: "proposeDecision",
    actor: "research",
    itemId: ids[1],
    recommendation: "use X",
    reasoning: "because Y",
  });
  assert.equal(proposed.delta.kind, "applied");
  const g1 = proposed.model.sections.find((s) => s.kind === "gap")!.items.find((it) => it.id === ids[1]);
  assert.equal(g1!.decisionProposal?.recommendation, "use X");
  assert.equal(g1!.state, "active"); // stays open until the human ratifies
});

// ── Rejecting a decision re-opens its question (2026-07-23) ─────────────────

test("a decided constraint records the gap it settled", () => {
  let model = emptyModel("tep");
  const gapSec = model.sections.find((s) => s.kind === "gap")!.id;
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: gapSec,
    item: { text: "which render library", modality: "optional", evals: {} },
  }).model;
  const gapId = model.sections.find((s) => s.kind === "gap")!.items[0].id;
  const raw = `{"actions":[{"type":"decide","itemId":"${gapId}","constraint":"render via the native canvas","rationale":"already available","evidence":{"source":"pkg.json"}}]}`;
  const actions = parseGapCloseActions(
    raw,
    gapMapOf(model),
    constraintsSec(model),
    "t",
  );
  const propose = actions.find((a) => a.type === "proposeItem");
  assert.ok(propose && propose.type === "proposeItem");
  if (propose.type === "proposeItem") {
    assert.equal(propose.item.decidedFrom, gapId);
  }
});

test("dropping a machine-decided constraint re-opens the gap it closed", () => {
  let model = emptyModel("tep");
  const gapSec = model.sections.find((s) => s.kind === "gap")!.id;
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: gapSec,
    item: { text: "which render library", modality: "mandatory", evals: {} },
  }).model;
  const gapId = model.sections.find((s) => s.kind === "gap")!.items[0].id;
  const conSec = model.sections.find((s) => s.kind === "constraints")!.id;
  model = reduce(model, {
    type: "proposeItem",
    actor: "research",
    sectionId: conSec,
    item: {
      text: "render with the built-in graph view",
      modality: "mandatory",
      evals: {},
      decidedFrom: gapId,
    },
  }).model;
  const conId = model.sections.find((s) => s.kind === "constraints")!.items[0].id;
  model = reduce(model, {
    type: "closeGap",
    actor: "research",
    itemId: gapId,
    evidence: {
      source: "self-decided",
      method: "decided",
      checkedAt: "2026-07-23T00:00:00.000Z",
    },
  }).model;
  assert.equal(
    model.sections.find((s) => s.kind === "gap")!.items[0].state,
    "resolved",
  );

  const { model: after } = reduce(model, {
    type: "dropItem",
    actor: "human",
    itemId: conId,
  });
  const gap = after.sections.find((s) => s.kind === "gap")!.items[0];
  assert.equal(gap.state, "active", "the question is open again");
  assert.match(gap.notes[gap.notes.length - 1].text, /Re-opened/);
  assert.match(gap.notes[gap.notes.length - 1].text, /built-in graph view/);
});

test("dropping an ordinary constraint touches no gap", () => {
  let model = emptyModel("tep");
  const gapSec = model.sections.find((s) => s.kind === "gap")!.id;
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: gapSec,
    item: { text: "an unrelated unknown", modality: "mandatory", evals: {} },
  }).model;
  const conSec = model.sections.find((s) => s.kind === "constraints")!.id;
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: conSec,
    item: { text: "a hand-written constraint", modality: "mandatory", evals: {} },
  }).model;
  const conId = model.sections.find((s) => s.kind === "constraints")!.items[0].id;
  const { model: after } = reduce(model, {
    type: "dropItem",
    actor: "human",
    itemId: conId,
  });
  assert.equal(
    after.sections.find((s) => s.kind === "gap")!.items[0].state,
    "active",
    "an unrelated gap is untouched",
  );
  assert.equal(after.sections.find((s) => s.kind === "gap")!.items[0].notes.length, 0);
});

test("a gap the HUMAN resolved is not re-opened by an unrelated drop", () => {
  let model = emptyModel("tep");
  const gapSec = model.sections.find((s) => s.kind === "gap")!.id;
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: gapSec,
    item: { text: "answered by the human", modality: "mandatory", evals: {} },
  }).model;
  const gapId = model.sections.find((s) => s.kind === "gap")!.items[0].id;
  model = reduce(model, { type: "resolveItem", actor: "human", itemId: gapId }).model;
  const conSec = model.sections.find((s) => s.kind === "constraints")!.id;
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: conSec,
    item: { text: "some constraint", modality: "mandatory", evals: {} },
  }).model;
  const conId = model.sections.find((s) => s.kind === "constraints")!.items[0].id;
  const { model: after } = reduce(model, {
    type: "dropItem",
    actor: "human",
    itemId: conId,
  });
  assert.equal(
    after.sections.find((s) => s.kind === "gap")!.items[0].state,
    "resolved",
    "a human-settled question stays settled",
  );
});
