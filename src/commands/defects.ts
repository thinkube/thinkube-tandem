/**
 * Defect distribution commands (thinkube.defects.*) — TEP-22/SP-1 surfacing half.
 *
 * `thinkube.defects.show` — reads every defects/*.jsonl under the active
 *   thinking space, aggregates with defectStats, and renders one singleton
 *   webview titled "Tandem Defects".  Sections in document order:
 *     1. <section id="integrity-list"> — ONLY when integrity rows exist (always first)
 *     2. <section id="type-table">
 *     3. <section id="trigger-table">
 *   A parse-error count appears when > 0.  The panel is returned so that
 *   extension-host probes can inspect its HTML directly via `panel.webview.html`.
 *
 * `thinkube.defects.add` — accepts an optional programmatic argument
 *   { activity, trigger, type?, qualifier?, impact, detail }.  When supplied,
 *   NO quick-input is shown; the row is appended immediately via
 *   `defectLog.appendDefect` with `spec: "manual"`.  When absent, quick-inputs
 *   walk the user through each attribute.
 *
 * Thinking space resolution order (for both commands):
 *   1. `deps.getThinkingSpaceDir()` — injected from the Specs-view navigator selection
 *   2. `<workspaceFolders[0]>/.thinkube` — the committable methodology dir, used in tests
 *      where the workspace IS the seeded temp thinking space
 */
import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  parseDefectLog,
  typeByMonth,
  catchPointCurve,
  integrityList,
  TRIGGER_ORDER,
  DefectRow,
} from "../services/defectStats";
import { appendDefect } from "../services/defectLog";

// ── Deps ─────────────────────────────────────────────────────────────────────

/** Dependencies injected at registration time. */
export interface DefectCommandDeps {
  /**
   * Resolve the active thinking space directory from the Specs-view navigator
   * selection (or any other context-aware source).  Returns `undefined` when
   * nothing is selected; the command falls back to `<workspaceFolders[0]>/.thinkube`.
   */
  getThinkingSpaceDir: () => string | undefined;
}

// ── Singleton webview ─────────────────────────────────────────────────────────

/** Most-recently opened defects panel — one panel at a time. */
let _panel: vscode.WebviewPanel | undefined;

// ── Registration ──────────────────────────────────────────────────────────────

export function registerDefectCommands(
  context: { subscriptions: vscode.Disposable[] },
  deps: DefectCommandDeps,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.defects.show",
      async (): Promise<string | undefined> => {
        const dir = deps.getThinkingSpaceDir() ?? fallbackThinkubeDir();
        return showDefects(dir);
      },
    ),
    vscode.commands.registerCommand(
      "thinkube.defects.add",
      async (attrs?: {
        activity: string;
        trigger: string;
        type?: string;
        qualifier?: string;
        impact: string;
        detail: string;
      }): Promise<boolean> => {
        const dir = deps.getThinkingSpaceDir() ?? fallbackThinkubeDir();
        return addDefect(attrs, dir);
      },
    ),
  );
}

// ── show ─────────────────────────────────────────────────────────────────────

async function showDefects(
  thinkingSpaceDir: string | undefined,
): Promise<string | undefined> {
  if (!thinkingSpaceDir) {
    void vscode.window.showErrorMessage(
      "No active thinking space — select one in the Thinking Spaces navigator.",
    );
    return undefined;
  }

  const { allRows, totalErrors } = readDefectRows(thinkingSpaceDir);
  const integrity = integrityList(allRows);
  const byMonth = typeByMonth(allRows);
  const curve = catchPointCurve(allRows);
  const html = buildHtml(integrity, byMonth, curve, totalErrors);

  if (_panel) {
    _panel.reveal(vscode.ViewColumn.One);
    _panel.webview.html = html;
  } else {
    _panel = vscode.window.createWebviewPanel(
      "thinkubeDefects",
      "Tandem Defects",
      { viewColumn: vscode.ViewColumn.One, preserveFocus: false },
      { enableScripts: false, retainContextWhenHidden: true },
    );
    _panel.webview.html = html;
    _panel.onDidDispose(() => {
      _panel = undefined;
    });
  }
  // Let the tab model materialize before resolving — the open "Tandem Defects"
  // tab is part of the command's observable contract, and the tab list updates
  // a tick after createWebviewPanel/reveal.
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
  // The rendered HTML is the command's return value — the testability seam that
  // lets an extension-host probe assert section structure without webview access.
  return html;
}

