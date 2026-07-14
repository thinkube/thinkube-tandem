// SP-21/1 AC-2 — When the person changes or corrects a section, the change is recorded as an
// explicit before/after delta on the working model — the adjustment is never silently absorbed.
//
// WHY (INVARIANT): The delta record is both the visibility mechanism (what the surface shows as
// a correction) and the event stream that gives persistence a clean audit trail. Every reducer
// mutation must produce a Delta with the prior value in 'before' and the next value in 'after'.
// This must hold for the life of the code: a refactor that drops, nullifies, or collapses the
// delta silently defeats both the "no silent absorption" guarantee and the persistence contract.

import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, goalSection, reduce } from "../scratchpad/model";
import type { Action } from "../scratchpad/model";

// ── editSection produces a visible before/after delta ────────────────────────

test("reduce(editSection) returns delta.before=old text and delta.after=new text — the edit is never silently absorbed", () => {
  let model = emptyModel("tep");
  // Seed the goal so it has initial text to be "corrected".
  ({ model } = reduce(model, {
    type: "seedGoal",
    text: "First draft of the intent: a human-paced authoring surface",
  }));

  const goal = goalSection(model);
  const { delta } = reduce(model, {
    type: "editSection",
    id: goal.id,
    text: "Revised intent: a human-paced authoring surface with a signed freeze",
  });

  assert.equal(
    delta.before,
    "First draft of the intent: a human-paced authoring surface",
    "delta.before must be the section's prior text exactly as it was before the edit",
  );
  assert.equal(
    delta.after,
    "Revised intent: a human-paced authoring surface with a signed freeze",
    "delta.after must be the new text supplied to editSection",
  );
  assert.notEqual(
    delta.before,
    delta.after,
    "before and after must differ — this edit was not a no-op, nothing was silently absorbed",
  );
});

test("reduce(editSection) delta.action is the editSection action that caused the change", () => {
  let model = emptyModel("tep");
  ({ model } = reduce(model, { type: "seedGoal", text: "Original goal text" }));

  const goal = goalSection(model);
  const editAction: Action = {
    type: "editSection",
    id: goal.id,
    text: "Updated goal text",
  };
  const { delta } = reduce(model, editAction);

  assert.equal(
    delta.action.type,
    "editSection",
    "delta.action.type must be 'editSection'",
  );
  assert.deepEqual(
    delta.action,
    editAction,
    "delta.action must be the exact action applied — the delta is a full record of what happened",
  );
});

test("reduce(editSection) delta.field is a non-empty string path that locates the mutated field", () => {
  let model = emptyModel("tep");
  ({ model } = reduce(model, { type: "seedGoal", text: "Some goal" }));

  const goal = goalSection(model);
  const { delta } = reduce(model, {
    type: "editSection",
    id: goal.id,
    text: "Updated goal",
  });

  assert.ok(
    typeof delta.field === "string" && delta.field.length > 0,
    `delta.field must be a non-empty dotted path string — got: ${JSON.stringify(delta.field)}`,
  );
});

test("reduce(editSection) updated model agrees with delta.after; original model is unchanged (reduce is pure)", () => {
  let model = emptyModel("tep");
  ({ model } = reduce(model, { type: "seedGoal", text: "Before edit" }));

  const goal = goalSection(model);
  const { model: updated, delta } = reduce(model, {
    type: "editSection",
    id: goal.id,
    text: "After edit",
  });

  // The updated model's text and the delta.after must agree — no split truth.
  const updatedGoal = goalSection(updated);
  assert.equal(
    updatedGoal.text,
    delta.after as string,
    "delta.after must equal the section's new text in the updated model — the two sources of truth must agree",
  );
  assert.equal(updatedGoal.text, "After edit");

  // reduce must be pure — the original model must be untouched.
  assert.equal(
    goalSection(model).text,
    "Before edit",
    "reduce must be pure — the original model must be unchanged after producing the updated model",
  );
});

// ── editSection on a proposed section also deltas ────────────────────────────

test("reduce(editSection) on a proposed section records the before/after delta correctly", () => {
  let model = emptyModel("tep");
  ({ model } = reduce(model, { type: "seedGoal", text: "Goal text" }));

  // Propose a constraints section so we have a section of a different kind to correct.
  ({ model } = reduce(model, {
    type: "proposeSection",
    kind: "constraints",
    text: "Initial constraints draft — must not call create_slice",
    workerId: "gap-w-1",
  }));

  const constraints = model.sections.find((s) => s.kind === "constraints");
  assert.ok(constraints, "constraints section must exist after proposeSection");

  const { model: updated, delta } = reduce(model, {
    type: "editSection",
    id: constraints!.id,
    text: "Revised constraints — must not call create_slice, and must not write slice files",
  });

  assert.equal(
    delta.before,
    "Initial constraints draft — must not call create_slice",
    "delta.before must be the proposed section's prior text",
  );
  assert.equal(
    delta.after,
    "Revised constraints — must not call create_slice, and must not write slice files",
    "delta.after must be the corrected text",
  );
  const updatedConstraints = updated.sections.find(
    (s) => s.id === constraints!.id,
  );
  assert.equal(
    updatedConstraints?.text,
    "Revised constraints — must not call create_slice, and must not write slice files",
    "the updated model must carry the new text",
  );
});

// ── successive edits each produce independent deltas ─────────────────────────

test("successive edits each produce an independent delta with the correct before/after chain", () => {
  let model = emptyModel("tep");
  ({ model } = reduce(model, { type: "seedGoal", text: "Version 1" }));

  const goal = goalSection(model);

  const { model: m2, delta: d1 } = reduce(model, {
    type: "editSection",
    id: goal.id,
    text: "Version 2",
  });
  const { model: _m3, delta: d2 } = reduce(m2, {
    type: "editSection",
    id: goal.id,
    text: "Version 3",
  });

  // First edit: 1 → 2.
  assert.equal(d1.before, "Version 1");
  assert.equal(d1.after, "Version 2");

  // Second edit: 2 → 3 — before is what the PREVIOUS edit set, not the original seed.
  assert.equal(
    d2.before,
    "Version 2",
    "the second delta's before must be the result of the first edit — not the original value",
  );
  assert.equal(d2.after, "Version 3");
});
