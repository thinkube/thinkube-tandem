/**
 * The space panel: bridges one thinking space's registered actions to its
 * own session, and asks its host for a tab titled with that space's name.
 * Pushes the whole surface state after every act — the webview holds no
 * state of its own beyond selection.
 *
 * Host-agnostic by construction: nothing here reaches the real vscode API.
 * Building the actual webview panel (loading the bundle, computing CSP,
 * resolving the extension's install path) is the concrete PanelHost's job,
 * supplied from outside — a panel opened for one space never touches, and
 * never disposes, a panel any other space's SpacePanel created.
 */
import { createRequire } from "node:module";
import type * as vscodeTypes from "vscode";
import { TandemSession } from "./session";
import { spacePush } from "./push";

// The panel is the surface that pushes space state, so the push payload is
// addressable here as well as at its definition.
export { spacePush };
import { handleInbound } from "./inbound";
import type { InboundAction } from "./inbound";

/** The minimal panel-like object a concrete host hands back from
 *  createPanel — a drop-in for whatever vscode.WebviewPanel exposes that
 *  this module actually drives. */
export interface PanelLike {
  webview: {
    html: string;
    readonly cspSource: string;
    asWebviewUri(uri: unknown): unknown;
    onDidReceiveMessage(cb: (message: unknown) => unknown): { dispose(): void };
    postMessage(message: unknown): Promise<boolean>;
  };
  reveal(): void;
  onDidDispose(cb: () => void): { dispose(): void };
  dispose(): void;
}

/** What a SpacePanel needs from its host: one ready-to-use panel per ask,
 *  titled as asked. The host owns everything vscode-specific — building
 *  the panel, loading and rewriting the bundle HTML, computing CSP. */
export interface PanelHost {
  createPanel(title: string): PanelLike;
}

/** The space this panel was opened for and nothing else: its
 *  owner-and-slug key, its display name, and its own session. */
export interface SpacePanelHandle {
  key: string;
  name: string;
  session: TandemSession;
}

const req: NodeRequire =
  typeof require !== "undefined" ? require : createRequire(__filename);
export function vs(): typeof vscodeTypes {
  return req("vscode") as typeof vscodeTypes;
}

export interface PanelHostHooks {
  /** Host-side gesture: the QuickPick that rebinds the space to a repo. */
  onSwitchRepo?: () => Promise<void>;
  /** Host-side gesture: open the rendered cut-review text for reading. */
  onOpenCutReview?: (content: string) => Promise<void>;
  /** Host-side liveness wrapper for a long-running gesture (capture). */
  onWithProgress?: (
    title: string,
    run: (report: (message: string) => void, onCancel: (fn: () => void) => void) => Promise<void>,
  ) => Promise<void>;
  /** Told when the editor closed this space's tab, so the owner can drop
   *  it from whatever register keeps it — nothing keeps a dead tab. */
  onClosed?: (key: string) => void;
}

/**
 * One space's own tab. Everything it does — asking for the panel, pushing
 * state, dispatching inbound actions — runs against `handle.session`
 * captured at construction; it never reaches any other space's panel and
 * never looks anything up as "the active session".
 */
export class SpacePanel {
  private _panel: PanelLike | undefined;
  private _disposables: { dispose(): void }[] = [];

  constructor(
    private readonly handle: SpacePanelHandle,
    private readonly host: PanelHost,
    private readonly hooks?: PanelHostHooks,
  ) {}

  /** Ask the host for this space's own panel — titled with its display
   *  name — exactly once for this instance's lifetime; reveal it on every
   *  later call instead of asking again. */
  async show(): Promise<void> {
    if (this._panel) {
      this.reveal();
      this._push();
      return;
    }
    const panel = this.host.createPanel(this.handle.name);
    this._panel = panel;
    this._disposables.push(
      panel.webview.onDidReceiveMessage(async (raw) => {
        const msg = raw as InboundAction;
        const session = this.handle.session;
        const run = () =>
          handleInbound(session, msg, (m) => this._push(m), this.hooks);
        // Industry-standard liveness: a real progress notification with a
        // working Cancel for anything that thinks longer than a beat.
        if (
          (msg.action === "capture" || msg.action === "capture-many") &&
          this.hooks?.onWithProgress
        ) {
          await this.hooks.onWithProgress(
            "Tandem is thinking about your ask",
            async (report, onCancel) => {
              onCancel(() => session.cancelCapture());
              const tick = setInterval(() => {
                const a = session.activity;
                if (a) report(`${a.label} (${a.current}/${a.total})`);
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
      panel.onDidDispose(() => {
        this._panel = undefined;
        this.hooks?.onClosed?.(this.handle.key);
      }),
    );
    this._push();
  }

  /** Public so this space's own onChanged hook can re-push mid-run —
   *  always this panel's own session's state, never another's. */
  push(message?: string): void {
    this._push(message);
  }

  private _push(message?: string): void {
    void this._panel?.webview.postMessage(spacePush(this.handle.session, message));
  }

  /** Whether the editor still shows this space's tab. */
  isClosed(): boolean {
    return !this._panel;
  }

  /** Bring this space's own tab to the front — never another's. */
  reveal(): void {
    this._panel?.reveal();
  }

  dispose(): void {
    for (const d of this._disposables) d.dispose();
    this._disposables = [];
    this._panel?.dispose();
    this._panel = undefined;
  }
}
