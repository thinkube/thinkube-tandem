import * as vscode from "vscode";
import type { Action, Section, SectionState, WorkingModel } from "../model";

/** Visual marker for each section state. */
export const STATE_MARKERS: Record<SectionState, string> = {
  empty: "○",
  proposed: "◌",
  shaping: "◑",
  settled: "●",
};

/** Messages the webview sends back to the extension. */
type WebviewMessage =
  | { type: "addNote"; sectionId: string; text: string }
  | { type: "editSection"; id: string; text: string }
  | { type: "setSectionState"; id: string; state: SectionState };

/**
 * Editable document view for the Scratchpad.
 *
 * Shows every section with its per-section state marker (○ empty / ◌ proposed /
 * ◑ shaping / ● settled) and an in-place "Add note" affordance beneath each one.
 * All user interactions post an Action back through `onAction`.
 */
export class ScratchpadDocumentView implements vscode.Disposable {
  private _panel: vscode.WebviewPanel | undefined;
  private _disposables: vscode.Disposable[] = [];

  /** Reveal or create the webview panel. */
  show(
    extensionUri: vscode.Uri,
    model: WorkingModel,
    onAction: (action: Action) => void,
  ): void {
    if (this._panel) {
      this._panel.reveal(vscode.ViewColumn.One);
      this._panel.webview.html = this._buildHtml(model);
      return;
    }

    this._panel = vscode.window.createWebviewPanel(
      "thinkubeScratchpad",
      "Thinkube Scratchpad",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
      },
    );

    this._panel.webview.html = this._buildHtml(model);

    this._panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => {
        switch (msg.type) {
          case "addNote":
            onAction({
              type: "addNote",
              sectionId: msg.sectionId,
              text: msg.text,
            });
            break;
          case "editSection":
            onAction({ type: "editSection", id: msg.id, text: msg.text });
            break;
          case "setSectionState":
            onAction({ type: "setSectionState", id: msg.id, state: msg.state });
            break;
        }
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

  /** Push an updated model into the already-open panel. */
  update(model: WorkingModel): void {
    if (this._panel) {
      this._panel.webview.html = this._buildHtml(model);
    }
  }

  dispose(): void {
    this._panel?.dispose();
    this._disposables.forEach((d) => d.dispose());
    this._disposables = [];
  }

  private _buildHtml(model: WorkingModel): string {
    const sectionsHtml = model.sections
      .map((s) => this._sectionHtml(s))
      .join("\n");

    const objectionsHtml =
      model.objections.length > 0
        ? `<section class="objections">
            <h2>Objections</h2>
            ${model.objections
              .map(
                (o) =>
                  `<div class="objection ${o.resolved ? "resolved" : "open"}">
                    ${this._esc(o.text)}${o.resolved ? ' <span class="badge">resolved</span>' : ""}
                  </div>`,
              )
              .join("\n")}
          </section>`
        : "";

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Thinkube Scratchpad</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; }
    h1 { font-size: 1.2em; margin: 0 0 16px; }
    .section { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin-bottom: 12px; padding: 12px; }
    .section-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .state-marker { font-size: 1.2em; }
    .kind-label { font-weight: bold; text-transform: capitalize; }
    .state-label { font-size: 0.8em; opacity: 0.7; }
    .section-text { white-space: pre-wrap; margin-bottom: 8px; }
    .notes { margin-left: 12px; font-size: 0.9em; opacity: 0.85; }
    .note { margin-bottom: 4px; padding-left: 8px; border-left: 2px solid var(--vscode-panel-border); }
    .add-note { display: flex; gap: 8px; margin-top: 8px; }
    .add-note input { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px 8px; border-radius: 2px; }
    .add-note button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 2px; cursor: pointer; }
    .add-note button:hover { background: var(--vscode-button-hoverBackground); }
    .objections { margin-top: 24px; }
    .objection.open { color: var(--vscode-errorForeground); }
    .badge { font-size: 0.75em; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 1px 6px; border-radius: 8px; }
    h2 { font-size: 1em; margin-bottom: 8px; }
  </style>
</head>
<body>
  <h1>Scratchpad <span style="opacity:0.5;font-size:0.8em;">${this._esc(model.phase)}</span></h1>
  ${sectionsHtml}
  ${objectionsHtml}
  <script>
    const vscode = acquireVsCodeApi();
    function addNote(sectionId) {
      const input = document.getElementById('note-input-' + sectionId);
      const text = input ? input.value.trim() : '';
      if (!text) return;
      vscode.postMessage({ type: 'addNote', sectionId, text });
      if (input) input.value = '';
    }
  </script>
</body>
</html>`;
  }

  private _sectionHtml(section: Section): string {
    const marker = STATE_MARKERS[section.state];
    const notesHtml =
      section.notes.length > 0
        ? `<div class="notes">${section.notes
            .map((n) => `<div class="note">${this._esc(n.text)}</div>`)
            .join("")}</div>`
        : "";

    return /* html */ `
<div class="section" data-id="${this._esc(section.id)}">
  <div class="section-header">
    <span class="state-marker" title="${section.state}">${marker}</span>
    <span class="kind-label">${this._esc(section.kind)}</span>
    <span class="state-label">${this._esc(section.state)}</span>
  </div>
  <div class="section-text">${this._esc(section.text)}</div>
  ${notesHtml}
  <div class="add-note">
    <input
      id="note-input-${this._esc(section.id)}"
      type="text"
      placeholder="Add a note…"
    />
    <button onclick="addNote('${this._esc(section.id)}')">Add note</button>
  </div>
</div>`;
  }

  /** Escape HTML special characters. */
  private _esc(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}
