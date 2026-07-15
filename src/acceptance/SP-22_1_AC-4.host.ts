/**
 * SP-22/1 AC-4 — Integrity is never quiet: the integrity section is conditional on integrity rows.
 *
 * WHY (INVARIANT): The integrity-list section (`<section id="integrity-list">`) must appear
 * in the rendered HTML if and only if at least one defect row has `impact === "integrity"`.
 * When NO integrity rows are present the section must be entirely absent and the type-table
 * must lead. When integrity rows ARE present the section must exist and must precede both
 * tables. This must hold forever: any implementation that renders the integrity-list
 * unconditionally (empty or not), or that omits it when integrity rows exist, breaks this test.
 *
 * Two renders are driven against two different fixture sets in the same extension-host session.
 * Between the renders the thinking space is cleaned and rebuilt with the new fixture so the
 * command re-reads fresh data each time.
 *
 * NOTE on testability seam: same as AC-1 — `thinkube.defects.show` must return the rendered
 * HTML string. The active thinking space is `workspaceFolders[0]/.thinkube/`.
 */

import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import * as vscode from "vscode";

/** Serialise one DefectRow as a JSONL line. */
function row(
  ts: string,
  trigger: string,
  type: string,
  impact: string,
  detail: string,
): string {
  return JSON.stringify({
    ts,
    spec: "22/1",
    activity: "spec-authoring",
    trigger,
    type,
    impact,
    detail,
  });
}

/**
 * Write a single defects JSONL file into `<thinkubeDir>/defects/2026-07.jsonl`,
 * replacing whatever was there before (clean before write).
 */
function writeFixture(thinkubeDir: string, lines: string[]): void {
  fs.rmSync(thinkubeDir, { recursive: true, force: true });
  const defectsDir = path.join(thinkubeDir, "defects");
  fs.mkdirSync(defectsDir, { recursive: true });
  fs.writeFileSync(
    path.join(defectsDir, "2026-07.jsonl"),
    lines.join("\n") + "\n",
    "utf8",
  );
}

