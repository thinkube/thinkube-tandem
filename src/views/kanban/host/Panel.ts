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
 *
 * This file is also the host end of the `open_review` bridge (SP-6/3): the
 * detached MCP server has no `vscode` API, so its `open_review({kind, id})`
 * tool asks the host to mount the review webview. `openReviewFromHost` (below)
 * is that seam — it resolves the reviewed document and mounts `ReviewPanel`,
 * whose **Approve spec** button mints the content-bound approval token the
 * `create_slice`/→Ready gate verifies. That pre-slicing approval is a
 * DIFFERENT moment from the `accept-spec` message this panel also handles
 * (the end-of-lifecycle Approve-&-close / merge-to-main gate) — the two are
 * named distinctly throughout so they don't blur.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

import { StorageAdapter } from "./StorageAdapter";
import {
  ThinkingSpace,
  HostMessage,
  ModeFlag,
  TaskCard,
  WebviewMessage,
} from "./types";
import {
  runningSessions,
  parkedWorkers,
  doneWorkers,
  onSessionsChange,
} from "../../../services/orchestratorSessions";
import { deliveryExitState } from "../../../services/orchestratorCore";
import { ReviewPanel } from "../../review/ReviewPanel";

interface PanelDeps {
  extensionUri: vscode.Uri;
  adapter: StorageAdapter;
  output?: vscode.OutputChannel;
  /** Open the full detail view for an issue (e.g. its GitHub page). */
  openDetail?: (id: string) => void | Promise<void>;
  /**
   * Acceptance card's "Accept Spec" button (TEP-0010): run the acceptance gate,
   * stamp `accepted:`, and merge the Spec's single PR. Throws (with a reason) on
   * a gate refusal or merge failure. Absent on adapters with no backing repo.
   */
  onAcceptSpec?: (spec: string) => void | Promise<void>;
  /**
   * Where the approval secret + side-channel token store live — the host's
   * globalStorage path, the same directory the MCP server self-locates its
   * approval store to (SP-6/17). Enables the "Approve spec" review
   * affordance (the PRE-slicing approval that arms `create_slice`/→Ready —
   * distinct from `onAcceptSpec` above, the end-of-lifecycle merge gate).
   * Absent → the affordance reports unavailable; the approval gate ships dark.
   */
  approvalStorageDir?: string;
}

const ACTIVE_PANELS = new Map<string, KanbanPanel>();

