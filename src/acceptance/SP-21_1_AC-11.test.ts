// SP-21/1 AC-11 — After a design is closed part-way and reopened, the full working model is
// reconstituted: sections and their states, notes, worker proposals, adversarial objections,
// readiness history, and the current phase match the state before the design was closed.
//
// WHY (INVARIANT): serialize/deserialize is the resume mechanism. Any field silently dropped on
// round-trip is work the person loses mid-flight. This must hold forever: any shape change to
// WorkingModel must update both serialize and deserialize together, and this test is the
// regression guard that catches any drift between the two.

import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "../scratchpad/model";
import type { WorkingModel } from "../scratchpad/model";
import { deserialize, serialize } from "../scratchpad/persistence";

/** Asserts that deserialize(serialize(model)) deep-equals model, with a label for failures. */
function assertRoundTrips(label: string, model: WorkingModel): void {
  const roundTripped = deserialize(serialize(model));
  assert.deepEqual(
    roundTripped,
    model,
    `${label}: deserialize(serialize(model)) must deep-equal the original — every field must survive`,
  );
}

// ── basic round-trip ──────────────────────────────────────────────────────────

test("empty tep model round-trips via serialize/deserialize", () => {
  assertRoundTrips("emptyModel('tep')", emptyModel("tep"));
});

test("empty spec model round-trips via serialize/deserialize", () => {
  assertRoundTrips("emptyModel('spec')", emptyModel("spec"));
});

test("serialize produces a non-empty string; deserialize inverts it", () => {
  const model = emptyModel("tep");
  const text = serialize(model);
  assert.ok(
    typeof text === "string" && text.length > 0,
    "serialize must return a non-empty string",
  );
  assert.deepEqual(
    deserialize(text),
    model,
    "deserialize(serialize(model)) must equal the original",
  );
});

// ── phase is preserved ────────────────────────────────────────────────────────

test("phase 'shaping' (set by seedGoal) is preserved across round-trip", () => {
  let model = emptyModel("tep");
  ({ model } = reduce(model, { type: "seedGoal", text: "Intent" }));
  assert.equal(model.phase, "shaping", "seedGoal must set phase to shaping");

  const restored = deserialize(serialize(model));
  assert.equal(
    restored.phase,
    "shaping",
    "phase 'shaping' must be restored on reopen — the person must resume in the same phase",
  );
});

test("phase 'reframing' set via setPhase is preserved across round-trip", () => {
  let model = emptyModel("tep");
  ({ model } = reduce(model, { type: "setPhase", phase: "reframing" }));
  assertRoundTrips("phase:reframing", model);
  assert.equal(deserialize(serialize(model)).phase, "reframing");
});

test("phase 'ready' set via setPhase is preserved across round-trip", () => {
  let model = emptyModel("tep");
  ({ model } = reduce(model, { type: "setPhase", phase: "ready" }));
  assert.equal(deserialize(serialize(model)).phase, "ready");
});

// ── sections and states are preserved ────────────────────────────────────────

test("proposed sections (kind and text) are preserved across round-trip", () => {
  let model = emptyModel("tep");
  ({ model } = reduce(model, {
    type: "seedGoal",
    text: "Build the human-paced scratchpad",
  }));
  ({ model } = reduce(model, {
    type: "proposeSection",
    kind: "constraints",
    text: "Must not call create_slice in non-committing mode",
    workerId: "gap-1",
  }));
  ({ model } = reduce(model, {
    type: "proposeSection",
    kind: "elements",
    text: "Working model, reducer, phase workers, freeze control",
    workerId: "gap-1",
  }));

  assertRoundTrips("model with proposed sections", model);

  const restored = deserialize(serialize(model));
  const restoredConstraints = restored.sections.find(
    (s) => s.kind === "constraints",
  );
  assert.equal(restoredConstraints?.state, "proposed");
  assert.equal(
    restoredConstraints?.text,
    "Must not call create_slice in non-committing mode",
  );
});

test("setSectionState change is preserved across round-trip", () => {
  let model = emptyModel("tep");
  ({ model } = reduce(model, { type: "seedGoal", text: "Goal" }));
  ({ model } = reduce(model, {
    type: "proposeSection",
    kind: "criteria",
    text: "Notes survive a close and reopen",
    workerId: "gap-1",
  }));
  const criteriaId = model.sections.find((s) => s.kind === "criteria")!.id;
  ({ model } = reduce(model, {
    type: "setSectionState",
    id: criteriaId,
    state: "settled",
  }));

  assertRoundTrips("model with a settled section", model);
  const restoredCriteria = deserialize(serialize(model)).sections.find(
    (s) => s.kind === "criteria",
  );
  assert.equal(
    restoredCriteria?.state,
    "settled",
    "section state 'settled' must survive round-trip — the person must resume with their progress intact",
  );
});

