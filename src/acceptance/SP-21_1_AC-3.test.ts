// SP-21/1 AC-3 — A note added to a section attaches to that section as a distinct item in the
// working model and is retained across subsequent model operations.
//
// WHY (INVARIANT): Notes are first-class citizens of the working model — they are the person's
// in-context annotations that must survive every reducer step. The reducer must keep added notes
// in the target section's notes array, never merge them into other sections, and never lose them
// when subsequent operations (edits, state changes, further notes) are applied. This must hold
// for the life of the code.

import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, goalSection, reduce } from "../scratchpad/model";
import type { Note } from "../scratchpad/model";

// ── addNote attaches to the correct section ────────────────────────────────

test("reduce(addNote) places the new note in the target section's notes array", () => {
  let model = emptyModel("tep");
  ({ model } = reduce(model, { type: "seedGoal", text: "Goal" }));

  const goal = goalSection(model);
  const { model: updated } = reduce(model, {
    type: "addNote",
    sectionId: goal.id,
    text: "Remember to verify the approval-token seam is reachable from the new surface.",
  });

  const updatedGoal = goalSection(updated);
  assert.equal(
    updatedGoal.notes.length,
    1,
    "section must have exactly one note after a single addNote",
  );
  assert.equal(
    updatedGoal.notes[0].text,
    "Remember to verify the approval-token seam is reachable from the new surface.",
    "note text must match the text provided to addNote",
  );
});

test("reduce(addNote) produces a note with a non-empty string id", () => {
  let model = emptyModel("tep");
  ({ model } = reduce(model, { type: "seedGoal", text: "Goal" }));
  const goal = goalSection(model);

  const { model: updated } = reduce(model, {
    type: "addNote",
    sectionId: goal.id,
    text: "A note.",
  });

  const note = goalSection(updated).notes[0];
  assert.ok(note, "note must be present in the section after addNote");
  assert.ok(
    typeof note.id === "string" && note.id.length > 0,
    `note must have a non-empty string id — got: ${JSON.stringify(note.id)}`,
  );
});

// ── addNote delta records the addition ────────────────────────────────────────

test("reduce(addNote) delta.after is the newly added Note object with the correct text", () => {
  let model = emptyModel("tep");
  ({ model } = reduce(model, { type: "seedGoal", text: "Goal" }));
  const goal = goalSection(model);

  const { model: updated, delta } = reduce(model, {
    type: "addNote",
    sectionId: goal.id,
    text: "The spike confirms the approval-token seam is reachable.",
  });

  const note = goalSection(updated).notes[0];
  // delta.after must represent the new Note — check it matches the note in the model.
  const afterNote = delta.after as Note;
  assert.ok(
    afterNote != null,
    "delta.after must be truthy for addNote — the delta must record what was added",
  );
  assert.equal(
    afterNote.text,
    note.text,
    "delta.after.text must match the note text now held in the model — delta and model must agree",
  );
});

test("reduce(addNote) delta.action carries the addNote action that caused the addition", () => {
  let model = emptyModel("tep");
  ({ model } = reduce(model, { type: "seedGoal", text: "Goal" }));
  const goal = goalSection(model);

  const { delta } = reduce(model, {
    type: "addNote",
    sectionId: goal.id,
    text: "Some note text",
  });

  assert.equal(
    delta.action.type,
    "addNote",
    "delta.action.type must be 'addNote'",
  );
});

test("reduce(addNote) delta.field is a non-empty string path that locates the new note", () => {
  let model = emptyModel("tep");
  ({ model } = reduce(model, { type: "seedGoal", text: "Goal" }));
  const goal = goalSection(model);

  const { delta } = reduce(model, {
    type: "addNote",
    sectionId: goal.id,
    text: "A note",
  });

  assert.ok(
    typeof delta.field === "string" && delta.field.length > 0,
    `delta.field must be a non-empty dotted path — got: ${JSON.stringify(delta.field)}`,
  );
});

// ── notes are retained across subsequent operations ────────────────────────

test("a note survives a subsequent editSection on the same section", () => {
  let model = emptyModel("tep");
  ({ model } = reduce(model, { type: "seedGoal", text: "Initial text" }));
  const goal = goalSection(model);

  // Add the note first.
  ({ model } = reduce(model, {
    type: "addNote",
    sectionId: goal.id,
    text: "Note added before the correction",
  }));

  // Then correct the section's text.
  ({ model } = reduce(model, {
    type: "editSection",
    id: goal.id,
    text: "Corrected text",
  }));

  // The note must still be attached.
  const finalGoal = goalSection(model);
  assert.equal(
    finalGoal.notes.length,
    1,
    "note must survive a subsequent editSection on the same section",
  );
  assert.equal(finalGoal.notes[0].text, "Note added before the correction");
});

