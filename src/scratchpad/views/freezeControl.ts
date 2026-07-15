import * as vscode from "vscode";
import { freezeEnabled } from "../model";
import type { WorkingModel } from "../model";
import { uncoveredSections } from "../coverage";
import type { ApprovalToken } from "../freeze";

/** Messages the FreezeControl webview sends back to the extension. */
type FreezeControlMessage = { type: "freeze" };

/**
 * The Freeze control for the Scratchpad surface.
 *
 * Renders a Freeze button whose enablement is derived from the latest
 * readiness record (freezeEnabled) and whose data-reason attribute names the
 * FIRST failing signal:
 *   "coverage:<kind>" — a section has no checked active item (or goal is empty)
 *   "dryrun:<kind>"   — coverage is green but the dry-run found a gap
 *   ""                — enabled (no failing signal)
 *
 * On click, the webview posts a 'freeze' message; the control mints an
 * ApprovalToken (only the UI may do this — the assistant has no path to mint
 * one) and invokes the onFreeze callback so the app can call freeze().
 */
export class FreezeControl implements vscode.Disposable {
  private _panel: vscode.WebviewPanel | undefined;
  private _disposables: vscode.Disposable[] = [];

  /**
   * Reveal or create the Freeze control panel.
   *
   * @param extensionUri  The extension's URI (for CSP / local resource roots).
   * @param model         The current working model used to determine enablement.
   * @param onFreeze      Called with a freshly-minted ApprovalToken when the
   *                      human clicks Freeze.
   */
  show(
    extensionUri: vscode.Uri,
    model: WorkingModel,
    onFreeze: (approval: ApprovalToken) => void,
  ): void {
    if (this._panel) {
      this._panel.reveal(vscode.ViewColumn.Two);
      this._panel.webview.html = this._buildHtml(model);
      return;
    }

    this._panel = vscode.window.createWebviewPanel(
      "thinkubeFreezeControl",
      "Freeze",
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
      },
    );

    this._panel.webview.html = this._buildHtml(model);

    this._panel.webview.onDidReceiveMessage(
      (msg: FreezeControlMessage) => {
        if (msg.type === "freeze") {
          // Only the UI mints the approval token — the assistant has no path here.
          const approval: ApprovalToken = {
            value: `human-approval-${Math.random().toString(36).slice(2)}`,
          };
          onFreeze(approval);
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

  /**
   * Compute the data-reason string for the freeze button:
   *   "coverage:<kind>" — first uncovered section kind
   *   "dryrun:<kind>"   — coverage green but dry-run gap
   *   ""                — enabled
   */
  private _freezeReason(model: WorkingModel): string {
    if (freezeEnabled(model)) return "";
    const uncovered = uncoveredSections(model);
    if (uncovered.length > 0) {
      return `coverage:${uncovered[0]}`;
    }
    // Coverage is green; check the latest readiness record for a dry-run gap.
    const hist = model.readinessHistory;
    if (hist.length > 0) {
      const latest = hist[hist.length - 1];
      if (!latest.cleanCut) {
        return latest.gapSection
          ? `dryrun:${latest.gapSection}`
          : "dryrun:unknown";
      }
    } else {
      return "dryrun:unknown";
    }
    return "";
  }

  private _buildHtml(model: WorkingModel): string {
    const enabled = freezeEnabled(model);
    const reason = this._freezeReason(model);
    const btnDisabled = enabled ? "" : "disabled";
    const statusText = enabled
      ? "Ready to freeze"
      : "Not ready — check coverage and readiness";
    const unresolvedCount = model.objections.filter((o) => !o.resolved).length;
    const warningHtml =
      unresolvedCount > 0
        ? `<p class="warning">&#9888; ${unresolvedCount} unresolved objection${unresolvedCount === 1 ? "" : "s"} will be retained in the artifact.</p>`
        : "";

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Freeze</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; }
    h1 { font-size: 1.1em; margin: 0 0 12px; }
    .status { font-size: 0.85em; opacity: 0.7; margin-bottom: 16px; }
    .freeze-btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 20px; border-radius: 3px; cursor: pointer; font-size: 1em; }
    .freeze-btn:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
    .freeze-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .warning { color: var(--vscode-editorWarning-foreground); margin-top: 12px; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>Freeze</h1>
  <p class="status">${this._esc(statusText)}</p>
  <button
    class="freeze-btn"
    id="freeze-btn"
    data-reason="${this._esc(reason)}"
    ${btnDisabled}
    onclick="doFreeze()"
  >Freeze</button>
  ${warningHtml}
  <script>
    const vscode = acquireVsCodeApi();
    function doFreeze() {
      vscode.postMessage({ type: 'freeze' });
    }
  </script>
</body>
</html>`;
  }

  private _esc(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}