// ── notes are preserved ────────────────────────────────────────────────────────

test("notes on a section are preserved across round-trip (text, id, and count)", () => {
  let model = emptyModel("tep");
  ({ model } = reduce(model, { type: "seedGoal", text: "Goal" }));
  const goalId = model.sections.find((s) => s.kind === "goal")!.id;

  ({ model } = reduce(model, {
    type: "addNote",
    sectionId: goalId,
    text: "Note 1 — freeze-token seam",
  }));
  ({ model } = reduce(model, {
    type: "addNote",
    sectionId: goalId,
    text: "Note 2 — dry-run mode for the slicer",
  }));

  assertRoundTrips("model with two notes on the goal section", model);

  const restored = deserialize(serialize(model));
  const restoredGoal = restored.sections.find((s) => s.kind === "goal")!;
  assert.equal(
    restoredGoal.notes.length,
    2,
    "both notes must be restored on reopen",
  );
  const texts = restoredGoal.notes.map((n) => n.text);
  assert.ok(
    texts.includes("Note 1 — freeze-token seam"),
    "Note 1 must be present",
  );
  assert.ok(
    texts.includes("Note 2 — dry-run mode for the slicer"),
    "Note 2 must be present",
  );
  // Note ids must survive (they anchor delta field paths to specific notes).
  const original = model.sections.find((s) => s.kind === "goal")!;
  assert.deepEqual(
    restoredGoal.notes.map((n) => n.id),
    original.notes.map((n) => n.id),
    "note ids must survive round-trip unchanged",
  );
});

// ── objections are preserved ──────────────────────────────────────────────────

test("adversarial objections — resolved and unresolved — are preserved across round-trip", () => {
  let model = emptyModel("tep");
  ({ model } = reduce(model, { type: "seedGoal", text: "Goal" }));
  ({ model } = reduce(model, {
    type: "addObjection",
    text: "The dry-run mode may still emit side effects if the slicer is not truly non-committing",
  }));
  ({ model } = reduce(model, {
    type: "addObjection",
    text: "Coverage metric may incorrectly flag sections as green before they constrain anything",
  }));

  // Resolve the first objection only.
  const firstObjId = model.objections[0].id;
  ({ model } = reduce(model, { type: "resolveObjection", id: firstObjId }));

  assertRoundTrips("model with mixed-resolved objections", model);

  const restored = deserialize(serialize(model));
  assert.equal(
    restored.objections.length,
    2,
    "both objections must survive round-trip",
  );
  const resolvedObj = restored.objections.find((o) => o.id === firstObjId);
  assert.equal(
    resolvedObj?.resolved,
    true,
    "the resolved objection must be restored as resolved — the person's decision must survive reopen",
  );
  const unresolvedObj = restored.objections.find((o) => o.id !== firstObjId);
  assert.equal(
    unresolvedObj?.resolved,
    false,
    "the unresolved objection must be restored as unresolved — unresolved objections must not be silently dropped on reopen",
  );
});

// ── readiness history is preserved ────────────────────────────────────────────

test("readiness history records (including gapSection) are preserved across round-trip", () => {
  let model = emptyModel("tep");
  ({ model } = reduce(model, { type: "seedGoal", text: "Goal" }));
  ({ model } = reduce(model, {
    type: "recordReadiness",
    record: { covered: false, cleanCut: false, gapSection: "constraints" },
  }));
  ({ model } = reduce(model, {
    type: "recordReadiness",
    record: { covered: true, cleanCut: true, gapSection: null },
  }));

  assertRoundTrips("model with readiness history", model);

  const restored = deserialize(serialize(model));
  assert.equal(
    restored.readinessHistory.length,
    2,
    "both readiness records must survive round-trip",
  );
  assert.deepEqual(restored.readinessHistory[0], {
    covered: false,
    cleanCut: false,
    gapSection: "constraints",
  });
  assert.deepEqual(restored.readinessHistory[1], {
    covered: true,
    cleanCut: true,
    gapSection: null,
  });
});

// ── full working model: every field survives a mid-flight close+reopen ────────

