/**
 * The space panel: loads the built map bundle and bridges its registered
 * actions to the session. Pushes the whole surface state after every act —
 * the webview holds no state of its own beyond selection.
 */
import type * as vscodeTypes from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createRequire } from "node:module";
import { TandemSession } from "./session";
import { spacePush } from "./push";
import { handleInbound } from "./inbound";
import type { InboundAction } from "./inbound";

const req: NodeRequire =
  typeof require !== "undefined" ? require : createRequire(__filename);
export function vs(): typeof vscodeTypes {
  return req("vscode") as typeof vscodeTypes;
}

export interface PanelHostHooks {
  /** Host-side gesture: the QuickPick that rebinds the space to a repo. */
  onSwitchRepo?: () => Promise<void>;
}


/** A card head is one line: a long sentence is clipped, never a paragraph. */

export class SpacePanel implements vscodeTypes.Disposable {
  private _panel: vscodeTypes.WebviewPanel | undefined;
  private _disposables: vscodeTypes.Disposable[] = [];

  constructor(
    private readonly getSession: () => TandemSession,
    private readonly hooks?: PanelHostHooks,
  ) {}

  async show(extensionUri: vscodeTypes.Uri): Promise<void> {
    const session = this.getSession();
    if (this._panel) {
      this._panel.reveal();
      this._push(session);
      return;
    }
    this._panel = vs().window.createWebviewPanel(
      "thinkubeTandemSpace",
      "Tandem",
      { viewColumn: vs().ViewColumn.One, preserveFocus: false },
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
        retainContextWhenHidden: true,
      },
    );
    this._panel.webview.html = await renderBundleHtml(
      extensionUri,
      this._panel.webview,
    );
    this._disposables.push(
      this._panel.webview.onDidReceiveMessage(async (raw) => {
        const msg = raw as InboundAction;
        const session = this.getSession();
        const run = () =>
          handleInbound(
            session,
            msg,
            (m) => this._push(this.getSession(), m),
            this.hooks,
          );
        // Industry-standard liveness: a real progress notification with a
        // working Cancel for anything that thinks longer than a beat.
        if (msg.action === "capture" || msg.action === "capture-many") {
          await vs().window.withProgress(
            {
              location: vs().ProgressLocation.Notification,
              title: "Tandem is thinking about your ask",
              cancellable: true,
            },
            async (progress, token) => {
              token.onCancellationRequested(() => session.cancelCapture());
              const tick = setInterval(() => {
                const a = session.activity;
                if (a)
                  progress.report({ message: `${a.label} (${a.current}/${a.total})` });
              }, 400);
              try {
                await run();
              } finally {
                clearInterval(tick);
              }
            },
          );
          return;
        }
        await run();
      }),
      this._panel.onDidDispose(() => {
        this._panel = undefined;
      }),
    );
    this._push(session);
  }

  /** Public so the session's onChanged hook can re-push mid-run. */
  pushFrom(session: TandemSession, message?: string): void {
    this._push(session, message);
  }

  private _push(session: TandemSession, message?: string): void {
    void this._panel?.webview.postMessage(spacePush(session, message));
  }

  dispose(): void {
    for (const d of this._disposables) d.dispose();
    this._disposables = [];
    this._panel?.dispose();
    this._panel = undefined;
  }
}

async function renderBundleHtml(
  extensionUri: vscodeTypes.Uri,
  webview: vscodeTypes.Webview,
): Promise<string> {
  const mediaRoot = vs().Uri.joinPath(extensionUri, "media", "map");
  let raw: string;
  try {
    raw = await fs.readFile(
      vs().Uri.joinPath(mediaRoot, "index.html").fsPath,
      "utf8",
    );
  } catch {
    return `<!doctype html><html><body><h2>Map bundle missing</h2><p>Run <code>npm run compile</code> at the extension root (expected ${path.join("media", "map", "index.html")}), then reopen.</p></body></html>`;
  }
  const nonce = Array.from({ length: 16 }, () =>
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".charAt(
      Math.floor(Math.random() * 62),
    ),
  ).join("");
  const rewritten = raw.replace(
    /(\s(?:src|href))="([^"]+)"/g,
    (_m, attr: string, ref: string) => {
      if (/^https?:|^data:/.test(ref)) return `${attr}="${ref}"`;
      const cleaned = ref.replace(/^\.\//, "").replace(/^\//, "");
      return `${attr}="${webview
        .asWebviewUri(vs().Uri.joinPath(mediaRoot, ...cleaned.split("/")))
        .toString()}"`;
    },
  );
  const withNonce = rewritten.replace(/<script(\s)/g, `<script nonce="${nonce}"$1`);
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${webview.cspSource}`,
  ].join("; ");
  return withNonce.replace(
    /<head>/i,
    `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
  );
}