export class KanbanPanel implements vscode.Disposable {
  private readonly panel: vscode.WebviewPanel;
  private readonly adapter: StorageAdapter;
  private readonly extensionUri: vscode.Uri;
  private readonly output: vscode.OutputChannel | undefined;
  private readonly openDetail:
    ((id: string) => void | Promise<void>) | undefined;
  private readonly onAcceptSpec:
    ((spec: string) => void | Promise<void>) | undefined;
  private readonly approvalStorageDir: string | undefined;
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
    this.onAcceptSpec = deps.onAcceptSpec;
    this.approvalStorageDir = deps.approvalStorageDir;
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
      // Re-post when a worker starts/stops so the graph's running tags update live.
      { dispose: onSessionsChange(() => void this.refreshRunning()) },
    );
    if (this.adapter.onExternalChange) {
      this.disposables.push(
        this.adapter.onExternalChange((thinkingSpace) =>
          this.post({
            kind: "external-change",
            thinkingSpace,
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
            const thinkingSpace = await this.adapter.load();
            this.post({ kind: "state", thinkingSpace, mode: readMode() });
          } catch (err) {
            this.log(`mode-change reload failed: ${(err as Error).message}`);
          }
        }
      }),
    );
  }

  private async handle(
    message: WebviewMessage | OpenReviewMessage,
  ): Promise<void> {
    switch (message.kind) {
      case "load": {
        const thinkingSpace = await this.adapter.load();
        this.post({ kind: "state", thinkingSpace, mode: readMode() });
        break;
      }
      case "save":
        await this.adapter.save(message.thinkingSpace);
        break;
      case "update-task": {
        if (!this.adapter.updateIssue) {
          this.notify("warn", "This thinking space doesn't support editing.");
          break;
        }
        try {
          await this.adapter.updateIssue(message.id, {
            title: message.title,
            body: message.body,
          });
          // Reflect the edit: reload from the backing store and re-render.
          const thinkingSpace = await this.adapter.load();
          this.post({ kind: "state", thinkingSpace, mode: readMode() });
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
          this.notify("warn", "This thinking space doesn't support due dates.");
          break;
        }
        try {
          await this.adapter.setDueDate(message.id, message.date);
          const thinkingSpace = await this.adapter.load();
          this.post({ kind: "state", thinkingSpace, mode: readMode() });
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
      case "accept-spec": {
        if (!this.onAcceptSpec) {
          this.notify(
            "info",
            "Accepting a Spec isn't available on this thinking space.",
          );
          break;
        }
        try {
          await this.onAcceptSpec(message.spec);
          // Reflect the accept: the Spec doc now carries `accepted:`, so the
          // acceptance card derives into Done on reload.
          const thinkingSpace = await this.adapter.load();
          this.post({ kind: "state", thinkingSpace, mode: readMode() });
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
      case "open-review": {
        // "Approve spec" (SP-6/3) — the PRE-slicing approval moment, deliberately
        // named distinctly from "accept-spec" above (the end-of-lifecycle
        // Approve-&-close / merge-to-main gate). This opens the review panel whose
        // Approve button mints the content-bound token the `create_slice`/→Ready
        // gate verifies; it merges nothing and closes nothing.
        if (!this.approvalStorageDir) {
          this.notify(
            "info",
            "Approve spec isn't available here — no approval storage is configured for this panel (the approval gate ships dark).",
          );
          break;
        }
        try {
          await openReviewFromHost(
            { kind: "spec", id: message.spec },
            {
              storageDir: this.approvalStorageDir,
              thinkingSpaceDir:
                this.adapter.thinkingSpaceContext?.()?.thinkingSpaceDir,
            },
          );
        } catch (err) {
          this.log(
            `open-review ${message.spec} failed: ${(err as Error).message}`,
          );
          this.notify(
            "error",
            `Couldn't open the spec review: ${(err as Error).message}`,
          );
        }
        break;
      }
      case "float-out":
        try {
          await vscode.commands.executeCommand(
            "thinkube.floatOutSession",
            message.handle,
          );
        } catch (err) {
          this.log(
            `float-out ${message.handle} failed: ${(err as Error).message}`,
          );
        }
        break;
      case "attend":
        try {
          await vscode.commands.executeCommand(
            "thinkube.attend",
            message.handle,
            this.adapter.thinkingSpaceContext?.(),
          );
        } catch (err) {
          this.log(
            `attend ${message.handle} failed: ${(err as Error).message}`,
          );
        }
        break;
      case "orchestrate":
        try {
          // Pass THIS panel's thinking space so the command orchestrates the thinking space the button is on,
          // not whatever space the sidebar happens to be scoped to.
          await vscode.commands.executeCommand(
            "thinkube.orchestrate",
            message.spec,
            this.adapter.thinkingSpaceContext?.(),
          );
          // The run advances slices to Done via a write path that bypasses this
          // panel's in-process store (and the external FS watcher is unreliable for
          // the out-of-workspace thinking space), so re-load + re-post once the
          // command resolves — otherwise the final Done state needs a window reload.
          await this.reloadAndPost();
        } catch (err) {
          this.log(
            `orchestrate ${message.spec} failed: ${(err as Error).message}`,
          );
        }
        break;
      case "accept":
        // The delivery report's Accept exit: forward to the gated-merge
        // command, carrying THIS panel's thinking space (same shape as orchestrate/attend).
        try {
          await vscode.commands.executeCommand(
            "thinkube.accept",
            message.spec,
            this.adapter.thinkingSpaceContext?.(),
          );
          // The merge + `accepted:` stamp land via a different write path than this
          // panel's store, and the out-of-workspace FS watcher is unreliable — so the
          // status never changes without a manual reload. Re-load + re-post here so the
          // accepted Spec reflects immediately (mirrors the `accept-spec` handler).
          await this.reloadAndPost();
        } catch (err) {
          this.log(`accept ${message.spec} failed: ${(err as Error).message}`);
        }
        break;
      case "reject":
        // The delivery report's Reject exit: forward to the primed-session
        // command (the spec-level analog of /attend).
        try {
          await vscode.commands.executeCommand(
            "thinkube.reject",
            message.spec,
            this.adapter.thinkingSpaceContext?.(),
          );
          await this.reloadAndPost();
        } catch (err) {
          this.log(`reject ${message.spec} failed: ${(err as Error).message}`);
        }
        break;
      case "rerun":
        // The stalled delivery's Re-run exit (SP-11/2): re-dispatch the makespan scheduler on
        // the Spec — the SAME action as ▶ Orchestrate, surfaced as a state-derived exit. Carry
        // THIS panel's thinking space and re-load + re-post as the orchestrate handler does; the
        // fresh state push re-forwards the exit set, reconciling the button model's pending flag.
        try {
          await vscode.commands.executeCommand(
            "thinkube.orchestrate",
            message.spec,
            this.adapter.thinkingSpaceContext?.(),
          );
          await this.reloadAndPost();
        } catch (err) {
          this.log(`rerun ${message.spec} failed: ${(err as Error).message}`);
        }
        break;
      case "notify":
        this.notify(message.level, message.text);
        break;
      default:
        this.log(`unknown message: ${(message as { kind?: string }).kind}`);
    }
  }

  private post(message: HostMessage): void {
    // Overlay live-worker flags so the control-center graph can tag running slices.
    const out =
      "thinkingSpace" in message
        ? { ...message, thinkingSpace: this.withRunning(message.thinkingSpace) }
        : message;
    this.panel.webview.postMessage(out);
    // Every state push re-derives + re-forwards each Spec's delivery exit set (SP-11/2), which
    // doubles as the button model's reconcile status event. `delivery-exits` itself carries no
    // `thinkingSpace`, so this never recurses.
    if ("thinkingSpace" in out) this.postDeliveryExits(out.thinkingSpace);
  }

  /**
   * Forward each Spec's state-derived delivery exit set (SP-11/2) to the webview. Derived once,
   * here in the host, from the acceptance close-card via the shared `deliveryExitState` — the
   * single source of truth the delivery report also consumes, so report and buttons never drift.
   * The webview renders + dispatches its exit buttons from these ids + labels (never hardcoded);
   * re-posting on every state push is also the status event that reconciles the button model
   * (clears any pending action, re-enables the exits).
   */
  private postDeliveryExits(thinkingSpace: ThinkingSpace): void {
    for (const t of Object.values(thinkingSpace.tasks)) {
      if (!t.isAcceptance || !t.parentId) continue;
      // committed ⇔ every slice of the Spec landed Done; gatePassed ⇔ the acceptance gate is
      // armed (every slice Done + every AC checked = `acceptReady`). `deliveryExitState` folds
      // them into delivered → [accept, request-changes] vs stalled → [attend, rerun].
      const committed =
        typeof t.slicesTotal === "number" &&
        t.slicesTotal > 0 &&
        t.slicesDone === t.slicesTotal;
      const gatePassed = !!t.acceptReady;
      const { exits } = deliveryExitState({ committed, gatePassed });
      this.panel.webview.postMessage({
        kind: "delivery-exits",
        spec: t.parentId,
        exits,
      });
    }
  }

  /** Flag tasks whose slice has a live Agent SDK worker. */
  private withRunning(thinkingSpace: ThinkingSpace): ThinkingSpace {
    const live = runningSessions();
    const park = parkedWorkers();
    const done = doneWorkers();
    if (live.length === 0 && park.length === 0 && done.length === 0)
      return thinkingSpace;
    // Sessions are keyed per WORKER (execution unit, e.g. `SP-3_SL-2#eu-0`); group them under
    // their slice so the control-center graph shows a node per worker: green
    // while running, amber while parked (needs-input), lime once it has completed.
    const bySlice = (ids: string[]): Map<string, string[]> => {
      const m = new Map<string, string[]>();
      for (const id of ids) {
        const slice = id.split("#")[0];
        (m.get(slice) ?? m.set(slice, []).get(slice)!).push(id);
      }
      return m;
    };
    const runBySlice = bySlice(live);
    const doneBySlice = bySlice(done);
    const parkBySlice = new Map<string, string[]>();
    for (const p of park) {
      (
        parkBySlice.get(p.slice) ?? parkBySlice.set(p.slice, []).get(p.slice)!
      ).push(p.id);
    }
    const tasks: Record<string, TaskCard> = {};
    for (const [id, t] of Object.entries(thinkingSpace.tasks)) {
      const workers = runBySlice.get(id);
      const parkedIds = parkBySlice.get(id);
      const doneIds = doneBySlice.get(id);
      tasks[id] =
        workers || parkedIds || doneIds
          ? {
              ...t,
              ...(workers ? { running: true, runningWorkers: workers } : {}),
              ...(parkedIds ? { parkedWorkers: parkedIds } : {}),
              ...(doneIds ? { doneWorkers: doneIds } : {}),
            }
          : t;
    }
    return { ...thinkingSpace, tasks };
  }

  /** Re-post the thinking space when the running set changes, so graph tags appear/clear live. */
  private async refreshRunning(): Promise<void> {
    await this.reloadAndPost();
  }

  /**
   * Re-read the backing store and re-post the full state. Used after a host-driven
   * command (orchestrate / accept / reject) whose writes land via a different path
   * than this panel's in-process store — the external FS watcher is unreliable for an
   * out-of-workspace thinking space, so we refresh explicitly instead of waiting for a
   * window reload.
   */
  private async reloadAndPost(): Promise<void> {
    try {
      const thinkingSpace = await this.adapter.load();
      this.post({ kind: "state", thinkingSpace, mode: readMode() });
    } catch (err) {
      this.log(`reload-and-post failed: ${(err as Error).message}`);
    }
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

/**
 * "Approve spec" affordance message (SP-6/3): open the pre-slicing review panel
 * for a Spec. `spec` tolerates the tep-qualified key (`TEP-6_SP-3`), the
 * composite id (`6/3`), or the canonical subject id (`TEP-6/SP-3`).
 *
 * Kept as a LOCAL type rather than a `WebviewMessage` member: `types.ts`
 * mirrors the webview app (which is authoritative for the union), so the
 * shared type follows when the webview grows its button. Deliberately a
 * different kind from `accept-spec` — approving a spec for slicing and
 * accepting a delivered spec (merge-to-main) are different moments and must
 * never share a message.
 */
type OpenReviewMessage = { kind: "open-review"; spec: string };

// ─── open_review host bridge (SP-6/3) ──────────────────────────────────────
//
// The detached MCP server's `open_review({kind, id})` tool cannot touch the
// `vscode` API, so it hands the request to the extension host (the same
// filesystem control-request channel `start_spec_worktree` uses). These
// exports are the host end of that bridge: resolve the reviewed document and
// mount the kind-agnostic `ReviewPanel`, whose Approve button mints the
// content-bound approval token that the `create_slice`/→Ready gate verifies.

/** The review subject kinds `open_review({kind, id})` can name. */
export type ReviewKind = "spec" | "tep";

/** The `open_review` request as it reaches the host: `{kind, id}` per the MCP tool. */
export interface OpenReviewRequest {
  kind: ReviewKind;
  /** `TEP-6/SP-3` for a spec, `TEP-6` for a tep (tolerant forms are canonicalized). */
  id: string;
}

export interface OpenReviewHostDeps {
  /**
   * Where the approval secret + token store live — the host's globalStorage
   * path, i.e. the directory the MCP server self-locates its approval store to (SP-6/17).
   */
  storageDir: string;
  /**
   * The thinking space dir to resolve `{kind, id}` into a document path.
   * Ignored when `docPath` is given.
   */
  thinkingSpaceDir?: string;
  /**
   * Pre-resolved absolute path of the reviewed document (e.g. computed by the
   * MCP server, which knows its thinking space root, and carried on the
   * control request). Wins over `thinkingSpaceDir` resolution.
   */
  docPath?: string;
}

/**
 * Host end of `open_review({kind, id})`: canonicalize the subject, resolve the
 * reviewed document, and mount {@link ReviewPanel} for
 * `subjectKey = \`${kind}:${id}\`` (e.g. `spec:TEP-6/SP-3`) — the EXACT key the
 * gate checks, so the panel's Approve arms precisely this subject's gate.
 * Throws (with a reason) when the request can't be honoured; callers (the
 * control-request watcher, this panel's `open-review` handler) surface it.
 */
export async function openReviewFromHost(
  req: OpenReviewRequest,
  deps: OpenReviewHostDeps,
): Promise<void> {
  if (req.kind !== "spec" && req.kind !== "tep") {
    throw new Error(
      `open_review: unknown review kind "${String(req.kind)}" (expected "spec" | "tep").`,
    );
  }
  const id = canonicalReviewId(req.kind, req.id);
  if (!id) {
    throw new Error(
      `open_review: unrecognized ${req.kind} id "${req.id}" — expected ` +
        (req.kind === "spec" ? `"TEP-<t>/SP-<n>"` : `"TEP-<t>"`) +
        `.`,
    );
  }
  // Kind-namespaced subject — matches the gate's key byte-for-byte, and keeps
  // a `spec:` approval from ever satisfying a `tep:` gate (or vice versa).
  const subjectKey = `${req.kind}:${id}`;
  const docPath =
    deps.docPath ??
    (deps.thinkingSpaceDir
      ? await resolveReviewDocPath(req.kind, id, deps.thinkingSpaceDir)
      : undefined);
  if (!docPath) {
    throw new Error(
      `open_review: cannot locate the ${req.kind} document for ${subjectKey} — ` +
        `no docPath was supplied and there is no thinking space dir to resolve it under.`,
    );
  }
  ReviewPanel.open(subjectKey, docPath, { storageDir: deps.storageDir });
}

/**
 * Canonicalize a review subject id to the form the gate keys on:
 * `TEP-6/SP-3` (spec) / `TEP-6` (tep). Tolerates the tep-qualified flattening
 * (`TEP-6_SP-3`), the composite spec id (`6/3`), and a bare tep number.
 * Returns `undefined` for anything else.
 */
function canonicalReviewId(kind: ReviewKind, id: string): string | undefined {
  const raw = id.trim();
  if (kind === "tep") {
    const m = /^(?:TEP-)?(\d+)$/.exec(raw);
    return m ? `TEP-${m[1]}` : undefined;
  }
  const m = /^(?:TEP-)?(\d+)[/_](?:SP-)?(\d+)$/.exec(raw);
  return m ? `TEP-${m[1]}/SP-${m[2]}` : undefined;
}

/**
 * Resolve a canonical review id to its document under a thinking space dir:
 * `<space>/<org>/teps/TEP-6/SP-3/spec.md` (or `…/TEP-6/tep.md`), where `<org>`
 * is the per-maintainer segment discovered exactly as `ThinkubeStore.orgSeg`
 * does — the child dir holding a `teps/` — with a bare `teps/` fallback for an
 * org-less space. Prefers a candidate whose document EXISTS (several orgs can
 * share one space), but still returns the store-mirroring path when none does:
 * `ReviewPanel` renders a "not yet written" state and live-updates when the
 * document appears, which matters mid-`/spec-prepare`.
 */
export async function resolveReviewDocPath(
  kind: ReviewKind,
  canonicalId: string,
  thinkingSpaceDir: string,
): Promise<string> {
  const relDoc =
    kind === "spec"
      ? [...canonicalId.split("/"), "spec.md"]
      : [canonicalId, "tep.md"];
  // Candidate `teps` roots: each org child dir that holds one, then the bare root.
  const roots: string[] = [];
  try {
    for (const e of await fs.readdir(thinkingSpaceDir, {
      withFileTypes: true,
    })) {
      if (
        !e.isDirectory() ||
        e.name.startsWith(".") ||
        e.name === "node_modules"
      )
        continue;
      const orgTeps = path.join(thinkingSpaceDir, e.name, "teps");
      try {
        await fs.access(orgTeps);
        roots.push(orgTeps);
      } catch {
        /* not an org dir */
      }
    }
  } catch {
    /* space dir missing/unreadable → bare-root fallback below */
  }
  roots.push(path.join(thinkingSpaceDir, "teps"));
  for (const root of roots) {
    const candidate = path.join(root, ...relDoc);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      /* keep probing */
    }
  }
  // Nothing on disk yet: mirror the store's own resolution (first org, else bare).
  return path.join(roots[0], ...relDoc);
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
