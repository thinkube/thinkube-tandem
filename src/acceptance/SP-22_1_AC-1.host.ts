/**
 * SP-22/1 AC-1 — The distributions render on demand with the right section structure.
 *
 * WHY (INVARIANT): Invoking `thinkube.defects.show` against a thinking space that contains
 * defect JSONL files (some spanning multiple months, at least one with impact="integrity")
 * must open exactly ONE webview titled "Tandem Defects" whose HTML shows three sections in
 * the required order: integrity-list FIRST (because integrity rows are present), then
 * type-table, then trigger-table — with the trigger-table ordered by the canonical
 * catch-point ranking. The type-table must surface the month labels and type names from
 * the fixture data. This must hold forever: any refactor that reorders the sections, omits
 * the integrity-list when integrity rows exist, or drops types/triggers from the render
 * breaks this test.
 *
 * NOTE on testability seam: `thinkube.defects.show` must return the rendered HTML string
 * so this probe can assert its content. Without a return value there is no VS Code API to
 * read a webview's HTML after it has been set. The implementer MUST return the HTML string
 * from the command handler. The tab-title assertion (checked via vscode.window.tabGroups)
 * is independent and does not require a return value.
 *
 * NOTE on thinking-space resolution: in the test extension host the workspace folder is
 * a throwaway temp dir and `getCurrentActiveContext()` resolves to that folder.  The
 * defects command must therefore derive `thinkubeDir` as
 * `path.join(getCurrentActiveContext(), '.thinkube')` — the same convention `appendDefect`
 * uses when called from the capture sites. This probe writes its fixtures there.
 */

import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import * as vscode from "vscode";

// ── Fixture helpers ─────────────────────────────────────────────────────────────

/** Build one serialised DefectRow JSONL line. */
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
 * Extract the text content of a named section (`<section id="X">…</section>`) from the HTML.
 * Returns the slice from the opening section tag to (but not including) the matching </section>.
 */
function extractSection(html: string, id: string): string {
  const open = `<section id="${id}"`;
  const start = html.indexOf(open);
  if (start === -1) return "";
  const end = html.indexOf("</section>", start);
  return end === -1
    ? html.slice(start)
    : html.slice(start, end + "</section>".length);
}

