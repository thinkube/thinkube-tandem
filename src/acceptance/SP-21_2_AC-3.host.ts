/**
 * SP-21/2 AC-3 — Corrections render as visible deltas.
 *
 * WHY (INVARIANT): A person's edit to a section must produce an explicit before/after
 * delta — the change is never silently absorbed. The returned Delta carries both the
 * previous text (before=A) and the new text (after=B). The rendered panel shows BOTH
 * A (in the delta log) and B (the live section text). The model holds B. This must hold
 * forever; any implementation that silently absorbs an edit without recording a delta
 * breaks this test.
 */

import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as vscode from "vscode";
import type { TandemExtensionApi } from "../extension";

// Marker strings: all-caps alphanumeric only — no quotes, angle-brackets, or ampersands
// so that HTML escaping cannot mask the strings in the rendered HTML.
const TEXT_A = "TEXTALPHA";
const TEXT_B = "TEXTBETA";

export async function run(_phase: number): Promise<void> {
  const ext = vscode.extensions.getExtension("thinkube.thinkube-tandem");
  assert.ok(ext, "the thinkube-tandem extension must be present");
  const api = (await ext.activate()) as TandemExtensionApi;

  const tmpDir = path.join(os.tmpdir(), "tandem-probe-sp21-2-ac3");
  fs.mkdirSync(tmpDir, { recursive: true });

  const session = await api.scratchpad.openScratchpad({ sidecarRoot: tmpDir });
  assert.ok(session, "openScratchpad must return a live session");

  // ── Seed the goal with TEXT_A so there is a "before" value to correct ─────
  session.dispatch({ type: "seedGoal", text: TEXT_A });

  const goalSection = session.model.sections.find((s) => s.kind === "goal");
  assert.ok(goalSection, "goal section must exist after seedGoal");
  assert.equal(
    goalSection.text,
    TEXT_A,
    "goal section text must equal TEXT_A immediately after seedGoal",
  );

  // ── Edit the goal section from TEXT_A → TEXT_B ────────────────────────────
  const editDelta = session.dispatch({
    type: "editSection",
    id: goalSection.id,
    text: TEXT_B,
  });

  // ── The returned Delta must carry both the before AND the after value ──────
  // INVARIANT: a correction is always visible — the delta is never opaque.
  assert.equal(
    editDelta.before,
    TEXT_A,
    "Delta.before must equal TEXT_A — the text that existed before the edit",
  );
  assert.equal(
    editDelta.after,
    TEXT_B,
    "Delta.after must equal TEXT_B — the text the edit changed it to",
  );
  assert.notEqual(
    editDelta.before,
    editDelta.after,
    "Delta.before and Delta.after must differ — a correction that produces identical before/after is not a correction",
  );

  // ── The model must hold TEXT_B as the live text ───────────────────────────
  const goalAfterEdit = session.model.sections.find((s) => s.kind === "goal");
  assert.ok(goalAfterEdit, "goal section must still exist after editSection");
  assert.equal(
    goalAfterEdit.text,
    TEXT_B,
    "model must hold TEXT_B as the goal section text after editSection",
  );

  // ── renderedHtml() must show BOTH TEXT_A and TEXT_B ──────────────────────
  // TEXT_A appears in the delta log (as the before-value of the editSection delta).
  // TEXT_B appears in the live section and in the delta log (as the after-value).
  const html = session.renderedHtml();
  assert.ok(
    html.includes(TEXT_A),
    `renderedHtml() must contain '${TEXT_A}' — the before-text must appear in the delta log so the correction is visible`,
  );
  assert.ok(
    html.includes(TEXT_B),
    `renderedHtml() must contain '${TEXT_B}' — the after-text must appear in the live section and the delta log`,
  );
}