test("full mid-flight working model — sections, states, notes, proposals, objections, readiness, phase all survive round-trip", () => {
  let model = emptyModel("tep");

  // Seed and shape the goal.
  ({ model } = reduce(model, {
    type: "seedGoal",
    text: "A human-paced intent-authoring surface with a human-only signed freeze",
  }));
  const goalId = model.sections.find((s) => s.kind === "goal")!.id;

  // Add a note to the goal.
  ({ model } = reduce(model, {
    type: "addNote",
    sectionId: goalId,
    text: "Verify the approval-token seam is reachable from the new surface before slicing",
  }));

  // Propose several sections covering all relevant kinds.
  ({ model } = reduce(model, {
    type: "proposeSection",
    kind: "constraints",
    text: "No local inference; must use the configured Claude model. Sonnet by default.",
    workerId: "gap-worker-1",
  }));
  ({ model } = reduce(model, {
    type: "proposeSection",
    kind: "elements",
    text: "Working model, reducer, phase workers (gap-filler, integrator, reframe, adversarial), freeze control",
    workerId: "gap-worker-1",
  }));
  ({ model } = reduce(model, {
    type: "proposeSection",
    kind: "gap",
    text: "The non-committing dry-run mode for the slicer; the approval-token seam",
    workerId: "gap-worker-1",
  }));
  ({ model } = reduce(model, {
    type: "proposeSection",
    kind: "criteria",
    text: "Freeze is enabled only when coverage is green and the dry run cuts clean",
    workerId: "gap-worker-1",
  }));
  ({ model } = reduce(model, {
    type: "proposeSection",
    kind: "verification",
    text: "Acceptance probe: serialize/deserialize round-trip of a mid-flight model",
    workerId: "gap-worker-1",
  }));

  // Add a note to constraints.
  const constraintsId = model.sections.find(
    (s) => s.kind === "constraints",
  )!.id;
  ({ model } = reduce(model, {
    type: "addNote",
    sectionId: constraintsId,
    text: "Verify no local-LLM path exists anywhere in the workers",
  }));

  // Settle constraints after review.
  ({ model } = reduce(model, {
    type: "setSectionState",
    id: constraintsId,
    state: "settled",
  }));

  // Add adversarial objections.
  ({ model } = reduce(model, {
    type: "addObjection",
    text: "The dry-run mode may still emit side effects if the slicer is not truly non-committing",
  }));
  ({ model } = reduce(model, {
    type: "addObjection",
    text: "Coverage metric may incorrectly flag sections as green before they are truly constrained",
  }));

  // Resolve the first objection only — the second stays unresolved.
  const firstObjId = model.objections[0].id;
  ({ model } = reduce(model, { type: "resolveObjection", id: firstObjId }));

  // Record two readiness checks.
  ({ model } = reduce(model, {
    type: "recordReadiness",
    record: { covered: false, cleanCut: false, gapSection: "gap" },
  }));
  ({ model } = reduce(model, {
    type: "recordReadiness",
    record: { covered: true, cleanCut: true, gapSection: null },
  }));

  // Advance the phase to reframing.
  ({ model } = reduce(model, { type: "setPhase", phase: "reframing" }));

  // ── the person closes the scratchpad here ─────────────────────────────────
  // Everything above is the mid-flight state. The round-trip must restore it exactly.

  assertRoundTrips("full mid-flight working model", model);

  // Spot-check key fields with targeted messages for easier failure triage.
  const restored = deserialize(serialize(model));

  assert.equal(restored.tenant, "tep", "tenant must survive");
  assert.equal(restored.phase, "reframing", "phase must survive");
  assert.equal(
    restored.sections.length,
    model.sections.length,
    "section count must survive",
  );
  assert.equal(restored.objections.length, 2, "both objections must survive");
  assert.equal(
    restored.readinessHistory.length,
    2,
    "both readiness records must survive",
  );

  const restoredConstraints = restored.sections.find(
    (s) => s.kind === "constraints",
  );
  assert.equal(
    restoredConstraints?.state,
    "settled",
    "settled state on constraints must survive",
  );
  assert.equal(
    restoredConstraints?.notes.length,
    1,
    "the note on constraints must survive",
  );
  assert.equal(
    restoredConstraints?.notes[0].text,
    "Verify no local-LLM path exists anywhere in the workers",
  );

  const restoredGoal = restored.sections.find((s) => s.kind === "goal");
  assert.equal(restoredGoal?.notes.length, 1, "the note on goal must survive");

  const restoredFirstObj = restored.objections.find((o) => o.id === firstObjId);
  assert.equal(
    restoredFirstObj?.resolved,
    true,
    "the resolved objection must stay resolved",
  );
  const restoredSecondObj = restored.objections.find(
    (o) => o.id !== firstObjId,
  );
  assert.equal(
    restoredSecondObj?.resolved,
    false,
    "the unresolved objection must stay unresolved",
  );

  assert.deepEqual(
    restored.readinessHistory[1],
    { covered: true, cleanCut: true, gapSection: null },
    "the final readiness record must survive with its exact field values",
  );
});
