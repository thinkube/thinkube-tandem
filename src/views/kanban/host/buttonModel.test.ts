/**
 * Unit coverage for the pure button-model reducer (SP-11/2, SL-2).
 *
 * The reducer is the verifiable seam for the button half of the delivery-exit surface:
 * a click gives instant pending feedback and is idempotent (a second click dispatches
 * nothing), and a status event reconciles the model back to a fresh, re-enabled set.
 * node:test + node:assert; no VS Code, no DOM.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buttonModel, click, reconcile, type ButtonModel } from "./buttonModel";
import type { ExitAction } from "../../../services/orchestratorCore";

const DELIVERED: ExitAction[] = [
  { id: "accept", label: "Accept & merge" },
  { id: "request-changes", label: "Request changes" },
];
const STALLED: ExitAction[] = [
  { id: "attend", label: "Attend" },
  { id: "rerun", label: "Re-run" },
];

test("buttonModel builds a fresh model with pending null", () => {
  const m = buttonModel(DELIVERED);
  assert.deepEqual(m, { exits: DELIVERED, pending: null });
  assert.equal(m.pending, null);
  assert.equal(m.exits, DELIVERED);
});

test("click on a fresh model marks the action pending and dispatches", () => {
  const m = buttonModel(DELIVERED);
  const { model, dispatch } = click(m, "accept");
  assert.equal(dispatch, true);
  assert.equal(model.pending, "accept");
  assert.deepEqual(model.exits, DELIVERED);
});

test("click does not mutate the input model", () => {
  const m = buttonModel(DELIVERED);
  click(m, "accept");
  assert.equal(m.pending, null);
});

test("click while pending is refused: same model reference, dispatch false", () => {
  const first = click(buttonModel(DELIVERED), "accept");
  assert.equal(first.dispatch, true);

  const second = click(first.model, "request-changes");
  assert.equal(second.dispatch, false);
  assert.equal(second.model, first.model, "returns the SAME model reference");
});

test("click while pending is refused for ANY action id — including the same one", () => {
  const first = click(buttonModel(STALLED), "attend");
  for (const id of ["attend", "rerun", "accept", "anything-else"]) {
    const next = click(first.model, id);
    assert.equal(next.dispatch, false, `dispatch false for ${id}`);
    assert.equal(next.model, first.model, `same reference for ${id}`);
    assert.equal(next.model.pending, "attend", `pending unchanged for ${id}`);
  }
});

test("reconcile returns a fresh model from the new exit set with pending null", () => {
  const pending: ButtonModel = { exits: DELIVERED, pending: "accept" };
  const next = reconcile(pending, STALLED);
  assert.deepEqual(next, { exits: STALLED, pending: null });
  assert.equal(next.exits, STALLED);
});

test("after reconcile, clicks dispatch again", () => {
  const stuck = click(buttonModel(DELIVERED), "accept").model;
  assert.equal(click(stuck, "accept").dispatch, false);

  const reconciled = reconcile(stuck, DELIVERED);
  const { dispatch, model } = click(reconciled, "accept");
  assert.equal(dispatch, true);
  assert.equal(model.pending, "accept");
});

test("reconcile does not mutate the input model", () => {
  const pending: ButtonModel = { exits: DELIVERED, pending: "accept" };
  reconcile(pending, STALLED);
  assert.equal(pending.pending, "accept");
  assert.equal(pending.exits, DELIVERED);
});
