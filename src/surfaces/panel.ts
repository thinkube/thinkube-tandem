/**
 * The space panel: loads the built map bundle and bridges its registered
 * actions to the session. Pushes the whole surface state after every act —
 * the webview holds no state of its own beyond selection.
 */
import type * as vscodeTypes from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TandemSession } from "./session";
import { spacePush } from "./push";
import { handleInbound } from "./inbound";
import type { InboundAction } from "./inbound";
export { vs } from "../core/vscodeHost";
import { vs } from "../core/vscodeHost";

export interface PanelHostHooks {
  /** Host-side gesture: the QuickPick that rebinds the space to a repo. */
  onSwitchRepo?: () => Promise<void>;
  /** Host-side gesture: open a Claude session on this repository with the
   *  question already written. Used where the run has spent what it can do
   *  and the next move is a person's, with a machine beside them. */
  onAskForHelp?: (a: { cwd: string; prompt: string }) => Promise<void>;
}

/** The surface of a webview panel that SpacePanel actually drives — small
 *  enough for a test double to implement without a real editor window. */
export interface WebviewPanelLike {
  webview: {
    html: string;
    postMessage(message: unknown): Thenable<boolean> | void;
    onDidReceiveMessage(
      listener: (e: unknown) => unknown,
    ): vscodeTypes.Disposable;
    asWebviewUri(uri: vscodeTypes.Uri): vscodeTypes.Uri;
    readonly cspSource: string;
  };
  reveal(): void;
  onDidDispose(listener: () => unknown): vscodeTypes.Disposable;
  dispose(): void;
}

/** Where a SpacePanel gets its webview panel from — the real editor by
 *  default, a fake in tests. The seam a panel never re-titles through:
 *  one call, one viewType, one title, made once per panel. */
export interface PanelHost {
  createPanel(viewType: string, title: string, options: unknown): WebviewPanelLike;
}

function defaultHost(): PanelHost {
  return {
    createPanel: (viewType, title, options) =>
      vs().window.createWebviewPanel(
        viewType,
        title,
        { viewColumn: vs().ViewColumn.One, preserveFocus: false },
        options as vscodeTypes.WebviewPanelOptions & vscodeTypes.WebviewOptions,
      ) as unknown as WebviewPanelLike,
  };
}

/** A card head is one line: a long sentence is clipped, never a paragraph. */

export class SpacePanel implements vscodeTypes.Disposable {
  private readonly key: string;
  private readonly title: string;
  /** The space this panel was built for — read-only, never reassigned. */
  get currentKey(): string {
    return this.key;
  }
  private readonly getSession: () => TandemSession;
  private readonly hooks?: PanelHostHooks;
  private readonly host: PanelHost;
  private readonly onDisposed?: () => void;
  private _disposedReported = false;
  private _panel: WebviewPanelLike | undefined;
  private _disposables: vscodeTypes.Disposable[] = [];
  private _disposeListeners: (() => void)[] = [];

  constructor(opts: {
    key: string;
    title: string;
    getSession: () => TandemSession;
    hooks?: PanelHostHooks;
    host?: PanelHost;
    /** Told once, from whichever comes first: the tab's own close, or this
     *  instance's own dispose() — so the registry can drop this space and
     *  open a fresh tab next time. Never fired twice for one panel. */
    onDisposed?: () => void;
  }) {
    this.key = opts.key;
    this.title = opts.title;
    this.getSession = opts.getSession;
    this.hooks = opts.hooks;
    this.host = opts.host ?? defaultHost();
    this.onDisposed = opts.onDisposed;
  }

  /** Fires onDisposed exactly once per instance, however it is reached. */
  private _reportDisposed(): void {
    if (this._disposedReported) return;
    this._disposedReported = true;
    this.onDisposed?.();
    for (const cb of this._disposeListeners) cb();
  }

  /** Lets a registry (SpacePanels) learn this panel was disposed without
   *  knowing about the constructor's onDisposed field — the only channel
   *  a registry has for dropping a key when its panel's tab is closed. */
  onDidDispose(cb: () => void): void {
    this._disposeListeners.push(cb);
  }

  async show(extensionUri: vscodeTypes.Uri): Promise<void> {
    const session = this.getSession();
    if (this._panel) {
      this._panel.reveal();
      this._push(session);
      return;
    }
    this._panel = this.host.createPanel(
      "thinkubeTandemSpace",
      // A panel is built for one thinking space and titled with its name
      // once, here — never re-derived, never rebound to another space.
      this.title,
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
        // The tab was closed in the running editor — nothing on disk
        // records this; only the live window knows its tabs closed.
        this._reportDisposed();
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
    this._reportDisposed();
  }
}

/** A filesystem join that never touches the real `vscode` module: the
 *  panel's HTML rendering must run the same way whether the extension
 *  Uri is a real one or a test double, so `show()` stays independent of
 *  `vscode` except where it truly needs the live editor (default host,
 *  progress notifications). */
function joinUri(base: vscodeTypes.Uri, ...segments: string[]): vscodeTypes.Uri {
  const fsPath = path.join(base.fsPath, ...segments);
  return { ...base, fsPath, path: fsPath, toString: () => fsPath } as vscodeTypes.Uri;
}

async function renderBundleHtml(
  extensionUri: vscodeTypes.Uri,
  webview: WebviewPanelLike["webview"],
): Promise<string> {
  // extensionUri may be a test double with no real filesystem path (a
  // host-agnostic show() has nothing to render against): that is the same
  // "bundle missing" case as a real extension whose media folder is absent.
  let mediaRoot: vscodeTypes.Uri | undefined;
  let raw: string;
  try {
    mediaRoot = joinUri(extensionUri, "media", "map");
    raw = await fs.readFile(joinUri(mediaRoot, "index.html").fsPath, "utf8");
  } catch {
    return `<!doctype html><html><body><h2>Map bundle missing</h2><p>Run <code>npm run build</code> in <code>webview/map</code> (expected ${path.join("media", "map", "index.html")}), then reopen.</p></body></html>`;
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
        .asWebviewUri(joinUri(mediaRoot!, ...cleaned.split("/")))
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