/** The methodology dir under the first workspace folder (`<ws>/.thinkube`) — the
 *  committable per-repo home `ThinkubeStore.thinkubeDir` reads; used when no
 *  thinking space is selected in the navigator (e.g. a bare test host). */
function fallbackThinkubeDir(): string | undefined {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return ws ? path.join(ws, ".thinkube") : undefined;
}

/** Read and parse every `defects/*.jsonl` file under the thinking space dir. */
function readDefectRows(thinkingSpaceDir: string): {
  allRows: DefectRow[];
  totalErrors: number;
} {
  const allRows: DefectRow[] = [];
  let totalErrors = 0;
  const defectsDir = path.join(thinkingSpaceDir, "defects");
  try {
    const entries = fs.readdirSync(defectsDir);
    const jsonlFiles = entries.filter((f) => f.endsWith(".jsonl")).sort();
    for (const f of jsonlFiles) {
      try {
        const text = fs.readFileSync(path.join(defectsDir, f), "utf8");
        const { rows, parseErrors } = parseDefectLog(text);
        allRows.push(...rows);
        totalErrors += parseErrors;
      } catch {
        /* skip unreadable files — fail-soft */
      }
    }
  } catch {
    /* no defects dir yet — return empty */
  }
  return { allRows, totalErrors };
}

// ── add ──────────────────────────────────────────────────────────────────────

async function addDefect(
  attrs:
    | {
        activity: string;
        trigger: string;
        type?: string;
        qualifier?: string;
        impact: string;
        detail: string;
      }
    | undefined,
  thinkingSpaceDir: string | undefined,
): Promise<boolean> {
  if (!thinkingSpaceDir) {
    void vscode.window.showErrorMessage(
      "No active thinking space — select one in the Thinking Spaces navigator.",
    );
    return false;
  }

  let resolved: {
    activity: string;
    trigger: string;
    type?: string;
    qualifier?: string;
    impact: string;
    detail: string;
  };

  if (attrs) {
    // Programmatic path — no quick-inputs
    resolved = attrs;
  } else {
    // Interactive path — prompt for each attribute
    const activity = await vscode.window.showInputBox({
      prompt: "Activity (which Tandem stage owned the defect?)",
      placeHolder:
        "e.g. spec-authoring, slicing, implementation (code), verify: gate-infra",
      ignoreFocusOut: true,
    });
    if (activity === undefined) return false;

    const trigger = await vscode.window.showQuickPick([...TRIGGER_ORDER], {
      placeHolder: "Trigger (what exposed the defect?)",
      ignoreFocusOut: true,
    });
    if (!trigger) return false;

    const impact = await vscode.window.showQuickPick(
      [
        "integrity",
        "round lost",
        "mis-routed rework",
        "prevented",
        "contained",
      ],
      { placeHolder: "Impact (cost class)", ignoreFocusOut: true },
    );
    if (!impact) return false;

    const detail = await vscode.window.showInputBox({
      prompt: "Detail (free-text evidence, clipped)",
      placeHolder: "Describe what happened",
      ignoreFocusOut: true,
    });
    if (detail === undefined) return false;

    const type = await vscode.window.showInputBox({
      prompt: "Type (optional — press Enter to skip)",
      placeHolder:
        "e.g. contract format/completeness, algorithm, lifecycle definition",
      ignoreFocusOut: true,
    });

    const qualifier = type
      ? await vscode.window.showQuickPick(
          ["missing", "incorrect", "extraneous"],
          { placeHolder: "Qualifier (optional)", ignoreFocusOut: true },
        )
      : undefined;

    resolved = {
      activity,
      trigger,
      impact,
      detail,
      type: type || undefined,
      qualifier: qualifier || undefined,
    };
  }

  return appendDefect(thinkingSpaceDir, {
    spec: "manual",
    activity: resolved.activity,
    trigger: resolved.trigger,
    type: resolved.type,
    qualifier: resolved.qualifier,
    impact: resolved.impact,
    detail: resolved.detail,
  });
}

