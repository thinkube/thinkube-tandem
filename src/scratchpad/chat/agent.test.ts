/**
 * Tests for the Thinky agent's pure core (2026-07-17): grounding snapshot,
 * doctrine prompt, and tool executors against a fake session. The SDK glue
 * is a guarded production thunk (not tested here).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "../model";
import type { WorkingModel } from "../model";
import type { ScratchpadInboundMessage } from "../session";
import {
  buildThinkySystemPrompt,
  renderSpaceSnapshot,
  THINKY_TOOLS,
  type ThinkyAgentSessionLike,
} from "./agent";

function seeded(): { model: WorkingModel; elementId: string } {
  let model = emptyModel("tep");
  const elements = model.sections.find((s) => s.kind === "elements")!;
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: elements.id,
    item: { text: "the auth element", modality: "optional", evals: {} },
  }).model;
  const elementId = model.sections.find((s) => s.kind === "elements")!
    .items[0].id;
  model = reduce(model, {
    type: "checkItem",
    actor: "human",
    itemId: elementId,
  }).model;
  return { model, elementId };
}

function fakeSession(model: WorkingModel, outcome?: string) {
  const posted: ScratchpadInboundMessage[] = [];
  const dispatched: unknown[] = [];
  const session: ThinkyAgentSessionLike & {
    posted: ScratchpadInboundMessage[];
    dispatched: unknown[];
  } = {
    model,
    posted,
    dispatched,
    lastCommandMessage: outcome,
    selectionCount: 0,
    async postFromWebview(message: ScratchpadInboundMessage) {
      posted.push(message);
    },
    dispatch(action: unknown) {
      dispatched.push(action);
      const result = reduce(
        session.model,
        action as Parameters<typeof reduce>[1],
      );
      (session as { model: WorkingModel }).model = result.model;
      return result.delta;
    },
  };
  return session;
}

test("snapshot carries ids, settled marks, journal numbering, and staged count", () => {
  const { model, elementId } = seeded();
  const session = fakeSession(model);
  (session as { selectionCount: number }).selectionCount = 3;
  const snap = renderSpaceSnapshot(session);
  assert.ok(snap.includes(elementId));
  assert.ok(snap.includes("✓settled"));
  assert.ok(snap.includes("1. "));
  assert.ok(snap.includes("Staged for human action: 3"));
});

test("system prompt states human sovereignty and id discipline", () => {
  const prompt = buildThinkySystemPrompt();
  assert.ok(prompt.includes("HUMAN SOVEREIGNTY"));
  assert.ok(prompt.includes("cannot settle"));
  assert.ok(prompt.includes("Never invent item ids"));
});

test("cut_elements clears then toggles only valid ids, reports unknowns", async () => {
  const { model, elementId } = seeded();
  const session = fakeSession(model, "Cut: 1 element, 4 context items pulled.");
  const out = await THINKY_TOOLS.cut_elements.run(
    session,
    { itemIds: [elementId, "item-fake-99"] },
    { utterance: "" },
  );
  assert.deepEqual(session.posted[0], { type: "clearCut" });
  assert.deepEqual(session.posted[1], { type: "toggleCut", itemId: elementId });
  assert.equal(session.posted.length, 2);
  assert.ok(out.includes("Cut: 1 element"));
});

test("stage_items refuses when no valid ids and never posts", async () => {
  const { model } = seeded();
  const session = fakeSession(model);
  const out = await THINKY_TOOLS.stage_items.run(
    session,
    { itemIds: ["nope"] },
    { utterance: "" },
  );
  assert.equal(session.posted.length, 0);
  assert.ok(out.includes("Nothing staged"));
  assert.ok(out.includes("nope"));
});

test("stage_items stages valid ids through the selection channel", async () => {
  const { model, elementId } = seeded();
  const session = fakeSession(model);
  const out = await THINKY_TOOLS.stage_items.run(
    session,
    { itemIds: [elementId] },
    { utterance: "" },
  );
  assert.deepEqual(session.posted[0], { type: "clearSelection" });
  assert.deepEqual(session.posted[1], {
    type: "toggleSelect",
    itemId: elementId,
  });
  assert.ok(out.includes("Staged 1 item"));
  assert.ok(out.includes("human"));
});

test("assumption_verbatim records the UTTERANCE verbatim, ignoring any model text", async () => {
  const { model } = seeded();
  const session = fakeSession(model);
  const out = await THINKY_TOOLS.assumption_verbatim.run(
    session,
    { text: "a paraphrase the model tried to sneak in" },
    { utterance: "single-user platform" },
  );
  assert.ok(out.includes("assumption #1"));
  assert.equal(session.model.assumptions?.[0].text, "single-user platform");
  const refused = await THINKY_TOOLS.assumption_verbatim.run(
    session,
    {},
    { utterance: "   " },
  );
  assert.ok(refused.includes("Nothing recorded"));
});

test("journal_verbatim posts the raw utterance through the seam, never model text", async () => {
  const { model } = seeded();
  const session = fakeSession(model);
  await THINKY_TOOLS.journal_verbatim.run(
    session,
    { text: "model words" },
    { utterance: "surface per-step log output in a node-anchored log panel" },
  );
  assert.deepEqual(session.posted[0], {
    type: "addRoughRequest",
    text: "surface per-step log output in a node-anchored log panel",
  });
});

test("expand_space triggers the decomposition round through the seam", async () => {
  const { model } = seeded();
  const session = fakeSession(model);
  await THINKY_TOOLS.expand_space.run(session, {}, { utterance: "go ahead" });
  assert.deepEqual(session.posted[0], { type: "prefill" });
});

test("the system prompt carries the guided-flow protocol", () => {
  const prompt = buildThinkySystemPrompt();
  assert.ok(prompt.includes("GUIDED FLOW"));
  assert.ok(prompt.includes("journal_verbatim"));
  assert.ok(prompt.includes("Never call it uninvited"));
});

test("the belt contains NO settling, destructive, freeze, or panic tools", () => {
  const names = Object.keys(THINKY_TOOLS);
  for (const forbidden of ["check", "drop", "defer", "freeze", "panic", "settle"]) {
    assert.ok(
      !names.some((n) => n === forbidden || n.startsWith(`${forbidden}_item`)),
      `belt must not contain ${forbidden}`,
    );
  }
  // check_readiness is the ONLY "check" — it judges, it does not settle.
  assert.ok(names.includes("check_readiness"));
});

test("readiness/reframe/research tools speak the exact seam messages", async () => {
  const { model } = seeded();
  const session = fakeSession(model, "outcome text");
  await THINKY_TOOLS.check_readiness.run(session, {}, { utterance: "" });
  await THINKY_TOOLS.reframe.run(session, {}, { utterance: "" });
  await THINKY_TOOLS.research.run(
    session,
    { subject: "digest storage" },
    { utterance: "" },
  );
  assert.deepEqual(
    session.posted.map((m) => m.type),
    ["checkReadiness", "reframe", "research"],
  );
  const research = session.posted[2] as { subject?: string };
  assert.equal(research.subject, "digest storage");
});
