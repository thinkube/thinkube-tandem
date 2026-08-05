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
import { islandsOf } from "./graphCore/islands";

const req: NodeRequire =
  typeof require !== "undefined" ? require : createRequire(__filename);
function vs(): typeof vscodeTypes {
  return req("vscode") as typeof vscodeTypes;
}

interface InboundAction {
  action: string;
  text?: string;
  unitId?: string;
  changeIds?: string[];
  deliveryId?: string;
}

function spacePush(session: TandemSession, message?: string): unknown {
  const island = islandsOf(
    session.units.map((u) => u.id),
    session.edges,
  );
  const byId = new Map(session.space.nodes.map((n) => [n.id, n]));
  return {
    kind: "space",
    running: session.running,
    units: session.units.map((u) => {
      const nodes = u.changeIds
        .map((id) => byId.get(id))
        .filter((n): n is NonNullable<typeof n> => !!n);
      const first = nodes[0]?.sentence ?? u.id;
      return {
        id: u.id,
        title: nodes.length > 1 ? `${first} +${nodes.length - 1} more` : first,
        count: nodes.length,
        changeIds: u.changeIds,
        island: island.get(u.id) ?? 0,
        inCut: u.changeIds.every((id) => session.cutNodeIds.has(id)) && u.changeIds.length > 0,
        stale: u.changeIds.some((id) => session.stale.has(id)),
        nodes: nodes.map((n) => ({
          id: n.id,
          sentence: n.sentence,
          touchpoints: (n.grounding?.touchpoints ?? []).map(
            (t) => t.path + (t.symbol ? ` › ${t.symbol}` : "") + (t.planned ? " (new)" : ""),
          ),
          acceptance: n.acceptance.map((c) => c.text),
        })),
      };
    }),
    edges: session.edges,
    cutScreen: session.cutScreen(),
    cutCount: session.cutNodeIds.size,
    deliveries: session.space.deliveries.map((d) => ({
      id: d.id,
      page: session.deliveryPage(d.id) ?? "",
      accepted: !!d.acceptedAt,
      ...(d.url ? { url: d.url } : {}),
      ...(d.undelivered?.length ? { undelivered: d.undelivered } : {}),
    })),
    ...(message ? { message } : {}),
  };
}

export class SpacePanel implements vscodeTypes.Disposable {
  private _panel: vscodeTypes.WebviewPanel | undefined;
  private _disposables: vscodeTypes.Disposable[] = [];

  async show(
    extensionUri: vscodeTypes.Uri,
    session: TandemSession,
  ): Promise<void> {
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
        let note: string | undefined;
        if (msg.action === "capture" && msg.text) {
          this._push(session, "Grounding your ask…");
          const r = await session.capture(msg.text);
          note = r.ok ? undefined : r.reason;
        } else if (msg.action === "toggle-cut" && msg.changeIds) {
          session.toggleCut(msg.changeIds);
        } else if (msg.action === "sign-cut") {
          const r = session.signCut();
          note = r.ok ? "Cut signed." : r.reason;
        } else if (msg.action === "accept-delivery" && msg.deliveryId) {
          const r = await session.acceptDelivery(msg.deliveryId);
          note = r.ok ? undefined : r.reason;
        } else if (msg.action === "reground") {
          this._push(session, "Re-grounding…");
          await session.reground();
        }
        this._push(session, note);
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
