/**
 * SP-21/2 AC-2 — Actions accumulate in one held session.
 *
 * WHY (INVARIANT): Every action dispatched into the open panel flows through the single
 * reducer into one held working model — nothing is discarded or reset between actions.
 * The final render must show all three effects together: the seed goal text, the edited
 * section text, and the note text. This must hold forever; any refactor that resets the
 * model between actions or opens a fresh model per-action breaks this test.
 */

import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as vscode from "vscode";
import type { TandemExtensionApi } from "../extension";

// Marker strings: all-caps, no quotes/angle-brackets — HTML escaping cannot mask them.
const SEED_GOAL_TEXT = "SEEDGOALMARKER";
const EDIT_SECTION_TEXT = "EDITSECTIONMARKER";
const NOTE_TEXT = "NOTEMARKER";

export async function run(_phase: number): Promise<void> {
  const ext = vscode.extensions.getExtension("thinkube.thinkube-tandem");
  assert.ok(ext, "the thinkube-tandem extension must be present");
  const api = (await ext.activate()) as TandemExtensionApi;

  const tmpDir = path.join(os.tmpdir(), "tandem-probe-sp21-2-ac2");
  fs.mkdirSync(tmpDir, { recursive: true });

  const session = await api.scratchpad.openScratchpad({ sidecarRoot: tmpDir });
  assert.ok(session, "openScratchpad must return a live session");

  // ── Step 1: seedGoal ──────────────────────────────────────────────────────
  session.dispatch({ type: "seedGoal", text: SEED_GOAL_TEXT });

  // After seedGoal: phase must be 'shaping' and goal text must be set.
  assert.equal(
    session.model.phase,
    "shaping",
    "seedGoal must transition the model to phase 'shaping'",
  );
  const goalAfterSeed = session.model.sections.find((s) => s.kind === "goal");
  assert.ok(goalAfterSeed, "a goal section must exist after seedGoal");
  assert.equal(
    goalAfterSeed.text,
    SEED_GOAL_TEXT,
    "goal section text must equal the seedGoal text immediately after dispatch",
  );

  // ── Step 2: editSection on the goal ───────────────────────────────────────
  const goalId = goalAfterSeed.id;
  session.dispatch({
    type: "editSection",
    id: goalId,
    text: EDIT_SECTION_TEXT,
  });

  // After editSection: phase must still be 'shaping' (earlier effect preserved);
  // goal text must reflect the edit.
  assert.equal(
    session.model.phase,
    "shaping",
    "model phase must remain 'shaping' after editSection — seedGoal's phase transition must not be discarded",
  );
  const goalAfterEdit = session.model.sections.find((s) => s.kind === "goal");
  assert.ok(goalAfterEdit, "goal section must still exist after editSection");
  assert.equal(
    goalAfterEdit.text,
    EDIT_SECTION_TEXT,
    "goal section text must equal the editSection text after dispatch",
  );

  // ── Step 3: addNote to the goal section ───────────────────────────────────
  session.dispatch({ type: "addNote", sectionId: goalId, text: NOTE_TEXT });

  // After addNote: all earlier effects must still be present.
  assert.equal(
    session.model.phase,
    "shaping",
    "model phase must remain 'shaping' after addNote",
  );
  const goalAfterNote = session.model.sections.find((s) => s.kind === "goal");
  assert.ok(goalAfterNote, "goal section must still exist after addNote");
  assert.equal(
    goalAfterNote.text,
    EDIT_SECTION_TEXT,
    "goal section text must still be the edited text after addNote — editSection's effect must not be lost",
  );
  assert.equal(
    goalAfterNote.notes.length,
    1,
    "goal section must have exactly one note after addNote",
  );
  assert.equal(
    goalAfterNote.notes[0].text,
    NOTE_TEXT,
    "the note text must equal what was dispatched",
  );

  // ── Final render: all three marker texts must appear in renderedHtml() ────
  // SEEDGOALMARKER appears in the delta log (as before-value of editSection's delta
  // and as after-value of seedGoal's delta). EDITSECTIONMARKER appears in the live
  // section and in the delta log. NOTEMARKER appears in the notes.
  const html = session.renderedHtml();
  assert.ok(
    html.includes(SEED_GOAL_TEXT),
    `renderedHtml() must contain '${SEED_GOAL_TEXT}' — the seed goal text must appear in the delta log`,
  );
  assert.ok(
    html.includes(EDIT_SECTION_TEXT),
    `renderedHtml() must contain '${EDIT_SECTION_TEXT}' — the edited section text must appear in the live section`,
  );
  assert.ok(
    html.includes(NOTE_TEXT),
    `renderedHtml() must contain '${NOTE_TEXT}' — the note text must appear in the rendered panel`,
  );
}
