import type * as vscode from "vscode";
// Lazy runtime handle (attend 2026-07-15): buildScratchpadHtml must be importable
// from a plain node test; only the panel class touches the live vscode API.
function vs(): typeof vscode {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("vscode") as typeof vscode;
}
import type {
  Item,
  Modality,
  Section,
  SectionKind,
  SectionState,
  WorkingModel,
} from "../model";
import { freezeEnabled } from "../model";

/**
 * The complete inbound message protocol (webview → extension).
 * Every authoring control posts exactly one of these; the session applies
 * each through the one reducer with actor:"human".
 *
 * askStructure is REMOVED. The delta-log feed is REMOVED.
 */
export type ScratchpadInboundMessage =
  | { type: "seedGoal"; text: string }
  | { type: "editGoal"; text: string }
  | { type: "addItem"; sectionId: string; text: string }
  | { type: "toggleItem"; itemId: string; checked: boolean }
  | { type: "editItemText"; itemId: string; text: string }
  | { type: "setModality"; itemId: string; modality: Modality }
  | {
      type: "setEval";
      itemId: string;
      facet: "complexity" | "risk";
      value: 1 | 2 | 3;
    }
  | { type: "deferItem"; itemId: string }
  | { type: "dropItem"; itemId: string }
  | { type: "supersedeItem"; itemId: string; supersedes: string }
  | { type: "resolveEdit"; itemId: string; accept: boolean }
  | { type: "addItemNote"; itemId: string; text: string }
  | { type: "prefill" }
  | { type: "reframe" }
  | { type: "research"; itemId?: string; subject?: string }
  | { type: "checkReadiness" }
  | { type: "freeze" }
  | { type: "command"; utterance: string };

/** Visual marker for each section state. */
export const STATE_MARKERS: Record<SectionState, string> = {
  empty: "○",
  proposed: "◌",
  shaping: "◑",
  settled: "●",
};

/**
 * Per-section activity state for rendering.
 * "running" — a worker round targeting this section is in flight.
 * "landed"  — the most recent round completed successfully.
 * "failed"  — the most recent round errored.
 */
export type SectionActivity = "running" | "landed" | "failed";

/**
 * Round-level activity: which sections are targeted and what error (if any).
 */
export interface RoundActivity {
  /** Section kinds targeted by the in-flight or just-completed round. */
  targetedKinds: SectionKind[];
  /** Per-kind error messages (present when activity is "failed"). */
  errors: Partial<Record<SectionKind, string>>;
  /** Overall state for all targeted sections. */
  state: SectionActivity;
}

