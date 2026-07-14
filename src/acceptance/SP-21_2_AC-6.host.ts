/**
 * SP-21/2 AC-6 — Freeze tracks the live session.
 *
 * WHY (INVARIANT): The Freeze control's enabled state follows the held model as it
 * changes — disabled while coverage is red or the dry-run cut is unclean, enabled
 * exactly when covered=true AND cleanCut=true in the latest readiness record. This
 * must hold forever; any implementation that caches an earlier enabled state or ignores
 * readiness record updates breaks this test.
 *
 * Driven exclusively through dispatch on one open session — no command invocations,
 * no panel interactions. The control is observed only via renderedHtml().
 */

import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as vscode from "vscode";
import type { TandemExtensionApi } from "../extension";

/** Extract the opening tag of <button id="freeze"> from the HTML string. */
function freezeButtonTag(html: string): string | undefined {
  // Match the full opening tag — id may appear before or after other attributes.
  const m = html.match(/<button\b[^>]*\bid\s*=\s*["']freeze["'][^>]*>/i);
  return m ? m[0] : undefined;
}

/** True iff the freeze button's opening tag contains the `disabled` attribute. */
function freezeIsDisabled(html: string): boolean {
  const tag = freezeButtonTag(html);
  if (!tag) {
    throw new Error(
      `renderedHtml() contains no <button id="freeze"> element — ` +
        "the Freeze control must always be rendered in the scratchpad panel",
    );
  }
  // `disabled` may appear as a bare attribute or as disabled="disabled" / disabled="".
  return /\bdisabled\b/.test(tag);
}

export async function run(_phase: number): Promise<void> {
  const ext = vscode.extensions.getExtension("thinkube.thinkube-tandem");
  assert.ok(ext, "the thinkube-tandem extension must be present");
  const api = (await ext.activate()) as TandemExtensionApi;

  const tmpDir = path.join(os.tmpdir(), "tandem-probe-sp21-2-ac6");
  fs.mkdirSync(tmpDir, { recursive: true });

  const session = await api.scratchpad.openScratchpad({ sidecarRoot: tmpDir });
  assert.ok(session, "openScratchpad must return a live session");

  // ── State 1: no readiness record — freeze must be disabled ───────────────
  // INVARIANT: without a readiness check the gate is always closed.
  assert.equal(
    session.model.readinessHistory.length,
    0,
    "fresh session must have no readiness history",
  );
  assert.ok(
    freezeIsDisabled(session.renderedHtml()),
    "freeze button must carry the disabled attribute when no readiness record exists",
  );

  // ── State 2: covered=false — freeze must remain disabled ─────────────────
  // INVARIANT: uncovered sections close the gate regardless of cleanCut.
  session.dispatch({
    type: "recordReadiness",
    record: { covered: false, cleanCut: false, gapSection: null },
  });
  assert.ok(
    freezeIsDisabled(session.renderedHtml()),
    "freeze button must carry the disabled attribute when covered=false — " +
      "the coverage gate must be independently enforced",
  );

  // ── State 3: covered=true but cleanCut=false — freeze must remain disabled ─
  // INVARIANT: an unclean dry-run cut closes the gate regardless of coverage.
  session.dispatch({
    type: "recordReadiness",
    record: { covered: true, cleanCut: false, gapSection: "constraints" },
  });
  assert.ok(
    freezeIsDisabled(session.renderedHtml()),
    "freeze button must carry the disabled attribute when cleanCut=false — " +
      "the dry-run-cut gate must be independently enforced",
  );

  // ── State 4: covered=true AND cleanCut=true — freeze must be enabled ─────
  // INVARIANT: only the combination of both halves passing opens the gate.
  session.dispatch({
    type: "recordReadiness",
    record: { covered: true, cleanCut: true, gapSection: null },
  });
  assert.ok(
    !freezeIsDisabled(session.renderedHtml()),
    "freeze button must NOT carry the disabled attribute when covered=true AND cleanCut=true — " +
      "both gate halves passing must open the Freeze control",
  );

  // ── Confirm the same session object tracked all four states ──────────────
  // INVARIANT: the control reflects the LIVE session, not a snapshot.
  assert.equal(
    api.scratchpad.getScratchpadSession(),
    session,
    "getScratchpadSession() must return the same session object throughout all four state transitions",
  );
}
