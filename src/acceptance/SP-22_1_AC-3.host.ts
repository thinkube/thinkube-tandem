/**
 * SP-22/1 AC-3 — The manual-entry command appends a well-formed row.
 *
 * WHY (INVARIANT): Invoking `thinkube.defects.add` with a full programmatic attribute
 * object (bypassing all quick-inputs) must append exactly one well-formed JSONL row to
 * the current month's defects log in the active thinking space, and that row must
 * round-trip through `parseDefectLog` with zero parse errors and exactly the field values
 * that were supplied. The aggregation functions (`typeByMonth`, `catchPointCurve`) must
 * reflect the new row correctly. This is the manual-entry path for defects that no
 * machinery observes — it must always produce a well-formed, parseable, round-trippable row.
 *
 * NOTE on thinking-space resolution: see SP-22_1_AC-1.host.ts. Same convention:
 * `thinkubeDir = path.join(getCurrentActiveContext(), '.thinkube')`, where
 * `getCurrentActiveContext()` resolves to `workspaceFolders[0]` in the test host.
 */

import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import * as vscode from "vscode";

import {
  parseDefectLog,
  typeByMonth,
  catchPointCurve,
} from "../services/defectStats";

/** Return the YYYY-MM string for the current UTC month — same formula defectLog uses. */
function currentUtcMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function run(_phase: number): Promise<void> {
  const ext = vscode.extensions.getExtension("thinkube.thinkube-tandem");
  assert.ok(ext, "the thinkube-tandem extension must be present in the host");
  await ext.activate();

  // ── 1. Ensure a clean thinking space (no pre-existing defects) ───────────────
  // We want appendDefect to produce exactly ONE row so the round-trip check is exact.
  const wsDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(
    wsDir,
    "test host must have a workspace folder so active context is deterministic",
  );
  const thinkubeDir = path.join(wsDir, ".thinkube");
  fs.rmSync(thinkubeDir, { recursive: true, force: true });

  // ── 2. Execute thinkube.defects.add with a full programmatic attribute object ─
  // INVARIANT: when the optional argument is supplied, NO quick-input must appear and
  // the row is appended immediately. The return must resolve (not hang) after the append.
  const ARG = {
    activity: "spec-authoring",
    trigger: "authoring-time audit",
    type: "lifecycle definition",
    qualifier: "missing",
    impact: "prevented",
    detail: "MANUAL_ENTRY_PROBE_DETAIL_MARKER",
  };

  // executeCommand resolves after the command handler returns — if it hangs (e.g.
  // waiting for a quick-input that never opens in a headless host), this will time out.
  await vscode.commands.executeCommand("thinkube.defects.add", ARG);

  // ── 3. Verify the JSONL file was written at the expected path ─────────────────
  // defectLog.appendDefect uses the current UTC date to pick the file; we mirror that.
  const ym = currentUtcMonth();
  const logPath = path.join(thinkubeDir, "defects", `${ym}.jsonl`);

  assert.ok(
    fs.existsSync(logPath),
    `the defects JSONL file must have been created at ${logPath} — ` +
      "thinkube.defects.add must call defectLog.appendDefect with the active thinking space dir",
  );

  // ── 4. Exactly one line must have been appended ───────────────────────────────
  const fileText = fs.readFileSync(logPath, "utf8");
  const nonEmptyLines = fileText.split("\n").filter((l) => l.trim().length > 0);
  assert.equal(
    nonEmptyLines.length,
    1,
    "exactly one JSONL line must be present in the file — one command call appends one row",
  );

  // ── 5. parseDefectLog round-trip: zero parse errors, one row ─────────────────
  // INVARIANT: the row appended by thinkube.defects.add must be parseable by
  // parseDefectLog with no errors — the capture and read paths share the same schema.
  const { rows, parseErrors } = parseDefectLog(fileText);
  assert.equal(
    parseErrors,
    0,
    "parseDefectLog must report zero parse errors — the appended row must be valid JSONL",
  );
  assert.equal(
    rows.length,
    1,
    "parseDefectLog must yield exactly one row after one thinkube.defects.add call",
  );

  // ── 6. Row fields must match the supplied argument exactly ────────────────────
  // INVARIANT: the row must carry the attribute values that were passed in — no
  // transformation, no defaults that overwrite supplied values.
  const row = rows[0];
  assert.equal(
    row.activity,
    ARG.activity,
    `row.activity must be "${ARG.activity}" — the value supplied in the programmatic argument`,
  );
  assert.equal(
    row.trigger,
    ARG.trigger,
    `row.trigger must be "${ARG.trigger}"`,
  );
  assert.equal(row.type, ARG.type, `row.type must be "${ARG.type}"`);
  assert.equal(
    row.qualifier,
    ARG.qualifier,
    `row.qualifier must be "${ARG.qualifier}"`,
  );
  assert.equal(row.impact, ARG.impact, `row.impact must be "${ARG.impact}"`);
  assert.equal(
    row.detail,
    ARG.detail,
    `row.detail must be "${ARG.detail}" — the detail marker must be preserved verbatim`,
  );

  // The ts field must be auto-filled as an ISO timestamp (appendDefect behaviour).
  assert.ok(
    typeof row.ts === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(row.ts),
    `row.ts must be an ISO 8601 timestamp (auto-filled by appendDefect); got: ${JSON.stringify(row.ts)}`,
  );

  // The ts month must match the file's month (otherwise the row is in the wrong file).
  assert.ok(
    row.ts.startsWith(ym),
    `row.ts "${row.ts}" must start with the current month "${ym}" — ` +
      "the row was written to the correct month's file",
  );

  // ── 7. typeByMonth reflects the new row correctly ─────────────────────────────
  // INVARIANT: the aggregation of the appended row must land in the correct month
  // bucket with the correct type — the round-trip is complete.
  const byMonth = typeByMonth(rows);
  const monthMap = byMonth.get(ym);
  assert.ok(
    monthMap,
    `typeByMonth must contain an entry for the current month "${ym}"`,
  );
  assert.equal(
    monthMap.get(ARG.type),
    1,
    `typeByMonth["${ym}"]["${ARG.type}"] must be 1 — the one appended row belongs to this type`,
  );

  // ── 8. catchPointCurve reflects the trigger ───────────────────────────────────
  // INVARIANT: the trigger "authoring-time audit" (TRIGGER_ORDER[0]) must appear first
  // in the curve with count 1 — the earliest catch-point, exactly one row.
  const curve = catchPointCurve(rows);
  assert.ok(
    curve.length >= 1,
    "catchPointCurve must have at least one entry after one append",
  );
  assert.equal(
    curve[0].trigger,
    ARG.trigger,
    `the first catch-point curve entry must be "${ARG.trigger}" — ` +
      "it is TRIGGER_ORDER[0] (the earliest/cheapest catch point) and the only trigger in the data",
  );
  assert.equal(
    curve[0].count,
    1,
    "the catch-point count must be 1 — exactly one row was appended",
  );
}