export async function run(_phase: number): Promise<void> {
  const ext = vscode.extensions.getExtension("thinkube.thinkube-tandem");
  assert.ok(ext, "the thinkube-tandem extension must be present in the host");
  await ext.activate();

  const wsDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(
    wsDir,
    "test host must have a workspace folder so active context is deterministic",
  );
  const thinkubeDir = path.join(wsDir, ".thinkube");

  // ══════════════════════════════════════════════════════════════════════════════
  // RENDER 1 — Fixture WITHOUT any integrity rows
  // ══════════════════════════════════════════════════════════════════════════════

  // Three rows, all with non-integrity impacts.
  writeFixture(thinkubeDir, [
    row(
      "2026-07-01T10:00:00Z",
      "authoring-time audit",
      "lifecycle definition",
      "prevented",
      "R1",
    ),
    row(
      "2026-07-02T11:00:00Z",
      "gate-verifier failure",
      "algorithm",
      "round lost",
      "R2",
    ),
    row(
      "2026-07-03T12:00:00Z",
      "post-hoc diagnosis",
      "mis-cut slice",
      "round lost",
      "R3",
    ),
  ]);

  const html1 = await vscode.commands.executeCommand<string>(
    "thinkube.defects.show",
  );
  assert.ok(
    typeof html1 === "string" && html1.length > 0,
    "thinkube.defects.show must return the rendered HTML string (render 1 — no integrity rows)",
  );

  // ── integrity-list section must be ABSENT when no integrity rows exist ────────
  // INVARIANT: the section must be omitted entirely — not present but empty.
  assert.ok(
    !html1.includes('<section id="integrity-list"'),
    'HTML must NOT contain <section id="integrity-list"> when no defect rows have impact="integrity" — ' +
      "the section must be conditionally rendered, not always present",
  );

  // ── type-table must be present and must LEAD (appears before trigger-table) ──
  // INVARIANT: when integrity-list is absent, type-table is the first section shown.
  assert.ok(
    html1.includes('<section id="type-table"'),
    'HTML must contain <section id="type-table"> even when there are no integrity rows',
  );
  assert.ok(
    html1.includes('<section id="trigger-table"'),
    'HTML must contain <section id="trigger-table"> even when there are no integrity rows',
  );

  const typePos1 = html1.indexOf('<section id="type-table"');
  const triggerPos1 = html1.indexOf('<section id="trigger-table"');
  assert.ok(
    typePos1 < triggerPos1,
    "type-table must appear before trigger-table in the HTML when integrity-list is absent — " +
      "type-table leads the layout",
  );

  // Confirm no integrity-list sneaks in before type-table (belt-and-suspenders: the
  // `!html1.includes(...)` above already covers absence, but let's be explicit about order too).
  const integrityPos1 = html1.indexOf('<section id="integrity-list"');
  assert.equal(
    integrityPos1,
    -1,
    '<section id="integrity-list"> must not appear anywhere in the HTML for render 1',
  );

  // ── type-table must show the expected types ────────────────────────────────────
  const typeSec1Start = html1.indexOf('<section id="type-table"');
  const typeSec1End = html1.indexOf("</section>", typeSec1Start);
  const typeSec1 = html1.slice(typeSec1Start, typeSec1End);
  assert.ok(
    typeSec1.includes("lifecycle definition"),
    'type-table must render "lifecycle definition" (row R1)',
  );
  assert.ok(
    typeSec1.includes("algorithm"),
    'type-table must render "algorithm" (row R2)',
  );
  assert.ok(
    typeSec1.includes("mis-cut slice"),
    'type-table must render "mis-cut slice" (row R3)',
  );

  // ══════════════════════════════════════════════════════════════════════════════
  // RENDER 2 — Fixture WITH an integrity row
  // ══════════════════════════════════════════════════════════════════════════════

  // Same three rows but row R2 now carries impact="integrity".
  writeFixture(thinkubeDir, [
    row(
      "2026-07-01T10:00:00Z",
      "authoring-time audit",
      "lifecycle definition",
      "prevented",
      "S1",
    ),
    row(
      "2026-07-02T11:00:00Z",
      "gate-verifier failure",
      "algorithm",
      "integrity",
      "S2",
    ),
    row(
      "2026-07-03T12:00:00Z",
      "post-hoc diagnosis",
      "mis-cut slice",
      "round lost",
      "S3",
    ),
  ]);

  const html2 = await vscode.commands.executeCommand<string>(
    "thinkube.defects.show",
  );
  assert.ok(
    typeof html2 === "string" && html2.length > 0,
    "thinkube.defects.show must return the rendered HTML string (render 2 — one integrity row)",
  );

  // ── integrity-list section must be PRESENT when an integrity row exists ───────
  // INVARIANT: a single integrity row is sufficient to arm the integrity-list section.
  assert.ok(
    html2.includes('<section id="integrity-list"'),
    'HTML must contain <section id="integrity-list"> when at least one defect row has impact="integrity" — ' +
      "the integrity section must always be shown when false-green defects are recorded",
  );

  // ── integrity-list must PRECEDE both tables ───────────────────────────────────
  // INVARIANT: the integrity list is always the loudest, most prominent element —
  // it must come before the type-table and the trigger-table.
  assert.ok(
    html2.includes('<section id="type-table"'),
    'HTML must contain <section id="type-table"> in render 2',
  );
  assert.ok(
    html2.includes('<section id="trigger-table"'),
    'HTML must contain <section id="trigger-table"> in render 2',
  );

  const integrityPos2 = html2.indexOf('<section id="integrity-list"');
  const typePos2 = html2.indexOf('<section id="type-table"');
  const triggerPos2 = html2.indexOf('<section id="trigger-table"');

  assert.ok(
    integrityPos2 < typePos2,
    "integrity-list section must appear before type-table section in render 2 — " +
      "the integrity list always leads when integrity rows exist",
  );
  assert.ok(
    integrityPos2 < triggerPos2,
    "integrity-list section must appear before trigger-table section in render 2",
  );
  assert.ok(
    typePos2 < triggerPos2,
    "type-table must appear before trigger-table in render 2",
  );

  // ── integrity-list must contain the integrity row's identifying detail ────────
  // INVARIANT: the list must render the actual defect entry, not just a heading.
  const intSec2Start = html2.indexOf('<section id="integrity-list"');
  const intSec2End = html2.indexOf("</section>", intSec2Start);
  const intSec2 = html2.slice(intSec2Start, intSec2End);
  assert.ok(
    intSec2.includes("S2"),
    'integrity-list must contain the detail text "S2" of the integrity row (ts=2026-07-02, impact="integrity")',
  );

  // ── the non-integrity rows must NOT appear in the integrity-list ──────────────
  // INVARIANT: the integrity-list is exclusively for impact="integrity" rows.
  assert.ok(
    !intSec2.includes("S1"),
    'integrity-list must NOT contain "S1" — row S1 has impact="prevented", not "integrity"',
  );
  assert.ok(
    !intSec2.includes("S3"),
    'integrity-list must NOT contain "S3" — row S3 has impact="round lost", not "integrity"',
  );
}