export async function run(_phase: number): Promise<void> {
  const ext = vscode.extensions.getExtension("thinkube.thinkube-tandem");
  assert.ok(ext, "the thinkube-tandem extension must be present in the host");
  await ext.activate();

  // ── 1. Commands must be registered ───────────────────────────────────────────
  // TRANSITION: thinkube.defects.show and thinkube.defects.add are NEW commands
  // added by this spec; their presence proves the registration landed.
  const cmds = await vscode.commands.getCommands(true);
  assert.ok(
    cmds.includes("thinkube.defects.show"),
    "thinkube.defects.show must be registered in the live VS Code command registry",
  );
  assert.ok(
    cmds.includes("thinkube.defects.add"),
    "thinkube.defects.add must be registered in the live VS Code command registry",
  );

  // ── 2. package.json must declare both commands with the right category ────────
  // TRANSITION: both commands declared in package.json proves the metadata landed.
  const pkgPath = path.join(ext.extensionPath, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    contributes: {
      commands: Array<{ command: string; category?: string }>;
      menus?: { "view/title"?: Array<{ command: string; group?: string }> };
    };
  };
  const pkgCmds = pkg.contributes.commands;

  const showEntry = pkgCmds.find((c) => c.command === "thinkube.defects.show");
  assert.ok(
    showEntry,
    "thinkube.defects.show must appear in package.json contributes.commands",
  );
  assert.equal(
    showEntry.category,
    "Thinkube Tandem",
    'thinkube.defects.show category must be "Thinkube Tandem"',
  );

  const addEntry = pkgCmds.find((c) => c.command === "thinkube.defects.add");
  assert.ok(
    addEntry,
    "thinkube.defects.add must appear in package.json contributes.commands",
  );
  assert.equal(
    addEntry.category,
    "Thinkube Tandem",
    'thinkube.defects.add category must be "Thinkube Tandem"',
  );

  // TRANSITION: defects.show must appear in the Specs view title bar (navigation).
  const viewTitleMenus = pkg.contributes.menus?.["view/title"] ?? [];
  const specsBarEntry = viewTitleMenus.find(
    (m) =>
      m.command === "thinkube.defects.show" &&
      typeof m.group === "string" &&
      m.group.startsWith("navigation"),
  );
  assert.ok(
    specsBarEntry,
    "thinkube.defects.show must appear in package.json contributes.menus[view/title] " +
      "with a navigation group — it belongs in the Specs view title bar",
  );

  // ── 3. Seed the thinking space with fixture data ──────────────────────────────
  // The extension derives thinkubeDir = path.join(getCurrentActiveContext(), '.thinkube').
  // In the test host getCurrentActiveContext() resolves to workspaceFolders[0].
  const wsDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(
    wsDir,
    "test host must have a workspace folder so active context is deterministic",
  );
  const thinkubeDir = path.join(wsDir, ".thinkube");

  // Clean any leftovers from a previous probe run, then write fresh fixtures.
  fs.rmSync(thinkubeDir, { recursive: true, force: true });
  const defectsDir = path.join(thinkubeDir, "defects");
  fs.mkdirSync(defectsDir, { recursive: true });

  // 2026-07: three rows — one integrity ("algorithm"), one other type per month.
  const jul =
    [
      row(
        "2026-07-01T10:00:00Z",
        "authoring-time audit",
        "lifecycle definition",
        "prevented",
        "D1",
      ),
      row(
        "2026-07-02T11:00:00Z",
        "gate-verifier failure",
        "algorithm",
        "integrity",
        "D2",
      ),
      row(
        "2026-07-03T12:00:00Z",
        "judge contradiction",
        "contract format/completeness",
        "round lost",
        "D3",
      ),
    ].join("\n") + "\n";

  // 2026-06: one row.
  const jun =
    [
      row(
        "2026-06-15T09:00:00Z",
        "post-hoc diagnosis",
        "mis-cut slice",
        "round lost",
        "D4",
      ),
    ].join("\n") + "\n";

  fs.writeFileSync(path.join(defectsDir, "2026-07.jsonl"), jul, "utf8");
  fs.writeFileSync(path.join(defectsDir, "2026-06.jsonl"), jun, "utf8");

  // ── 4. Execute thinkube.defects.show and collect the rendered HTML ────────────
  // INVARIANT: the command must return the rendered HTML string for testability
  // (see NOTE at the top of this file). Without this return value, webview content
  // cannot be inspected from a host probe.
  const html = await vscode.commands.executeCommand<string>(
    "thinkube.defects.show",
  );
  assert.ok(
    typeof html === "string" && html.length > 0,
    "thinkube.defects.show must return the rendered HTML string — " +
      "this is the testability seam for verifying section structure and content",
  );

  // ── 5. A tab titled "Tandem Defects" must be open ────────────────────────────
  // INVARIANT: the webview tab is always visible with this exact title.
  const allTabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
  const defectsTab = allTabs.find((t) => t.label === "Tandem Defects");
  assert.ok(
    defectsTab,
    'a tab labelled "Tandem Defects" must be open after executing thinkube.defects.show',
  );

  // ── 6. All three required sections must be present ────────────────────────────
  // INVARIANT: integrity-list, type-table, and trigger-table must all appear.
  assert.ok(
    html.includes('<section id="integrity-list"'),
    'HTML must contain <section id="integrity-list"> — an integrity row is present in the fixture',
  );
  assert.ok(
    html.includes('<section id="type-table"'),
    'HTML must contain <section id="type-table">',
  );
  assert.ok(
    html.includes('<section id="trigger-table"'),
    'HTML must contain <section id="trigger-table">',
  );

  // ── 7. integrity-list section must precede both tables ───────────────────────
  // INVARIANT: when integrity rows exist the integrity list is always shown FIRST —
  // false greens get the loudest, most prominent placement.
  const integrityPos = html.indexOf('<section id="integrity-list"');
  const typePos = html.indexOf('<section id="type-table"');
  const triggerPos = html.indexOf('<section id="trigger-table"');

  assert.ok(
    integrityPos < typePos,
    "integrity-list section must appear before type-table section in the HTML — " +
      "integrity rows must always be surfaced first",
  );
  assert.ok(
    typePos < triggerPos,
    "type-table section must appear before trigger-table section in the HTML",
  );

  // ── 8. type-table section must contain the expected months and type names ─────
  // INVARIANT: all month labels and type names from the fixture must appear in the
  // type-table so the person can see where each type occurred.
  // (Exact count values are proven correct by the pure aggregation tests in AC-2;
  //  this host probe verifies the rendered structure carries the key data.)
  const typeSection = extractSection(html, "type-table");
  assert.ok(typeSection.length > 0, "type-table section must be non-empty");
  assert.ok(
    typeSection.includes("2026-07"),
    'type-table must include the "2026-07" month label (three fixture rows belong to it)',
  );
  assert.ok(
    typeSection.includes("2026-06"),
    'type-table must include the "2026-06" month label (one fixture row belongs to it)',
  );
  assert.ok(
    typeSection.includes("lifecycle definition"),
    'type-table must render "lifecycle definition" (row D1 carries this type)',
  );
  assert.ok(
    typeSection.includes("algorithm"),
    'type-table must render "algorithm" (row D2 carries this type)',
  );
  assert.ok(
    typeSection.includes("contract format/completeness"),
    'type-table must render "contract format/completeness" (row D3 carries this type)',
  );
  assert.ok(
    typeSection.includes("mis-cut slice"),
    'type-table must render "mis-cut slice" (row D4 carries this type)',
  );

  // ── 9. trigger-table must contain the four fixture triggers in canonical order ─
  // INVARIANT: the canonical catch-point order (earliest first) must always hold in
  // the rendered trigger-table. Rows are ordered by TRIGGER_ORDER; later-index
  // triggers must appear after earlier-index ones in the HTML.
  const trigSection = extractSection(html, "trigger-table");
  assert.ok(trigSection.length > 0, "trigger-table section must be non-empty");

  const p_ata = trigSection.indexOf("authoring-time audit"); // TRIGGER_ORDER[0]
  const p_gvf = trigSection.indexOf("gate-verifier failure"); // TRIGGER_ORDER[4]
  const p_jc = trigSection.indexOf("judge contradiction"); // TRIGGER_ORDER[5]
  const p_phd = trigSection.indexOf("post-hoc diagnosis"); // TRIGGER_ORDER[8]

  assert.ok(
    p_ata >= 0,
    '"authoring-time audit" must appear in the trigger-table (row D1)',
  );
  assert.ok(
    p_gvf >= 0,
    '"gate-verifier failure" must appear in the trigger-table (row D2)',
  );
  assert.ok(
    p_jc >= 0,
    '"judge contradiction" must appear in the trigger-table (row D3)',
  );
  assert.ok(
    p_phd >= 0,
    '"post-hoc diagnosis" must appear in the trigger-table (row D4)',
  );

  assert.ok(
    p_ata < p_gvf,
    '"authoring-time audit" (TRIGGER_ORDER[0]) must appear before "gate-verifier failure" ' +
      "(TRIGGER_ORDER[4]) in the trigger-table — catch-point order must be preserved in the render",
  );
  assert.ok(
    p_gvf < p_jc,
    '"gate-verifier failure" (TRIGGER_ORDER[4]) must appear before "judge contradiction" ' +
      "(TRIGGER_ORDER[5]) in the trigger-table",
  );
  assert.ok(
    p_jc < p_phd,
    '"judge contradiction" (TRIGGER_ORDER[5]) must appear before "post-hoc diagnosis" ' +
      "(TRIGGER_ORDER[8]) in the trigger-table",
  );

  // ── 10. integrity-list section must contain the integrity row's detail ─────────
  // INVARIANT: the integrity list must render the actual defect details, not just headers.
  const integritySection = extractSection(html, "integrity-list");
  assert.ok(
    integritySection.includes("D2"),
    'integrity-list must contain the detail text "D2" of the sole integrity row (ts=2026-07-02)',
  );
}