// ── HTML builder ──────────────────────────────────────────────────────────────

function buildHtml(
  integrity: DefectRow[],
  byMonth: Map<string, Map<string, number>>,
  curve: Array<{ trigger: string; count: number }>,
  parseErrors: number,
): string {
  const parts: string[] = [];

  parts.push(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline';">
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      padding: 1em 1.5em 2em;
      max-width: 60em;
    }
    h1 { font-size: 1.4em; margin-bottom: 0.4em; }
    h2 { font-size: 1.1em; margin: 1.4em 0 0.4em; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 0.8em; }
    th, td {
      text-align: left;
      padding: 0.3em 0.6em;
      border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.35));
    }
    th { background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.15)); }
    .parse-errors {
      color: var(--vscode-editorWarning-foreground, #d29922);
      font-size: 0.9em;
      margin: 0.4em 0;
    }
    .integrity-heading {
      color: var(--vscode-testing-iconFailed, #f14c4c);
      font-weight: 600;
    }
    .empty-note { opacity: 0.65; font-style: italic; }
  </style>
</head>
<body>
<h1>Tandem Defects</h1>`);

  // Parse-error banner (shown when > 0)
  if (parseErrors > 0) {
    parts.push(
      `<p class="parse-errors">⚠ ${parseErrors} parse error${parseErrors === 1 ? "" : "s"} in defect log — malformed lines skipped</p>`,
    );
  }

  // ── integrity-list — ONLY when integrity rows exist; always comes first ──
  if (integrity.length > 0) {
    parts.push(`<section id="integrity-list">
<h2 class="integrity-heading">🔴 Integrity Violations (${integrity.length})</h2>
<table>
<tr><th>Timestamp</th><th>Spec</th><th>Trigger</th><th>Type</th><th>Detail</th></tr>`);
    for (const row of integrity) {
      parts.push(
        `<tr><td>${esc(row.ts ?? "")}</td><td>${esc(row.spec ?? "")}</td><td>${esc(row.trigger)}</td><td>${esc(row.type ?? "")}</td><td>${esc(row.detail)}</td></tr>`,
      );
    }
    parts.push(`</table>
</section>`);
  }

  // ── type-table ───────────────────────────────────────────────────────────
  parts.push(`<section id="type-table">
<h2>Defect Types by Month</h2>`);
  if (byMonth.size === 0) {
    parts.push(
      `<p class="empty-note">No typed defects yet — type is filled at fix-time.</p>`,
    );
  } else {
    // Collect all distinct types and months for the pivot table
    const allTypes = new Set<string>();
    for (const m of byMonth.values()) for (const t of m.keys()) allTypes.add(t);
    const types = [...allTypes].sort();
    const months = [...byMonth.keys()].sort();

    parts.push(`<table>
<tr><th>Month</th>${types.map((t) => `<th>${esc(t)}</th>`).join("")}</tr>`);
    for (const month of months) {
      const rowMap = byMonth.get(month)!;
      parts.push(
        `<tr><td>${esc(month)}</td>${types.map((t) => `<td>${rowMap.get(t) ?? ""}</td>`).join("")}</tr>`,
      );
    }
    parts.push(`</table>`);
  }
  parts.push(`</section>`);

  // ── trigger-table ────────────────────────────────────────────────────────
  parts.push(`<section id="trigger-table">
<h2>Catch-Point Curve</h2>`);
  if (curve.length === 0) {
    parts.push(`<p class="empty-note">No defects recorded yet.</p>`);
  } else {
    parts.push(`<table>
<tr><th>Trigger</th><th>Count</th></tr>`);
    for (const { trigger, count } of curve) {
      parts.push(`<tr><td>${esc(trigger)}</td><td>${count}</td></tr>`);
    }
    parts.push(`</table>`);
  }
  parts.push(`</section>
</body>
</html>`);

  return parts.join("\n");
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&"
      ? "&amp;"
      : c === "<"
        ? "&lt;"
        : c === ">"
          ? "&gt;"
          : c === '"'
            ? "&quot;"
            : "&#39;",
  );
}
