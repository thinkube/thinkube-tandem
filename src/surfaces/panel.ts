/**
 * A space panel: loads the built map bundle and bridges its registered
 * actions to ONE thinking space's session. Pushes the whole surface state
 * after every act — the webview holds no state of its own beyond
 * selection. Titled with its space's name; never shared with another
 * space's tab.
 */
import type * as vscodeTypes from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createRequire } from "node:module";
import { TandemSession } from "./session";
import { spacePush } from "./push";
import { handleInbound } from "./inbound";
import type { InboundAction } from "./inbound";
import type { SpaceTab } from "./panels";

const req: NodeRequire =
  typeof require !== "undefined" ? require : createRequire(__filename);
export function vs(): typeof vscodeTypes {
  return req("vscode") as typeof vscodeTypes;
}

export interface PanelHostHooks {
  /** Host-side gesture: the QuickPick that rebinds the space to a repo. */
  onSwitchRepo?: () => Promise<void>;
}

/** The seam a panel creates its webview through — the surface of
 *  `vscodeTypes.window` that panel creation actually needs, so a fake can
 *  stand in for the running VS Code window in a test. Panel creation reads
 *  only through this seam, never `vs()` directly, so a fake window never
 *  reaches for the real `vscode` module. */
export interface PanelWindow {
  createWebviewPanel(
    viewType: string,
    title: string,
    ...rest: unknown[]
  ): vscodeTypes.WebviewPanel;
}

/** A card head is one line: a long sentence is clipped, never a paragraph. */

export class SpacePanel implements SpaceTab {
  private _panel: vscodeTypes.WebviewPanel | undefined;
  private _disposables: vscodeTypes.Disposable[] = [];
  private readonly _disposedCbs: (() => void)[] = [];
  private readonly window: PanelWindow;

  /** True only when the real VS Code window was not injected — i.e. a real
   *  panel, backed by the real `vscode` module, rather than a test fake. */
  private readonly isRealWindow: boolean;

  constructor(
    readonly key: string,
    readonly title: string,
    private readonly getSession: () => TandemSession,
    private readonly hooks?: PanelHostHooks,
    window?: PanelWindow,
  ) {
    this.isRealWindow = window === undefined;
    this.window = window ?? vs().window;
  }

  async show(extensionUri: vscodeTypes.Uri): Promise<void> {
    const session = this.getSession();
    if (this._panel) {
      this._panel.reveal();
      this._push(session);
      return;
    }
    // ViewColumn.One's real enum value is 1; read via `vs()` only when a
    // real window is in play, so a fake window never touches the module.
    const viewColumn = this.isRealWindow ? vs().ViewColumn.One : 1;
    this._panel = this.window.createWebviewPanel(
      "thinkubeTandemSpace",
      this.title,
      { viewColumn, preserveFocus: false },
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
        retainContextWhenHidden: true,
      },
    );
    this._panel.webview.html = await renderBundleHtml(
      extensionUri,
      this._panel.webview,
      this.isRealWindow,
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
        for (const cb of this._disposedCbs) cb();
      }),
    );
    this._push(session);
  }

  /** Public so the session's onChanged hook can re-push mid-run. */
  pushFrom(session: TandemSession, message?: string): void {
    this._push(session, message);
  }

  reveal(): void {
    this._panel?.reveal();
  }

  push(state: unknown): void {
    void this._panel?.webview.postMessage(state);
  }

  onDisposed(cb: () => void): void {
    this._disposedCbs.push(cb);
  }

  private _push(session: TandemSession, message?: string): void {
    void this._panel?.webview.postMessage(spacePush(session, message));
  }

  dispose(): void {
    for (const d of this._disposables) d.dispose();
    this._disposables = [];
    if (this._panel) {
      // The webview's own onDidDispose listener above fires the
      // onDisposed callbacks; disposing it here reaches that same
      // listener rather than firing them a second time.
      this._panel.dispose();
      this._panel = undefined;
    } else {
      for (const cb of this._disposedCbs) cb();
    }
  }
}

async function renderBundleHtml(
  extensionUri: vscodeTypes.Uri,
  webview: vscodeTypes.Webview,
  isRealWindow: boolean,
): Promise<string> {
  // A fake window (test seam) never touches the real `vscode` module: it
  // joins paths as plain strings, which is all the "bundle missing" path
  // below ever reads. A real window joins through `vscode.Uri` so
  // `asWebviewUri` below receives a genuine URI.
  const joinPath = isRealWindow
    ? (base: vscodeTypes.Uri, ...segments: string[]) =>
        vs().Uri.joinPath(base, ...segments)
    : (base: vscodeTypes.Uri, ...segments: string[]) =>
        ({ fsPath: path.join(base.fsPath, ...segments) }) as unknown as vscodeTypes.Uri;
  const mediaRoot = joinPath(extensionUri, "media", "map");
  let raw: string;
  try {
    raw = await fs.readFile(
      joinPath(mediaRoot, "index.html").fsPath,
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
        .asWebviewUri(joinPath(mediaRoot, ...cleaned.split("/")))
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
