// TANDEM_PHASES=2
/**
 * SP-21/2 AC-4 — Close and reopen resumes exactly.
 *
 * WHY (INVARIANT): After the Scratchpad is closed (extension host restarted) and
 * reopened with the same sidecarRoot, the full working model is reconstituted from
 * the session file — sections and their states, notes, worker proposals, adversarial
 * objections, readiness history, and the current phase. This must hold forever; any
 * refactor that skips deserializing the session file on cold-start breaks this test.
 *
 * Two fresh extension hosts, same sidecarRoot directory:
 *   Phase 0 — author one of every entity kind, flush(), save model as expected.json.
 *   Phase 1 — openScratchpad with the same root, assert model deep-equals expected.json.
 */

import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as vscode from "vscode";
import type { TandemExtensionApi } from "../extension";

// Fixed across both phases — must be deterministic (no random, no Date.now).
const SIDECAR_ROOT = path.join(os.tmpdir(), "tandem-probe-sp21-2-ac4");
const CURRENT_JSON = path.join(SIDECAR_ROOT, "scratchpad", "current.json");
const EXPECTED_JSON = path.join(SIDECAR_ROOT, "scratchpad", "expected.json");

export async function run(phase: number): Promise<void> {
  const ext = vscode.extensions.getExtension("thinkube.thinkube-tandem");
  assert.ok(ext, "the thinkube-tandem extension must be present");
  const api = (await ext.activate()) as TandemExtensionApi;

  if (phase === 0) {
    // ── Phase 0: Author one of every entity kind, persist, save expected ────
    fs.mkdirSync(SIDECAR_ROOT, { recursive: true });

    // Ensure no leftover session from a previous probe run.
    if (fs.existsSync(CURRENT_JSON)) fs.unlinkSync(CURRENT_JSON);
    if (fs.existsSync(EXPECTED_JSON)) fs.unlinkSync(EXPECTED_JSON);

    const session = await api.scratchpad.openScratchpad({
      sidecarRoot: SIDECAR_ROOT,
    });
    assert.ok(session, "openScratchpad must return a live session in phase 0");

    // One proposed section (worker-generated structure).
    session.dispatch({
      type: "proposeSection",
      kind: "constraints",
      text: "CONSTRAINTSPROPOSED",
      workerId: "probe-worker",
    });

    // Identify the new section so we can set its state.
    const proposedSection = session.model.sections.find(
      (s) => s.kind === "constraints",
    );
    assert.ok(
      proposedSection,
      "constraints section must exist after proposeSection",
    );

    // One settled section state.
    session.dispatch({
      type: "setSectionState",
      id: proposedSection.id,
      state: "settled",
    });

    // One note (on the goal section, which always exists).
    const goalSection = session.model.sections.find((s) => s.kind === "goal");
    assert.ok(goalSection, "goal section must exist");
    session.dispatch({
      type: "addNote",
      sectionId: goalSection.id,
      text: "NOTETEXT",
    });

    // One adversarial objection.
    session.dispatch({ type: "addObjection", text: "OBJECTIONTEXT" });

    // One readiness record.
    session.dispatch({
      type: "recordReadiness",
      record: { covered: false, cleanCut: false, gapSection: null },
    });

    // One phase change.
    session.dispatch({ type: "setPhase", phase: "reframing" });

    // Force the debounced write to disk NOW before the host exits.
    await session.flush();

    // Assert the session file was written.
    assert.ok(
      fs.existsSync(CURRENT_JSON),
      `session file must exist at ${CURRENT_JSON} after flush()`,
    );

    // Save the live model as the reference for phase 1.
    const scratchpadDir = path.dirname(CURRENT_JSON);
    fs.mkdirSync(scratchpadDir, { recursive: true });
    fs.writeFileSync(EXPECTED_JSON, JSON.stringify(session.model), "utf8");

    assert.ok(
      fs.existsSync(EXPECTED_JSON),
      "expected.json must be written beside current.json for phase 1 to read",
    );
  } else {
    // ── Phase 1: Cold-start resume — model must deep-equal expected.json ────
    assert.ok(
      fs.existsSync(EXPECTED_JSON),
      `expected.json must exist at ${EXPECTED_JSON} — was phase 0 skipped or did flush() fail?`,
    );
    assert.ok(
      fs.existsSync(CURRENT_JSON),
      `current.json must exist at ${CURRENT_JSON} — phase 1 depends on phase 0 writing it`,
    );

    const expected = JSON.parse(
      fs.readFileSync(EXPECTED_JSON, "utf8"),
    ) as object;

    // openScratchpad with the same sidecarRoot: must deserialize current.json.
    const session = await api.scratchpad.openScratchpad({
      sidecarRoot: SIDECAR_ROOT,
    });
    assert.ok(session, "openScratchpad must return a live session in phase 1");

    // The reconstituted model must exactly match what phase 0 persisted.
    assert.deepStrictEqual(
      session.model,
      expected,
      "model after cold-start resume must deep-equal the model that was flushed in phase 0 — " +
        "sections and their states, notes, proposals, objections, readiness history, and phase must all be reconstituted",
    );
  }
}
