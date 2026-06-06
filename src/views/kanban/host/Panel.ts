/**
 * Kanban WebviewPanel host.
 *
 * Owns the panel lifecycle, the CSP and asset wiring for the bundled React
 * app at `media/kanban/`, and the message bridge between the webview and a
 * `StorageAdapter`. The adapter is injected so the same panel works for the
 * chunk-5 in-memory demo, the chunk-7 GitHub Projects backing, and any
 * future adapter.
 *
 * Asset model: `vite build` writes a single JS + CSS pair into
 * `media/kanban/assets/`. We slurp the built `index.html` to discover the
 * exact filenames (hashed or not), rewrite each asset path through
 * `webview.asWebviewUri`, and inject our CSP + nonce. This keeps us decoupled
 * from whatever hashing config Vite picks up.
 *
 * Singleton-by-key: opening the kanban twice surfaces the existing panel
 * rather than spinning up a second webview. Keys are derived from the
 * adapter's `scope` so two different adapters can coexist.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

import { StorageAdapter } from "./StorageAdapter";
import { HostMessage, ModeFlag, WebviewMessage } from "./types";

interface PanelDeps {
  extensionUri: vscode.Uri;
  adapter: StorageAdapter;
  output?: vscode.OutputChannel;
  /** Open the full detail view for an issue (e.g. its GitHub page). */
  openDetail?: (id: string) => void | Promise<void>;
  /**
   * "New Spec" header button: open a Claude session with `/spec-prepare <n>`
   * prefilled. Absent on adapters with no backing repo (the demo board).
   */
  onCreateSpec?: () => void | Promise<void>;
  /**
   * Acceptance card's "Accept Spec" button (TEP-0010): run the acceptance gate,
   * stamp `accepted:`, and merge the Spec's single PR. Throws (with a reason) on
   * a gate refusal or merge failure. Absent on adapters with no backing repo.
   */
  onAcceptSpec?: (spec: string) => void | Promise<void>;
}

const ACTIVE_PANELS = new Map<string, KanbanPanel>();

export class KanbanPanel implements vscode.Disposable {
  private readonly panel: vscode.WebviewPanel;
  private readonly adapter: StorageAdapter;
  private readonly extensionUri: vscode.Uri;
  private readonly output: vscode.OutputChannel | undefined;
  private readonly openDetail:
    | ((id: string) => void | Promise<void>)
    | undefined;
  private readonly onCreateSpec: (() => void | Promise<void>) | undefined;
  private readonly onAcceptSpec:
    | ((spec: string) => void | Promise<void>)
    | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly key: string;

  private constructor(
    deps: PanelDeps,
    panel: vscode.WebviewPanel,
    key: string,
  ) {
    this.panel = panel;
    this.adapter = deps.adapter;
    this.extensionUri = deps.extensionUri;
    this.output = deps.output;
    this.openDetail = deps.openDetail;
    this.onCreateSpec = deps.onCreateSpec;
    this.onAcceptSpec = deps.onAcceptSpec;
    this.key = key;
  }

