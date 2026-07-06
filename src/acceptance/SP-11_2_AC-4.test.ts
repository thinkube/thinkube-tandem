/**
 * SP-11/2 AC4 — Instant pending.
 *
 * "The shared button-model reducer marks the clicked action pending synchronously in the
 *  returned model and suppresses dispatch for every subsequent click (same or other action)
 *  until a status event reconciles the model; render/dispatch decisions come solely from the
 *  model."
 *
 * The webview renders and dispatches SOLELY from this one pure reducer (the model seam is the
 * verifiable surface for the button half — the webview package imports this module rather than
 * defining its own). Its whole job is to make double-dispatch impossible and reflect that
 * instantly:
 *   - `buttonModel(exits)` → `{ exits, pending: null }` — a fresh model, nothing pending.
 *   - `click(model, actionId)`:
 *       • `model.pending === null` → `{ model: { ...model, pending: actionId }, dispatch: true }`
 *         (the FIRST click on an action dispatches and is instantly marked pending);
 *       • `model.pending !== null` → `{ model, dispatch: false }` returning the SAME model
 *         reference, for ANY actionId (every subsequent click — same OR different action — is
 *         refused, never double-dispatched).
 *   - `reconcile(model, exits)` → a fresh `{ exits, pending: null }` — a status event carrying the
 *     current exit set re-enables all actions, whose next click dispatches again.
 *
 * Proven purely against the SP-11/2 SPEC CONTRACT: only the public reducer (typed by `ExitAction`
 * from `orchestratorCore`) is exercised; no internal implementation is assumed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buttonModel,
  click,
  reconcile,
  type ButtonModel,
} from "../views/kanban/host/buttonModel";
import { type ExitAction } from "../services/orchestratorCore";

// The two canonical exit sets the contract pins — used as the reducer's inputs. The reducer
// carries them opaquely (it only ever reads/sets `pending`), so any well-formed exit list works;
// we use the real delivered/stalled sets so the fixtures mirror what `deliveryExitState` yields.
const DELIVERED_EXITS: ExitAction[] = [
  { id: "accept", label: "Accept & merge" },
  { id: "request-changes", label: "Request changes" },
];
const STALLED_EXITS: ExitAction[] = [
  { id: "attend", label: "Attend" },
  { id: "rerun", label: "Re-run" },
];

test("SP-11/2 AC4 — buttonModel seeds a fresh model: the forwarded exits, nothing pending", () => {
  const model = buttonModel(DELIVERED_EXITS);
  assert.equal(model.pending, null, "a fresh model has nothing pending");
  assert.deepEqual(
    model.exits,
    DELIVERED_EXITS,
    "the model carries exactly the forwarded exit set",
  );
});

test("SP-11/2 AC4 — the FIRST click dispatches and is instantly marked pending", () => {
  const fresh = buttonModel(DELIVERED_EXITS);

  const { model, dispatch } = click(fresh, "accept");

  // Dispatch is permitted for the first click…
  assert.equal(dispatch, true, "the first click on a fresh model dispatches");
  // …and the returned model records the clicked action as pending, synchronously.
  assert.equal(model.pending, "accept", "the clicked action is marked pending");
  // The exit set is carried through unchanged — only `pending` moved.
  assert.deepEqual(model.exits, DELIVERED_EXITS, "the exit set is preserved");

  // The reducer is pure: the input model is not mutated (still nothing pending), and the
  // returned model is a fresh object — render/dispatch keys off the returned model alone.
  assert.equal(fresh.pending, null, "the input model is not mutated");
  assert.notEqual(
    model,
    fresh,
    "a fresh model object is returned, not the input",
  );
});

test("SP-11/2 AC4 — a SECOND click on the SAME action is refused and returns the same model", () => {
  const first = click(buttonModel(DELIVERED_EXITS), "accept").model;

  const { model, dispatch } = click(first, "accept");

  assert.equal(
    dispatch,
    false,
    "a second click on a pending model never dispatches",
  );
  assert.equal(
    model,
    first,
    "the SAME model reference is returned when a dispatch is in flight",
  );
  assert.equal(model.pending, "accept", "the pending action is unchanged");
});

test("SP-11/2 AC4 — a click on a DIFFERENT action, while one is pending, is also refused (same model)", () => {
  const first = click(buttonModel(DELIVERED_EXITS), "accept").model;

  // Any OTHER action id is suppressed just the same — the guard is on `pending`, not on which
  // button was clicked.
  const { model, dispatch } = click(first, "request-changes");

  assert.equal(
    dispatch,
    false,
    "any further click is refused while a dispatch is pending",
  );
  assert.equal(
    model,
    first,
    "the SAME model reference is returned for a different action too",
  );
  assert.equal(
    model.pending,
    "accept",
    "the originally-pending action is not overwritten by the refused click",
  );
});

test("SP-11/2 AC4 — every subsequent click stays refused until reconciliation (no drift to dispatch)", () => {
  let m: ButtonModel = buttonModel(STALLED_EXITS);
  const first = click(m, "attend");
  assert.equal(first.dispatch, true);
  m = first.model;

  // A whole burst of clicks — same action, other action, an unknown action — every one refused,
  // every one returning the identical model reference.
  for (const actionId of ["attend", "rerun", "attend", "something-else"]) {
    const r = click(m, actionId);
    assert.equal(
      r.dispatch,
      false,
      `click "${actionId}" while pending must not dispatch`,
    );
    assert.equal(
      r.model,
      m,
      `click "${actionId}" returns the same model reference`,
    );
  }
});

test("SP-11/2 AC4 — reconcile returns a fresh model with pending null whose next click dispatches again", () => {
  // A model with a dispatch in flight (pending set)…
  const pending = click(buttonModel(DELIVERED_EXITS), "accept").model;
  assert.equal(pending.pending, "accept");

  // …a status event carries the current exit set and reconciles it.
  const reconciled = reconcile(pending, STALLED_EXITS);

  // Fresh model: pending cleared and the NEW exit set adopted.
  assert.equal(
    reconciled.pending,
    null,
    "reconcile clears pending — all actions re-enabled",
  );
  assert.deepEqual(
    reconciled.exits,
    STALLED_EXITS,
    "reconcile adopts the exit set the status event carried",
  );
  // Purity: the prior model is untouched.
  assert.equal(
    pending.pending,
    "accept",
    "reconcile does not mutate the prior model",
  );
  assert.notEqual(
    reconciled,
    pending,
    "reconcile returns a fresh model object",
  );

  // The next click dispatches again — the reconciled model is as good as fresh.
  const { model, dispatch } = click(reconciled, "attend");
  assert.equal(
    dispatch,
    true,
    "after reconcile the next click dispatches again",
  );
  assert.equal(
    model.pending,
    "attend",
    "and the newly-clicked action is marked pending",
  );
});

test("SP-11/2 AC4 — reconcile equivalence: a reconciled model matches a freshly-built one", () => {
  const pending = click(buttonModel(DELIVERED_EXITS), "accept").model;
  // Whatever the model's prior pending/exits were, reconcile yields the same shape `buttonModel`
  // would for those exits — one source of truth for "fresh".
  assert.deepEqual(
    reconcile(pending, STALLED_EXITS),
    buttonModel(STALLED_EXITS),
  );
});
