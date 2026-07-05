// The reusable, kind-agnostic review webview (SP-6/3, TEP-6 mechanism 2).
//
// This is the mint surface of the human-approval gate: a `createWebviewPanel` that renders the
// reviewed document itself via markdown-it — NOT the built-in `markdown.showPreview`, which
// cannot host a first-class Approve button — and file-watches the document so the panel
// live-updates as the agent iterates (`write_spec` / `patch_spec_section`). The on-disk file is
// the single source of truth.
//
// The **Approve** button is the UI action only the maintainer can take: the webview posts to
// this host class, which mints `mintApproval(subjectKey, approvalContentHash(current body),
// Date.now(), loadOrCreateApprovalSecret(deps.storageDir))` and delivers it via
// `createApprovalStore(deps.storageDir).put(subjectKey, token)` — the side-channel the gate
// (`create_slice` / spec→Ready in the MCP server, pointed at the same directory as
// `THINKUBE_APPROVAL_DIR`) reads back. The token never appears in a tool call and the agent
// never handles it.
//
// Content-binding drives the panel's state machine: every render recomputes
// `approvalContentHash` of the current body and re-verifies the stored token against it, so the
// moment the document is edited a prior approval stops verifying and the panel re-arms Approve
// ("changed since approval — re-approve"). Time is not a factor: a content-matching approval stays
// "approved" however long the human took — only an edit (via the file watcher) re-arms Approve.
//
// Kind-agnostic: the panel knows only `subjectKey` (e.g. `spec:TEP-6/SP-3` or `tep:TEP-6`) and a
// document path. The kind prefix is used solely to label the button ("Approve spec"), which the
// spec requires to be named distinctly from the end-of-lifecycle `accept_spec` (merge-to-main)
// gate — the caption below the button spells that distinction out.
import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  approvalContentHash,
  loadOrCreateApprovalSecret,
  mintApproval,
  verifyApproval,
} from "../../services/approvalToken";
import { createApprovalStore } from "../../services/approvalStore";

// markdown-it ships no bundled types; load it untyped (the extension is CommonJS) — same
// convention as `commands/orchestrate.ts`. `html: false` so raw HTML in the reviewed document is
// escaped rather than injected into the webview.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const MarkdownIt = require("markdown-it") as new (o?: {
  html?: boolean;
  linkify?: boolean;
  breaks?: boolean;
}) => { render(s: string): string };
const md = new MarkdownIt({ html: false, linkify: true });

export interface ReviewPanelDeps {
  /**
   * Where the approval secret + store live — the host's globalStorage path, the same directory
   * the MCP server sees as `THINKUBE_APPROVAL_DIR`. This shared directory is how a token minted
   * here becomes visible to the gate in the detached server process.
   */
  storageDir: string;
}

/** Where the panel stands relative to the store's token for the current document content. */
type ApprovalState =
  | "approved" // stored token verifies for the current content hash
  | "changed" // a token exists but no longer verifies for the current body — re-approve
  | "unapproved" // no token in the store for this subject yet
  | "missing-doc"; // the document is not on disk (nothing to approve)

/** How long after an fs event we wait before re-reading — coalesces write bursts. */
const WATCH_DEBOUNCE_MS = 150;

export class ReviewPanel {
  /** One live panel per subject — re-`open` reveals and refreshes instead of duplicating. */
  private static readonly panels = new Map<string, ReviewPanel>();

  /**
   * Open (or reveal) the review panel for `subjectKey`, rendering `docPath`.
   *
   * Called by the host bridge when the MCP server's `open_review({kind, id})` tool asks for a
   * review surface (the detached server has no `vscode` API). `subjectKey` is the
   * kind-namespaced subject the gate will check (`${kind}:${id}`).
   */
  static open(
    subjectKey: string,
    docPath: string,
    deps: ReviewPanelDeps,
  ): void {
    const existing = ReviewPanel.panels.get(subjectKey);
    if (existing) {
      existing.panel.reveal();
      existing.refresh();
      return;
    }
    ReviewPanel.panels.set(
      subjectKey,
      new ReviewPanel(subjectKey, docPath, deps),
    );
  }