  /**
   * Reveal an existing panel for the same adapter scope, or create one.
   * The returned panel is already wired and rendering.
   */
  static async open(deps: PanelDeps): Promise<KanbanPanel> {
    const key = `kanban:${deps.adapter.scope}`;
    const existing = ACTIVE_PANELS.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.One);
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      "thinkubeKanban",
      `Kanban — ${deps.adapter.scope}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(deps.extensionUri, "media", "kanban"),
        ],
      },
    );

    const instance = new KanbanPanel(deps, panel, key);
    ACTIVE_PANELS.set(key, instance);
    await instance.bootstrap();
    return instance;
  }

  dispose(): void {
    ACTIVE_PANELS.delete(this.key);
    while (this.disposables.length) {
      const d = this.disposables.pop();
      try {
        d?.dispose();
      } catch {
        /* ignore */
      }
    }
    this.panel.dispose();
  }

  private async bootstrap(): Promise<void> {
    this.panel.webview.html = await this.renderHtml();
    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((m) => this.handle(m)),
    );
    if (this.adapter.onExternalChange) {
      this.disposables.push(
        this.adapter.onExternalChange((board) =>
          this.post({
            kind: "external-change",
            board,
            mode: readMode(),
          }),
        ),
      );
    }
    // Re-push the state when the mode setting flips so the webview's badge
    // updates without a manual reload.
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration("thinkube.kanban.mode")) {
          try {
            const board = await this.adapter.load();
            this.post({ kind: "state", board, mode: readMode() });
          } catch (err) {
            this.log(`mode-change reload failed: ${(err as Error).message}`);
          }
        }
      }),
    );
  }

  private async handle(message: WebviewMessage): Promise<void> {
    switch (message.kind) {
      case "load": {
        const board = await this.adapter.load();
        this.post({ kind: "state", board, mode: readMode() });
        break;
      }
      case "save":
        await this.adapter.save(message.board);
        break;
      case "update-task": {
        if (!this.adapter.updateIssue) {
          this.notify("warn", "This board doesn't support editing.");
          break;
        }
        try {
          await this.adapter.updateIssue(message.id, {
            title: message.title,
            body: message.body,
          });
          // Reflect the edit: reload from the backing store and re-render.
          const board = await this.adapter.load();
          this.post({ kind: "state", board, mode: readMode() });
        } catch (err) {
          this.log(
            `update-task #${message.id} failed: ${(err as Error).message}`,
          );
          this.notify(
            "error",
            `Couldn't update #${message.id}: ${(err as Error).message}`,
          );
        }
        break;
      }
      case "set-due": {
        if (!this.adapter.setDueDate) {
          this.notify("warn", "This board doesn't support due dates.");
          break;
        }
        try {
          await this.adapter.setDueDate(message.id, message.date);
          const board = await this.adapter.load();
          this.post({ kind: "state", board, mode: readMode() });
        } catch (err) {
          this.log(`set-due #${message.id} failed: ${(err as Error).message}`);
          this.notify(
            "error",
            `Couldn't set due date: ${(err as Error).message}`,
          );
        }
        break;
      }
      case "open-detail":
        try {
          await this.openDetail?.(message.id);
        } catch (err) {
          this.log(
            `open-detail #${message.id} failed: ${(err as Error).message}`,
          );
        }
        break;
      case "open-external":
        // Commit/PR provenance links. Guard to http(s) so a crafted card body
        // can never drive the host to open a file:// or command: URI.
        if (/^https?:\/\//i.test(message.url)) {
          await vscode.env.openExternal(vscode.Uri.parse(message.url));
        } else {
          this.log(`open-external refused non-http(s) url: ${message.url}`);
        }
        break;
      case "create-spec":
        if (!this.onCreateSpec) {
          this.notify("info", "New Spec isn't available on this board.");
          break;
        }
        try {
          await this.onCreateSpec();
        } catch (err) {
          this.notify(
            "error",
            `Couldn't start the new spec: ${(err as Error).message}`,
          );
        }
        break;
      case "accept-spec": {
        if (!this.onAcceptSpec) {
          this.notify(
            "info",
            "Accepting a Spec isn't available on this board.",
          );
          break;
        }
        try {
          await this.onAcceptSpec(message.spec);
          // Reflect the accept: the Spec doc now carries `accepted:`, so the
          // acceptance card derives into Done on reload.
          const board = await this.adapter.load();
          this.post({ kind: "state", board, mode: readMode() });
        } catch (err) {
          this.log(
            `accept-spec SP-${message.spec} failed: ${(err as Error).message}`,
          );
          this.notify(
            "error",
            `Couldn't accept SP-${message.spec}: ${(err as Error).message}`,
          );
        }
        break;
      }
      case "notify":
        this.notify(message.level, message.text);
        break;
      default:
        this.log(`unknown message: ${(message as { kind?: string }).kind}`);
    }
  }

  private post(message: HostMessage): void {
    this.panel.webview.postMessage(message);
  }

  private notify(level: "info" | "warn" | "error", text: string): void {
    if (level === "warn") vscode.window.showWarningMessage(text);
    else if (level === "error") vscode.window.showErrorMessage(text);
    else vscode.window.showInformationMessage(text);
  }

  private log(line: string): void {
    this.output?.appendLine(`[kanban-panel] ${line}`);
  }

  /**
   * Read the built index.html from media/kanban/, rewrite asset paths
   * through `webview.asWebviewUri`, and inject a nonce + CSP. Falls back
   * to a helpful "run npm run compile" message if the build hasn't run.
   */
  private async renderHtml(): Promise<string> {
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, "media", "kanban");
    const indexHtmlPath = vscode.Uri.joinPath(mediaRoot, "index.html").fsPath;
    let raw: string;
    try {
      raw = await fs.readFile(indexHtmlPath, "utf8");
    } catch {
      return this.renderBuildMissingHtml();
    }

    const nonce = randomNonce();
    const webview = this.panel.webview;

    // Rewrite every `src="./assets/..."` or `href="./assets/..."` to a
    // webview-safe URI. We don't try to parse the HTML — a regex over
    // attribute pairs is sufficient for Vite's output shape.
    const rewritten = raw.replace(
      /(\s(?:src|href))="([^"]+)"/g,
      (_match, attr: string, ref: string) => {
        if (/^https?:|^data:/.test(ref)) return `${attr}="${ref}"`;
        const cleaned = ref.replace(/^\.\//, "").replace(/^\//, "");
        const assetUri = webview.asWebviewUri(
          vscode.Uri.joinPath(mediaRoot, ...cleaned.split("/")),
        );
        return `${attr}="${assetUri.toString()}"`;
      },
    );

    // Inject nonce on all <script> tags so our CSP can allow them.
    const withNonce = rewritten.replace(
      /<script(\s)/g,
      `<script nonce="${nonce}"$1`,
    );

    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
    ].join("; ");

    if (/<meta http-equiv="Content-Security-Policy"/i.test(withNonce)) {
      return withNonce;
    }
    return withNonce.replace(
      /<head>/i,
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
    );
  }

  private renderBuildMissingHtml(): string {
    const expected = path.join("media", "kanban", "index.html");
    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Kanban</title>
<style>
    body { font-family: var(--vscode-font-family, sans-serif); padding: 24px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    code { background: rgba(127,127,127,0.18); padding: 2px 6px; border-radius: 3px; }
</style></head>
<body>
    <h2>Kanban bundle missing</h2>
    <p>The Thinkube kanban webview hasn't been built yet. Expected:</p>
    <p><code>${expected}</code></p>
    <p>Run <code>npm run compile</code> at the extension root, then reopen.</p>
</body></html>`;
    return html;
  }
}

function readMode(): ModeFlag {
  const raw = vscode.workspace
    .getConfiguration("thinkube.kanban")
    .get<string>("mode", "both");
  if (raw === "navigator" || raw === "driver") return raw;
  return "both";
}

function randomNonce(): string {
  // 16 random chars from [A-Za-z0-9] — enough entropy for a CSP nonce.
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
