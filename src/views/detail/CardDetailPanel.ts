/**
 * CardDetailPanel — edit a roadmap item's GitHub issue.
 *
 * Opened from a Roadmap node (Epic/Story/Spec). Shows the issue **title + body
 * as one editable form**; Save writes them back to the GitHub issue via
 * `updateIssue` (GitHub is the source of truth). A secondary "Open .thinkube
 * file" button opens the long-form sidecar (`.thinkube/<kind>s/..md`) in a real
 * editor when one exists — we don't duplicate it inline.
 *
 * Hand-rolled HTML (no React bundle) so it opens instantly. Messages mirror the
 * kanban pattern: host posts `state` on open, webview posts `save` / `refresh`
 * / `openFile`.
 */
import * as path from "node:path";
import * as vscode from "vscode";

import { IssueSummary, RepoCoords } from "../../github/GitHubService";
import { ThinkubeStore } from "../../store/ThinkubeStore";

type HostMessage =
  | {
      kind: "state";
      issue: IssueSummary & { repo: string };
      /** Relative path of the linked .thinkube sidecar, if one exists. */
      filePath: string | null;
    }
  | { kind: "saved"; reviewCount: number }
  | { kind: "error"; text: string };

type WebviewMessage =
  | { kind: "save"; title: string; body: string }
  | { kind: "openFile" }
  | { kind: "refresh" };

export interface CardDetailDeps {
  extensionUri: vscode.Uri;
  store: ThinkubeStore | undefined;
  output: vscode.OutputChannel;
  /** Re-fetch the issue from GitHub (refresh). */
  fetchIssue: (coords: RepoCoords, number: number) => Promise<IssueSummary>;
  /** Write title/body back to the GitHub issue. */
  updateIssue: (
    coords: RepoCoords,
    number: number,
    fields: { title?: string; body?: string },
  ) => Promise<IssueSummary>;
  /** Count this issue's open child items (so a parent edit can prompt review). */
  countOpenChildren?: (coords: RepoCoords, number: number) => Promise<number>;
}

export interface CardDetailTarget {
  coords: RepoCoords;
  issue: IssueSummary;
  kind: "epic" | "story" | "spec";
  parentIssueNumber?: number;
}

const ACTIVE = new Map<string, CardDetailPanel>();

export class CardDetailPanel implements vscode.Disposable {
  private readonly panel: vscode.WebviewPanel;
  private readonly deps: CardDetailDeps;
  private target: CardDetailTarget;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly key: string;

  private constructor(
    deps: CardDetailDeps,
    panel: vscode.WebviewPanel,
    target: CardDetailTarget,
    key: string,
  ) {
    this.deps = deps;
    this.panel = panel;
    this.target = target;
    this.key = key;
  }

