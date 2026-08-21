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
import { phaseOf, refusedNow } from "./phase";
import { spacePush } from "./panelPush";

export { spacePush };

const req: NodeRequire =
  typeof require !== "undefined" ? require : createRequire(__filename);
function vs(): typeof vscodeTypes {
  return req("vscode") as typeof vscodeTypes;
}

interface PanelHostHooks {
  /** Host-side gesture: the QuickPick that rebinds the space to a repo. */
  onSwitchRepo?: () => Promise<void>;
}

/**
 * The one door a SpacePanel uses onto the editor: asked for a panel titled
 * with the space's own display name, never told to reuse or dispose a
 * panel belonging to another space. A fake host lets a test see that door
 * knocked on without opening a real VS Code tab. Shaped like a raw VS Code
 * webview panel so the real host can hand one back untouched.
 */
export interface HostWebview {
  html: string;
  postMessage(message: unknown): Thenable<boolean> | void;
  onDidReceiveMessage(listener: (message: unknown) => void): { dispose(): void };
  asWebviewUri(uri: vscodeTypes.Uri): vscodeTypes.Uri;
  cspSource: string;
}

export interface HostPanel {
  webview: HostWebview;
  reveal(): void;
  onDidDispose(listener: () => void): { dispose(): void };
  dispose(): void;
}

export interface PanelHost {
  createPanel(title: string): HostPanel;
}

/** The real host: one VS Code webview panel per call, titled as asked. */
export function vscodePanelHost(extensionUri: vscodeTypes.Uri): PanelHost {
  return {
    createPanel(title: string): HostPanel {
      return vs().window.createWebviewPanel(
        "thinkubeTandemSpace",
        title,
        { viewColumn: vs().ViewColumn.Active, preserveFocus: false },
        {
          enableScripts: true,
          localResourceRoots: [extensionUri],
          retainContextWhenHidden: true,
        },
      );
    },
  };
}

interface InboundAction {
  action: string;
  text?: string;
  kind?: string;
  items?: string[];
  unitId?: string;
  questionId?: string;
  pinKind?: string;
  // answer-worker carries unitId + text; stop-run carries nothing.
  changeIds?: string[];
  deliveryId?: string;
  proposalId?: string;
  impactId?: string;
  stepId?: string;
  page?: number;
  into?: string;
}

async function handleInbound(
  session: TandemSession,
  msg: InboundAction,
  push: (message?: string) => void,
  hooks?: PanelHostHooks,
): Promise<void> {
  // The host refuses what the phase does not allow — a press the surface
  // let through by mistake never starts work it must not start.
  const refusal = refusedNow(msg.action, phaseOf(session));
  if (refusal) {
    push(refusal);
    return;
  }
  if (msg.action === "switch-repo") {
    await hooks?.onSwitchRepo?.();
    return;
  }
  let note: string | undefined;
  if (msg.action === "save-draft") {
    // Typing costs nothing and interrupts nothing: the words are kept and
    // the surface is not told anything it does not already know.
    session.saveDraft(msg.text ?? "");
    return;
  } else if (msg.action === "read-draft") {
    push("Reading what you wrote…");
    const r = await session.readDraft();
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "keep-draft") {
    const r = session.keepDraft();
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "cancel-capture") {
    session.cancelCapture();
    note = "Cancelled.";
  } else if (msg.action === "build") {
    push("Building…");
    const r = await session.build(msg.changeIds ?? []);
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "think") {
    const c = session.thinkingCost();
    push(
      c.subjects
        ? `Thinking about ${c.subjects} object(s) — about ${c.rounds} rounds…`
        : "Thinking…",
    );
    const r = await session.think();
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "reframe" && msg.unitId && msg.text) {
    push("Reading it again…");
    const r = await session.reframe(msg.unitId, msg.text);
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "amend" && msg.unitId && msg.text) {
    push("Recording the amendment…");
    const r = await session.amend(msg.unitId, msg.text);
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "accept-delivery" && msg.deliveryId) {
    const r = await session.acceptDelivery(msg.deliveryId);
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "accept-question" && msg.questionId) {
    push("Recording the decision…");
    const r = await session.acceptQuestion(msg.questionId, msg.text);
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "answer-worker" && msg.unitId && msg.text) {
    session.answerWorker(msg.unitId, msg.text);
  } else if (msg.action === "dismiss-promise") {
    const r = session.editModel({
      kind: msg.action,
      id: msg.unitId ?? "",
      ...(msg.text ? { text: msg.text } : {}),
    });
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "retry-model") {
    push("Reading your list again…");
    const r = await session.retryModel();
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "read-log") {
    session.readLog(msg.stepId ?? null);
  } else if (msg.action === "stop-run") {
    session.stopRun();
  } else if (msg.action === "accept-impact" && msg.impactId) {
    push("Re-deriving under the decision…");
    const r = await session.decideImpact(msg.impactId, true);
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "dismiss-impact" && msg.impactId) {
    const r = await session.decideImpact(msg.impactId, false);
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "apply-all-impacts") {
    const r = await session.applyAllImpacts();
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "panic") {
    const r = session.panic();
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "open-cut-review") {
    const doc = await vs().workspace.openTextDocument({
      content: session.cutScreen(),
      language: "markdown",
    });
    await vs().window.showTextDocument(doc, { preview: true });
  } else if (msg.action === "propose-check") {
    const r = await session.proposeCheckFor(msg.changeIds?.[0] ?? "");
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "accept-check") {
    session.acceptCheck(
      msg.changeIds?.[0] ?? "",
      msg.text ?? "",
      msg.kind === "assessment" ? "assessment" : "probe",
    );
  } else if (msg.action === "rerun") {
    push("Starting the signed work again…");
    const r = await session.rerun();
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "reground") {
    push("Re-grounding…");
    await session.reground();
  }
  push(note);
}