test("a note survives a subsequent setSectionState change on the same section", () => {
  let model = emptyModel("tep");
  ({ model } = reduce(model, { type: "seedGoal", text: "Goal" }));
  // Propose a section so it starts in 'proposed' state.
  ({ model } = reduce(model, {
    type: "proposeSection",
    kind: "constraints",
    text: "Must not call create_slice",
    workerId: "w-1",
  }));
  const constraints = model.sections.find((s) => s.kind === "constraints")!;

  // Add a note to the proposed section.
  ({ model } = reduce(model, {
    type: "addNote",
    sectionId: constraints.id,
    text: "Check the slicer's non-committing mode documentation.",
  }));

  // Advance the section's state.
  ({ model } = reduce(model, {
    type: "setSectionState",
    id: constraints.id,
    state: "settled",
  }));

  const finalConstraints = model.sections.find(
    (s) => s.kind === "constraints",
  )!;
  assert.equal(
    finalConstraints.notes.length,
    1,
    "note must survive a setSectionState change on the same section",
  );
  assert.equal(
    finalConstraints.notes[0].text,
    "Check the slicer's non-committing mode documentation.",
  );
});

test("multiple notes accumulate on a section and all are retained", () => {
  let model = emptyModel("tep");
  ({ model } = reduce(model, { type: "seedGoal", text: "Goal" }));
  const goal = goalSection(model);

  ({ model } = reduce(model, {
    type: "addNote",
    sectionId: goal.id,
    text: "Note A — freeze-token seam",
  }));
  ({ model } = reduce(model, {
    type: "addNote",
    sectionId: goal.id,
    text: "Note B — dry-run slicer mode",
  }));
  ({ model } = reduce(model, {
    type: "addNote",
    sectionId: goal.id,
    text: "Note C — adversarial worker blinding",
  }));

  const finalGoal = goalSection(model);
  assert.equal(
    finalGoal.notes.length,
    3,
    "all three notes must accumulate on the section and all must be retained",
  );
  const texts = finalGoal.notes.map((n) => n.text);
  assert.ok(
    texts.includes("Note A — freeze-token seam"),
    "Note A must be retained",
  );
  assert.ok(
    texts.includes("Note B — dry-run slicer mode"),
    "Note B must be retained",
  );
  assert.ok(
    texts.includes("Note C — adversarial worker blinding"),
    "Note C must be retained",
  );
});

test("notes on different sections do not bleed across sections", () => {
  let model = emptyModel("tep");
  ({ model } = reduce(model, { type: "seedGoal", text: "Goal" }));

  // Propose two distinct sections.
  ({ model } = reduce(model, {
    type: "proposeSection",
    kind: "constraints",
    text: "Constraints text",
    workerId: "w-1",
  }));
  ({ model } = reduce(model, {
    type: "proposeSection",
    kind: "elements",
    text: "Elements text",
    workerId: "w-1",
  }));

  const constraints = model.sections.find((s) => s.kind === "constraints")!;

  // Add a note to constraints only — elements must stay empty.
  ({ model } = reduce(model, {
    type: "addNote",
    sectionId: constraints.id,
    text: "A note for constraints only",
  }));

  const finalConstraints = model.sections.find(
    (s) => s.kind === "constraints",
  )!;
  const finalElements = model.sections.find((s) => s.kind === "elements")!;
  assert.equal(
    finalConstraints.notes.length,
    1,
    "the note must be attached to the constraints section",
  );
  assert.equal(
    finalElements.notes.length,
    0,
    "the elements section must not receive notes intended for constraints",
  );
});

test("each note in a multi-note section has a unique id", () => {
  let model = emptyModel("tep");
  ({ model } = reduce(model, { type: "seedGoal", text: "Goal" }));
  const goal = goalSection(model);

  ({ model } = reduce(model, {
    type: "addNote",
    sectionId: goal.id,
    text: "First",
  }));
  ({ model } = reduce(model, {
    type: "addNote",
    sectionId: goal.id,
    text: "Second",
  }));

  const notes = goalSection(model).notes;
  assert.equal(notes.length, 2);
  assert.notEqual(
    notes[0].id,
    notes[1].id,
    "each note must have a unique id — ids must not collide even on the same section",
  );
});