  static async open(
    deps: CardDetailDeps,
    target: CardDetailTarget,
  ): Promise<CardDetailPanel> {
    const key = makeKey(target);
    const existing = ACTIVE.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.One);
      await existing.refresh();
      return existing;
    }
    const panel = vscode.window.createWebviewPanel(
      "thinkubeCardDetail",
      titleFor(target),
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );
    const instance = new CardDetailPanel(deps, panel, target, key);
    ACTIVE.set(key, instance);
    await instance.bootstrap();
    return instance;
  }

  dispose(): void {
    ACTIVE.delete(this.key);
    while (this.disposables.length) {
      try {
        this.disposables.pop()?.dispose();
      } catch {
        /* ignore */
      }
    }
    this.panel.dispose();
  }

  private async bootstrap(): Promise<void> {
    this.panel.webview.html = this.renderHtml();
    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((m) => this.handle(m)),
    );
    await this.pushState();
  }

  private async handle(message: WebviewMessage): Promise<void> {
    switch (message.kind) {
      case "save":
        await this.handleSave(message.title, message.body);
        break;
      case "openFile":
        await this.handleOpenFile();
        break;
      case "refresh":
        await this.refresh();
        break;
    }
  }

  /** Save the edited title/body back to the GitHub issue. */
  private async handleSave(title: string, body: string): Promise<void> {
    try {
      const updated = await this.deps.updateIssue(
        this.target.coords,
        this.target.issue.number,
        { title: title.trim() || this.target.issue.title, body },
      );
      this.target = { ...this.target, issue: updated };
      this.panel.title = titleFor(this.target);
      // A parent edit may invalidate its children — count open ones so the
      // user gets a "review these" nudge (the pair decides what to do).
      let reviewCount = 0;
      try {
        reviewCount =
          (await this.deps.countOpenChildren?.(
            this.target.coords,
            this.target.issue.number,
          )) ?? 0;
      } catch {
        reviewCount = 0;
      }
      this.post({ kind: "saved", reviewCount });
      await this.pushState();
    } catch (err) {
      const e = err as Error;
      this.deps.output.appendLine(`[card-detail] save failed: ${e.message}`);
      this.post({ kind: "error", text: `Save failed: ${e.message}` });
    }
  }

  /** Open the linked .thinkube sidecar in a real editor (if it exists). */
  private async handleOpenFile(): Promise<void> {
    if (!this.deps.store) {
      this.post({ kind: "error", text: "No workspace folder open." });
      return;
    }
    const rel = await this.deps.store.linkIssueToFile(this.target.issue.number);
    if (!rel) {
      this.post({
        kind: "error",
        text: "No .thinkube file linked to this issue.",
      });
      return;
    }
    const abs = path.join(this.deps.store.workspaceRoot, ".thinkube", rel);
    try {
      await vscode.commands.executeCommand(
        "vscode.open",
        vscode.Uri.file(abs),
        {
          viewColumn: vscode.ViewColumn.Beside,
        },
      );
    } catch (err) {
      this.post({
        kind: "error",
        text: `Open failed: ${(err as Error).message}`,
      });
    }
  }

  async refresh(): Promise<void> {
    try {
      const fresh = await this.deps.fetchIssue(
        this.target.coords,
        this.target.issue.number,
      );
      this.target = { ...this.target, issue: fresh };
      this.panel.title = titleFor(this.target);
    } catch (err) {
      this.deps.output.appendLine(
        `[card-detail] refresh failed: ${(err as Error).message}`,
      );
    }
    await this.pushState();
  }

  private async pushState(): Promise<void> {
    let filePath: string | null = null;
    if (this.deps.store) {
      filePath =
        (await this.deps.store.linkIssueToFile(this.target.issue.number)) ??
        null;
    }
    this.post({
      kind: "state",
      issue: {
        ...this.target.issue,
        repo: `${this.target.coords.owner}/${this.target.coords.name}`,
      },
      filePath,
    });
  }

  private post(message: HostMessage): void {
    this.panel.webview.postMessage(message);
  }

  private renderHtml(): string {
    const nonce = randomNonce();
    const webview = this.panel.webview;
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    return `<!doctype html>
<html><head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>Card detail</title>
<style>
    * { box-sizing: border-box; }
    body {
        margin: 0; height: 100vh; display: flex; flex-direction: column;
        font-family: var(--vscode-font-family, system-ui, sans-serif);
        font-size: var(--vscode-font-size, 13px);
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
    }
    header {
        padding: 10px 16px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
        border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.25));
    }
    header .meta { font-size: 11px; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.04em; }
    header a { color: var(--vscode-textLink-foreground); font-size: 12px; }
    main { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; padding: 12px 16px; gap: 8px; }
    label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); }
    #title {
        font-size: 15px; font-weight: 600; padding: 6px 8px;
        background: var(--vscode-input-background); color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #888)); border-radius: 4px;
    }
    #body {
        flex: 1 1 auto; min-height: 200px; resize: none; padding: 8px;
        font-family: var(--vscode-editor-font-family, ui-monospace, monospace);
        font-size: var(--vscode-editor-font-size, 13px); line-height: 1.5;
        background: var(--vscode-input-background); color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #888)); border-radius: 4px;
    }
    #title:focus, #body:focus { outline: 1px solid var(--vscode-focusBorder); }
    .actions { display: flex; align-items: center; gap: 8px; }
    button {
        font: inherit; padding: 5px 12px; border: 0; border-radius: 3px; cursor: pointer;
        background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary { background: var(--vscode-button-secondaryBackground, rgba(127,127,127,0.25)); color: var(--vscode-button-secondaryForeground, inherit); }
    button:disabled { opacity: 0.5; cursor: default; }
    .status { font-size: 11px; color: var(--vscode-descriptionForeground); margin-left: auto; }
</style>
</head>
<body>
    <header>
        <span class="meta" id="meta">Loading…</span>
        <a id="ghLink" href="#" target="_blank" rel="noopener">View on GitHub</a>
        <button class="secondary" id="refreshBtn">Refresh</button>
    </header>
    <main>
        <label for="title">Title</label>
        <input id="title" spellcheck="false" />
        <label for="body">Body (markdown) — saved to the GitHub issue</label>
        <textarea id="body" spellcheck="false"></textarea>
        <div class="actions">
            <button id="saveBtn" disabled>Save to GitHub</button>
            <button class="secondary" id="openFileBtn" hidden>Open .thinkube file</button>
            <span class="status" id="status"></span>
        </div>
    </main>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const $ = (id) => document.getElementById(id);
        let saved = { title: "", body: "" };

        function dirty() {
            return $("title").value !== saved.title || $("body").value !== saved.body;
        }
        function refreshDirty() { $("saveBtn").disabled = !dirty(); }
        function setStatus(t) {
            $("status").textContent = t || "";
            if (t) setTimeout(() => { if ($("status").textContent === t) $("status").textContent = ""; }, 3000);
        }

        $("title").addEventListener("input", refreshDirty);
        $("body").addEventListener("input", refreshDirty);
        $("refreshBtn").addEventListener("click", () => vscode.postMessage({ kind: "refresh" }));
        $("openFileBtn").addEventListener("click", () => vscode.postMessage({ kind: "openFile" }));
        $("saveBtn").addEventListener("click", () => {
            vscode.postMessage({ kind: "save", title: $("title").value, body: $("body").value });
            setStatus("Saving…");
        });

        window.addEventListener("message", (event) => {
            const msg = event.data;
            if (!msg || typeof msg !== "object") return;
            if (msg.kind === "state") {
                const i = msg.issue;
                $("meta").textContent = "#" + i.number + " · " + i.state.toUpperCase() + " · " + i.repo;
                $("ghLink").href = i.url;
                $("title").value = i.title || "";
                $("body").value = i.body || "";
                saved = { title: $("title").value, body: $("body").value };
                refreshDirty();
                $("openFileBtn").hidden = !msg.filePath;
                $("openFileBtn").textContent = msg.filePath ? ("Open " + msg.filePath) : "Open .thinkube file";
            } else if (msg.kind === "saved") {
                setStatus(
                    msg.reviewCount > 0
                        ? "✓ Saved — " + msg.reviewCount + " open child item(s) may need review"
                        : "✓ Saved to GitHub"
                );
            } else if (msg.kind === "error") {
                setStatus("Error: " + msg.text);
            }
        });
    </script>
</body></html>`;
  }
}

function titleFor(target: CardDetailTarget): string {
  const prefix =
    target.kind === "epic" ? "EP" : target.kind === "story" ? "ST" : "SP";
  return `${prefix}-${target.issue.number} · ${target.issue.title}`;
}

function makeKey(target: CardDetailTarget): string {
  return `card:${target.coords.owner}/${target.coords.name}#${target.issue.number}`;
}

function randomNonce(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 16; i++)
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