export interface SpacePanelOptions extends PanelHostHooks {
  /** Told once, when the editor (not this class) closes the tab. */
  onClosed?: () => void;
}

/**
 * One thinking space's own editor tab: opened for exactly one session, it
 * asks its host for exactly one panel titled with that space's display
 * name, and reads and acts on that session alone — never a session looked
 * up as "active" by whoever else happens to be open.
 */
export class SpacePanel implements vscodeTypes.Disposable {
  private _hostPanel: HostPanel | undefined;
  private _disposables: { dispose(): void }[] = [];
  private _closed = false;

  constructor(
    /** The owner-and-slug key this tab is addressed by. */
    private readonly spaceKey: string,
    private readonly session: TandemSession,
    private readonly host: PanelHost,
    private readonly opts?: SpacePanelOptions,
    /** Where the built map bundle lives; absent under a fake host. */
    private readonly extensionUri?: vscodeTypes.Uri,
  ) {}

  private get title(): string {
    return this.session.deps.spaceName ?? this.session.repoName;
  }

  async show(): Promise<void> {
    if (this._hostPanel) {
      this._hostPanel.reveal();
      this._push();
      return;
    }
    const hostPanel = this.host.createPanel(this.title);
    this._hostPanel = hostPanel;
    if (this.extensionUri)
      hostPanel.webview.html = await renderBundleHtml(this.extensionUri, hostPanel.webview);
    this._disposables.push(
      hostPanel.webview.onDidReceiveMessage(async (raw) => {
        const msg = raw as InboundAction;
        const session = this.session;
        const run = () =>
          handleInbound(session, msg, (m) => this._push(m), this.opts);
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
      hostPanel.onDidDispose(() => {
        this._closed = true;
        this._hostPanel = undefined;
        this.opts?.onClosed?.();
      }),
    );
    this._push();
  }

  /** The key this tab is registered under. */
  get key(): string {
    return this.spaceKey;
  }

  /** Public so the session's onChanged hook can re-push mid-run. */
  pushFrom(message?: string): void {
    this._push(message);
  }

  private _push(message?: string): void {
    void this._hostPanel?.webview.postMessage(spacePush(this.session, message));
  }

  reveal(): void {
    this._hostPanel?.reveal();
  }

  isClosed(): boolean {
    return this._closed;
  }

  dispose(): void {
    for (const d of this._disposables) d.dispose();
    this._disposables = [];
    this._hostPanel?.dispose();
    this._hostPanel = undefined;
    this._closed = true;
  }
}

async function renderBundleHtml(
  extensionUri: vscodeTypes.Uri,
  webview: HostWebview,
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
