/**
 * Gap-close round (self-drive 2026-07-18): the researchable/decision split
 * and the parse/validate seam.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "../model";
import type { WorkingModel } from "../model";
import {
  buildGapClosePrompt,
  openGaps,
  parseGapCloseActions,
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

test("openGaps returns active gaps without a decision proposal", () => {
  const { model, ids } = withGaps("where are logs captured", "which library");
  assert.deepEqual(
    openGaps(model).map((g) => g.id),
    ids,
  );
});

test("prompt lists the open gaps and both action shapes", () => {
  const { model, ids } = withGaps("where are logs captured");
  const p = buildGapClosePrompt(model, ["/repo"], undefined);
  assert.ok(p.includes(ids[0]));
  assert.ok(p.includes('"type":"closeGap"'));
  assert.ok(p.includes('"type":"proposeDecision"'));
  assert.ok(p.includes("NEVER guess"));
});

test("parse validates ids, builds closeGap (researchable) and proposeDecision (decision)", () => {
  const { ids } = withGaps("where are logs captured", "which UX mode");
  const gapMap = new Map(ids.map((id) => [id, "x"]));
  const raw = `noise {"actions":[
    {"type":"closeGap","itemId":"${ids[0]}","evidence":{"source":"src/log.ts","method":"read","summary":"logs captured in Logger.ts"}},
    {"type":"proposeDecision","itemId":"${ids[1]}","recommendation":"side panel","reasoning":"matches the graph layout; modal steals focus"},
    {"type":"closeGap","itemId":"item-fake","evidence":{"source":"x"}}
  ]} trailing`;
  const actions = parseGapCloseActions(raw, gapMap, "2026-07-18T00:00:00Z");
  assert.equal(actions.length, 2);
  const close = actions.find((a) => a.type === "closeGap");
  assert.ok(close && close.type === "closeGap");
  if (close.type === "closeGap") {
    assert.equal(close.itemId, ids[0]);
    assert.ok(close.evidence.method.includes("logs captured in Logger.ts"));
  }
  const dec = actions.find((a) => a.type === "proposeDecision");
  assert.ok(dec && dec.type === "proposeDecision");
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