  private readonly panel: vscode.WebviewPanel;
  private watcher: fs.FSWatcher | undefined;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  private constructor(
    private readonly subjectKey: string,
    private readonly docPath: string,
    private readonly deps: ReviewPanelDeps,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "thinkubeReview",
      `Review · ${subjectKey}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.webview.html = this.skeletonHtml();
    this.panel.webview.onDidReceiveMessage((m: unknown) => {
      const msg = m as { type?: string } | undefined;
      // 'ready' — the webview script is loaded; messages posted earlier could have been
      // dropped, so the first authoritative render happens here.
      if (msg?.type === "ready") this.refresh();
      if (msg?.type === "approve") this.approve();
    });
    this.panel.onDidDispose(() => this.dispose());
    this.startWatching();
    this.refresh();
  }

  // ── Approve ────────────────────────────────────────────────────────────────────────────────

  /**
   * The maintainer clicked Approve: mint for the *current* on-disk body and deliver through the
   * store's `put`. The body is re-read at click time so the token is bound to exactly what the
   * gate will hash — the panel then re-renders, and if the read body differs from what the human
   * was looking at, the refreshed view shows the newer content (still un-approved for any
   * further edits, by construction of the content hash).
   */
  private approve(): void {
    try {
      const body = fs.readFileSync(this.docPath, "utf8");
      const contentHash = approvalContentHash(body);
      const secret = loadOrCreateApprovalSecret(this.deps.storageDir);
      const token = mintApproval(
        this.subjectKey,
        contentHash,
        Date.now(),
        secret,
      );
      createApprovalStore(this.deps.storageDir).put(this.subjectKey, token);
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Approve failed for ${this.subjectKey}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    // Success and failure both end in a refresh: the status line reflects what the store now
    // actually holds (verified back through `verifyApproval`), not what we hope it holds.
    this.refresh();
  }

  // ── State + render ─────────────────────────────────────────────────────────────────────────

  /** Re-read the document, re-verify the stored token against it, and push both to the webview. */
  private refresh(): void {
    if (this.disposed) return;

    let body: string | undefined;
    try {
      body = fs.readFileSync(this.docPath, "utf8");
    } catch {
      body = undefined;
    }

    if (body === undefined) {
      this.postUpdate(
        "missing-doc",
        "",
        `<p class="hint">Document not found: <code>${escapeHtml(this.docPath)}</code> — it may not have been written yet. This panel will update when it appears.</p>`,
      );
      return;
    }

    const contentHash = approvalContentHash(body);
    const state = this.evaluate(contentHash);
    this.postUpdate(state, contentHash, md.render(body));
  }

  /**
   * Classify the store's token against the current content — using only the public verify
   * surface, exactly as the gate does. Time is not a factor: the token either binds this exact
   * body (→ "approved") or it does not (→ "changed since approval"). A missing token is
   * "unapproved". `verifyApproval` folds signature/subject/content into a single boolean, so any
   * non-matching token — edited content, wrong subject, forged MAC — surfaces as "changed",
   * directing the maintainer back to Approve.
   */
  private evaluate(contentHash: string): ApprovalState {
    let token: string | undefined;
    try {
      token = createApprovalStore(this.deps.storageDir).get(this.subjectKey);
    } catch {
      token = undefined;
    }
    if (token === undefined) return "unapproved";

    let secret: Buffer;
    try {
      secret = loadOrCreateApprovalSecret(this.deps.storageDir);
    } catch {
      // No usable secret → nothing can verify; treat as not-yet-approved rather than crash.
      return "unapproved";
    }

    return verifyApproval(token, {
      subjectKey: this.subjectKey,
      contentHash,
      secret,
    })
      ? "approved"
      : "changed";
  }

  /** Push a state + rendered-content update into the webview (the skeleton stays put). */
  private postUpdate(
    state: ApprovalState,
    contentHash: string,
    html: string,
  ): void {
    const kind = this.kindLabel();
    const armed = state !== "approved" && state !== "missing-doc";
    const statusText: Record<ApprovalState, string> = {
      approved: `Approved — the ${kind} gate will accept this content until the document changes, however long that takes.`,
      changed: "Changed since approval — re-approve.",
      unapproved: `Not yet approved — the gate refuses until you approve this ${kind}.`,
      "missing-doc": "Nothing to approve — the document is not on disk.",
    };
    void this.panel.webview.postMessage({
      type: "update",
      state,
      contentHash,
      html,
      statusText: statusText[state],
      buttonLabel: `Approve ${kind}`,
      armed,
    });
  }

  /** Kind prefix of the subjectKey (`spec:TEP-6/SP-3` → `spec`) — used only for labelling. */
  private kindLabel(): string {
    const colon = this.subjectKey.indexOf(":");
    return colon > 0 ? this.subjectKey.slice(0, colon) : "document";
  }

  // ── File watching ──────────────────────────────────────────────────────────────────────────

  /**
   * Watch the document's *parent directory* (not the file): editors and tools often save via a
   * temp-file + rename, which silently detaches a watcher bound to the file's inode; directory
   * events survive that, and also fire when a missing document first appears. Events are
   * debounced so a burst of writes yields one re-render. `fs.watch` (not
   * `workspace.createFileSystemWatcher`) because the reviewed document typically lives in a
   * thinking space outside any workspace folder.
   */
  private startWatching(): void {
    const dir = path.dirname(this.docPath);
    const base = path.basename(this.docPath);
    try {
      this.watcher = fs.watch(dir, (_event, filename) => {
        if (filename !== null && filename !== base) return;
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => this.refresh(), WATCH_DEBOUNCE_MS);
      });
    } catch {
      // Best-effort: without a watcher the panel still renders the document as of open time,
      // and Approve still re-reads the file at click time — content-binding stays correct.
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────────────────────

  private dispose(): void {
    this.disposed = true;
    ReviewPanel.panels.delete(this.subjectKey);
    this.watcher?.close();
    if (this.debounce) clearTimeout(this.debounce);
  }

  // ── Webview HTML ───────────────────────────────────────────────────────────────────────────

  /**
   * Static skeleton set once; every subsequent change arrives as an `update` message so the
   * reader's scroll position survives live edits. The script swaps the rendered body only when
   * the content hash moved, and updates the status line / button on every message.
   */
  private skeletonHtml(): string {
    const nonce = randomNonce();
    const kind = escapeHtml(this.kindLabel());
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      margin: 0;
      padding: 0 1.5em 2em;
    }
    header {
      position: sticky;
      top: 0;
      background: var(--vscode-editor-background);
      border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,.35));
      padding: .75em 0;
      z-index: 1;
    }
    .subject { font-weight: 600; }
    .docpath {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: .85em;
      opacity: .7;
      word-break: break-all;
    }
    .controls { display: flex; align-items: center; gap: 1em; margin-top: .6em; flex-wrap: wrap; }
    button#approve {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: .45em 1.2em;
      border-radius: 2px;
      cursor: pointer;
      font-size: 1em;
    }
    button#approve:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
    button#approve:disabled { opacity: .5; cursor: default; }
    .status { font-size: .9em; }
    .status.approved { color: var(--vscode-testing-iconPassed, #3fb950); }
    .status.changed { color: var(--vscode-editorWarning-foreground, #d29922); }
    .status.unapproved, .status.missing-doc { opacity: .8; }
    .caption { font-size: .8em; opacity: .6; margin-top: .35em; }
    #content { max-width: 55em; line-height: 1.55; }
    #content pre {
      background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.15));
      padding: .75em; overflow-x: auto; border-radius: 3px;
    }
    #content code { font-family: var(--vscode-editor-font-family, monospace); }
    #content blockquote {
      border-left: 3px solid var(--vscode-textBlockQuote-border, rgba(128,128,128,.5));
      margin-left: 0; padding-left: 1em; opacity: .85;
    }
    #content table { border-collapse: collapse; }
    #content th, #content td {
      border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.35));
      padding: .3em .6em;
    }
    .hint { opacity: .7; font-style: italic; }
  </style>
</head>
<body>
  <header>
    <div class="subject">${escapeHtml(this.subjectKey)}</div>
    <div class="docpath">${escapeHtml(this.docPath)}</div>
    <div class="controls">
      <button id="approve" disabled>Approve ${kind}</button>
      <span id="status" class="status">Loading…</span>
    </div>
    <div class="caption">Review approval for the decision-point gate (arms create_slice / →Ready). Distinct from the end-of-lifecycle “accept” (merge-to-main).</div>
  </header>
  <div id="content"><p class="hint">Loading…</p></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const content = document.getElementById('content');
    const status = document.getElementById('status');
    const btn = document.getElementById('approve');
    let lastHash;
    window.addEventListener('message', (e) => {
      const m = e.data;
      if (!m || m.type !== 'update') return;
      // Swap the body only when the content actually moved — preserves scroll while the
      // status/button re-arm on every state change (approve, edit).
      if (m.contentHash !== lastHash) {
        content.innerHTML = m.html;
        lastHash = m.contentHash;
      }
      status.textContent = m.statusText;
      status.className = 'status ' + m.state;
      btn.textContent = m.buttonLabel;
      btn.disabled = !m.armed;
    });
    btn.addEventListener('click', () => {
      btn.disabled = true; // the host's refresh re-arms it if the mint failed
      vscode.postMessage({ type: 'approve' });
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

function escapeHtml(s: string): string {
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

/** 16 random chars from [A-Za-z0-9] — enough entropy for a CSP nonce. */
function randomNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}