/** Escape HTML special characters. */
function esc(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Render one Item as an <li> with the contract's exact selectors. */
function itemHtml(item: Item): string {
  const liAttrs: string[] = [
    `class="item"`,
    `data-item-id="${esc(item.id)}"`,
    `data-state="${esc(item.state)}"`,
    `data-origin="${esc(item.origin)}"`,
  ];
  if (item.shippedIn !== undefined) {
    liAttrs.push(`data-shipped-in="${esc(item.shippedIn)}"`);
  }
  if (item.supersedes !== undefined) {
    liAttrs.push(`data-supersedes="${esc(item.supersedes)}"`);
  }
  if (item.supersededBy !== undefined) {
    liAttrs.push(`data-superseded-by="${esc(item.supersededBy)}"`);
  }

  const checkedAttr = item.checked ? " checked" : "";

  // Evals span — only emit data-complexity / data-risk when defined
  const evalsAttrs: string[] = [`class="evals"`];
  if (item.evals.complexity !== undefined) {
    evalsAttrs.push(`data-complexity="${item.evals.complexity}"`);
  }
  if (item.evals.risk !== undefined) {
    evalsAttrs.push(`data-risk="${item.evals.risk}"`);
  }
  const evalsSpan = `<span ${evalsAttrs.join(" ")}></span>`;

  // Pending-edit span
  const pendingEditSpan = item.pendingEdit
    ? `<span class="pending-edit"><del>${esc(item.pendingEdit.oldText)}</del><ins>${esc(item.pendingEdit.newText)}</ins></span>`
    : "";

  // Evidence chips (zero or more)
  const evidenceChips = item.evidence
    .map((ev) => {
      const chipAttrs: string[] = [
        `class="evidence-chip"`,
        `data-method="${esc(ev.method)}"`,
        `data-checked-at="${esc(ev.checkedAt)}"`,
      ];
      if (ev.dossierRef !== undefined) {
        chipAttrs.push(`data-dossier-ref="${esc(ev.dossierRef)}"`);
      }
      return `<span ${chipAttrs.join(" ")}>${esc(ev.source)}</span>`;
    })
    .join("");

  return (
    `<li ${liAttrs.join(" ")}>` +
    `<input type="checkbox" class="item-check"${checkedAttr}>` +
    `<span class="modality" data-modality="${esc(item.modality)}">${esc(item.modality)}</span>` +
    evalsSpan +
    `<span class="item-text">${esc(item.text)}</span>` +
    pendingEditSpan +
    evidenceChips +
    `</li>`
  );
}

/** Render the goal (intent) section — contains EXACTLY ONE #goal-input. */
function goalSectionHtml(
  section: Section,
  activity?: SectionActivity,
  errorMsg?: string,
  roundInFlight?: boolean,
): string {
  const marker = STATE_MARKERS[section.state];
  const goalWasEmpty = section.text === "";
  const activityAttr =
    activity !== undefined ? ` data-activity="${activity}"` : "";
  const activityClass = activity !== undefined ? ` activity-${activity}` : "";
  const errorHtml =
    errorMsg !== undefined
      ? `<div class="round-error">${esc(errorMsg)}</div>`
      : "";
  const prefillDisabled = roundInFlight ? " disabled" : "";

  return /* html */ `
<section class="section goal-section${activityClass}" data-kind="goal" data-id="${esc(section.id)}"${activityAttr}>
  <div class="section-header">
    <span class="state-marker" title="${esc(section.state)}">${marker}</span>
    <span class="kind-label">goal</span>
    <span class="state-label">${esc(section.state)}</span>
    <button id="prefill-btn" class="worker-btn"${prefillDisabled} onclick="triggerPrefill()">Prefill</button>
    <button id="reframe-btn" class="worker-btn"${prefillDisabled} onclick="triggerReframe()">Reframe</button>
  </div>
  <textarea id="goal-input">${esc(section.text)}</textarea>
  <button onclick="confirmGoal(${JSON.stringify(goalWasEmpty)})">Confirm goal</button>
  ${errorHtml}
</section>`;
}

/** Render a non-goal section as a checklist with add-item controls. */
function checklistSectionHtml(
  section: Section,
  activity?: SectionActivity,
  errorMsg?: string,
): string {
  const marker = STATE_MARKERS[section.state];
  // Dropped items are not rendered; all other states show
  const visibleItems = section.items.filter((it) => it.state !== "dropped");
  const itemsHtml =
    visibleItems.length > 0
      ? `<ul class="item-list">${visibleItems.map(itemHtml).join("")}</ul>`
      : `<ul class="item-list"></ul>`;

  const activityAttr =
    activity !== undefined ? ` data-activity="${activity}"` : "";
  const activityClass = activity !== undefined ? ` activity-${activity}` : "";
  const errorHtml =
    errorMsg !== undefined
      ? `<div class="round-error">${esc(errorMsg)}</div>`
      : "";

  return /* html */ `
<section class="section${activityClass}" data-kind="${esc(section.kind)}" data-id="${esc(section.id)}"${activityAttr}>
  <div class="section-header">
    <span class="state-marker" title="${esc(section.state)}">${marker}</span>
    <span class="kind-label">${esc(section.kind)}</span>
    <span class="state-label">${esc(section.state)}</span>
  </div>
  ${itemsHtml}
  ${errorHtml}
  <div class="add-item-area">
    <input type="text" class="add-item-input" data-section-id="${esc(section.id)}" placeholder="Add item…">
    <button class="add-item-btn" onclick="addItemToSection('${esc(section.id)}')">Add</button>
  </div>
</section>`;
}

/**
 * Build the full Thinking Space HTML from the current working model.
 *
 * Exported so that ScratchpadSession.renderedHtml() returns the exact same
 * string the webview receives.
 *
 * Guarantees:
 *  - Exactly ONE element with id="goal-input".
 *  - Non-goal sections render item checklists with the contract's selectors.
 *  - No delta-log feed.
 *  - No ask-structure button.
 *  - Per-section data-activity states when roundActivity is provided.
 *  - Round errors render inside the targeted section as <div class="round-error">.
 *  - The prefill/reframe buttons carry disabled when a round is in flight.
 */
export function buildScratchpadHtml(
  model: WorkingModel,
  _deltas?: unknown[],
  roundActivity?: RoundActivity,
): string {
  const goalSec = model.sections.find((s) => s.kind === "goal");
  const nonGoalSections = model.sections.filter((s) => s.kind !== "goal");

  // Determine per-section activity and errors from roundActivity
  function sectionActivity(kind: SectionKind): SectionActivity | undefined {
    if (!roundActivity) return undefined;
    if (!roundActivity.targetedKinds.includes(kind)) return undefined;
    return roundActivity.state;
  }
  function sectionError(kind: SectionKind): string | undefined {
    if (!roundActivity) return undefined;
    if (roundActivity.state !== "failed") return undefined;
    return roundActivity.errors[kind];
  }

  // A round is in flight when roundActivity.state === "running"
  const roundInFlight = roundActivity?.state === "running";

  const goalHtml = goalSec
    ? goalSectionHtml(
        goalSec,
        sectionActivity("goal"),
        sectionError("goal"),
        roundInFlight,
      )
    : "";
  const sectionsHtml = nonGoalSections
    .map((s) =>
      checklistSectionHtml(s, sectionActivity(s.kind), sectionError(s.kind)),
    )
    .join("\n");

  const objectionsHtml =
    model.objections.length > 0
      ? `<section class="objections">
          <h2>Objections</h2>
          ${model.objections
            .map(
              (o) =>
                `<div class="objection ${o.resolved ? "resolved" : "open"}">
                  ${esc(o.text)}${o.resolved ? ' <span class="badge">resolved</span>' : ""}
                </div>`,
            )
            .join("\n")}
        </section>`
      : "";

  // Freeze control: disabled attribute PRESENT when freezeEnabled is false
  const canFreeze = freezeEnabled(model);
  const freezeBtn = canFreeze
    ? `<button id="freeze" onclick="triggerFreeze()">Freeze</button>`
    : `<button id="freeze" disabled onclick="triggerFreeze()">Freeze</button>`;

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Thinkube Thinking Space</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; }
    h1 { font-size: 1.2em; margin: 0 0 16px; }
    h2 { font-size: 1em; margin-bottom: 8px; }
    .section { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin-bottom: 12px; padding: 12px; }
    .goal-section { margin-bottom: 16px; }
    .section-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .state-marker { font-size: 1.2em; }
    .kind-label { font-weight: bold; text-transform: capitalize; }
    .state-label { font-size: 0.8em; opacity: 0.7; }
    /* Per-section activity states (class-based to avoid literal attribute strings in CSS) */
    .section.activity-running { border-color: var(--vscode-progressBar-background, #007acc); opacity: 0.85; }
    .section.activity-landed { border-color: var(--vscode-terminal-ansiGreen, #4caf50); }
    .section.activity-failed { border-color: var(--vscode-errorForeground, #f44336); }
    /* Round error block inside the section */
    .round-error { margin-top: 8px; padding: 6px 10px; border-radius: 3px; background: var(--vscode-inputValidation-errorBackground, rgba(244,67,54,0.1)); color: var(--vscode-errorForeground); font-size: 0.85em; }
    /* Worker round buttons */
    .worker-btn { font-size: 0.8em; padding: 2px 8px; border: 1px solid var(--vscode-button-border, var(--vscode-panel-border)); background: var(--vscode-button-secondaryBackground, transparent); color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); border-radius: 2px; cursor: pointer; }
    .worker-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    #goal-input { width: 100%; min-height: 60px; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px 8px; border-radius: 2px; resize: vertical; }
    .goal-section > button:not(.worker-btn) { margin-top: 8px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 2px; cursor: pointer; }
    .item-list { list-style: none; margin: 0; padding: 0; }
    .item { display: flex; align-items: flex-start; gap: 6px; padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border); flex-wrap: wrap; }
    .item:last-child { border-bottom: none; }
    .item-check { margin-top: 2px; flex-shrink: 0; }
    .modality { font-size: 0.75em; padding: 1px 5px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); flex-shrink: 0; }
    .evals { font-size: 0.75em; opacity: 0.7; flex-shrink: 0; }
    .item-text { flex: 1; }
    .pending-edit { font-size: 0.85em; width: 100%; margin-left: 18px; }
    .pending-edit del { color: var(--vscode-errorForeground); text-decoration: line-through; }
    .pending-edit ins { color: var(--vscode-terminal-ansiGreen, green); text-decoration: none; }
    .evidence-chip { font-size: 0.75em; padding: 1px 4px; border-radius: 3px; border: 1px solid var(--vscode-panel-border); opacity: 0.8; }
    .add-item-area { display: flex; gap: 8px; margin-top: 8px; }
    .add-item-input { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px 8px; border-radius: 2px; }
    .add-item-btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 2px; cursor: pointer; }
    .objections { margin-top: 24px; }
    .objection.open { color: var(--vscode-errorForeground); }
    .badge { font-size: 0.75em; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 1px 6px; border-radius: 8px; }
    .freeze-control { margin-top: 24px; padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
    #freeze { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 16px; border-radius: 2px; cursor: pointer; }
    #freeze:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
    #freeze:disabled { opacity: 0.5; cursor: not-allowed; }
  </style>
</head>
<body>
  <h1>Thinking Space <span style="opacity:0.5;font-size:0.8em;">${esc(model.phase)}</span></h1>
  ${goalHtml}
  ${sectionsHtml}
  ${objectionsHtml}
  <section class="freeze-control">
    <h2>Freeze</h2>
    ${freezeBtn}
  </section>
  <script>
    const vscode = acquireVsCodeApi();

    function confirmGoal(wasEmpty) {
      const textarea = document.getElementById('goal-input');
      const text = textarea ? textarea.value.trim() : '';
      if (!text) return;
      vscode.postMessage({ type: wasEmpty ? 'seedGoal' : 'editGoal', text });
    }

    function addItemToSection(sectionId) {
      const input = document.querySelector('.add-item-input[data-section-id="' + sectionId + '"]');
      const text = input ? input.value.trim() : '';
      if (!text) return;
      vscode.postMessage({ type: 'addItem', sectionId, text });
      if (input) input.value = '';
    }

    function triggerFreeze() {
      vscode.postMessage({ type: 'freeze' });
    }

    function triggerPrefill() {
      vscode.postMessage({ type: 'prefill' });
    }

    function triggerReframe() {
      vscode.postMessage({ type: 'reframe' });
    }

    // Checkbox toggle handler
    document.addEventListener('change', function(e) {
      var target = e.target;
      if (target && target.classList && target.classList.contains('item-check')) {
        var li = target.closest('li.item');
        if (li) {
          var itemId = li.getAttribute('data-item-id');
          if (itemId) {
            vscode.postMessage({ type: 'toggleItem', itemId: itemId, checked: target.checked });
          }
        }
      }
    });
  </script>
</body>
</html>`;
}

/**
 * Editable document view for the Thinking Space.
 *
 * Non-goal sections render as item checklists. The goal section contains the
 * intent textarea (#goal-input, exactly one). No delta log.
 */
export class ScratchpadDocumentView implements vscode.Disposable {
  private _panel: vscode.WebviewPanel | undefined;
  private _disposables: vscode.Disposable[] = [];

  /**
   * Reveal or create the webview panel.
   *
   * @param extensionUri  Extension URI for resource roots.
   * @param model         The current working model.
   * @param onMessage     Handler for inbound webview messages.
   */
  show(
    extensionUri: vscode.Uri,
    model: WorkingModel,
    onMessage: (msg: ScratchpadInboundMessage) => void | Promise<void>,
  ): void {
    if (this._panel) {
      this._panel.reveal(vs().ViewColumn.One);
      this._panel.webview.html = buildScratchpadHtml(model);
      return;
    }

    this._panel = vs().window.createWebviewPanel(
      "thinkubeScratchpad",
      "Thinkube Scratchpad",
      vs().ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
      },
    );

    this._panel.webview.html = buildScratchpadHtml(model);

    this._panel.webview.onDidReceiveMessage(
      (msg: ScratchpadInboundMessage) => {
        void onMessage(msg);
      },
      undefined,
      this._disposables,
    );

    this._panel.onDidDispose(
      () => {
        this._panel = undefined;
        this._disposables.forEach((d) => d.dispose());
        this._disposables = [];
      },
      undefined,
      this._disposables,
    );
  }

  /**
   * Push an updated model into the already-open panel, with optional
   * round-activity overlay (running/landed/failed + per-section errors).
   */
  update(model: WorkingModel, roundActivity?: RoundActivity): void {
    if (this._panel) {
      this._panel.webview.html = buildScratchpadHtml(
        model,
        undefined,
        roundActivity,
      );
    }
  }

  dispose(): void {
    this._panel?.dispose();
    this._disposables.forEach((d) => d.dispose());
    this._disposables = [];
  }
}
