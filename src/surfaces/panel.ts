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

export interface PanelHostHooks {
  /** Host-side gesture: the QuickPick that rebinds the space to a repo. */
  onSwitchRepo?: () => Promise<void>;
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
}

/**
 * Group the machine's pairwise suggestions into families: the unit each
 * suggestion wants to grow, and everything it wants folded into it. A unit
 * named by several suggestions is ONE decision, not one per pair.
 */
function mergeFamilies(
  session: TandemSession,
): { anchorId: string; joinerIds: string[] }[] {
  const proposals = session.space.proposals ?? [];
  const size = (id: string) =>
    session.units.find((u) => u.id === id)?.changeIds.length ?? 0;
  const families = new Map<string, string[]>();
  const taken = new Set<string>();
  // Biggest unit first: the one the machine wants to grow anchors its family.
  const anchors = [...new Set(proposals.flatMap((p) => [p.a, p.b]))].sort(
    (x, y) => size(y) - size(x),
  );
  for (const anchor of anchors) {
    const joiners = proposals
      .filter((p) => p.a === anchor || p.b === anchor)
      .map((p) => (p.a === anchor ? p.b : p.a))
      .filter((id) => !taken.has(id) && id !== anchor);
    if (!joiners.length || taken.has(anchor)) continue;
    taken.add(anchor);
    for (const j of joiners) taken.add(j);
    families.set(anchor, joiners);
  }
  return [...families.entries()].map(([anchorId, joinerIds]) => ({ anchorId, joinerIds }));
}

/** A card head is one line: a long sentence is clipped, never a paragraph. */
const TITLE_CLIP = 64;
function shorten(text: string): string {
  return text.length > TITLE_CLIP ? `${text.slice(0, TITLE_CLIP - 1).trimEnd()}…` : text;
}
function shortenWords(text: string, words: number): string {
  const parts = text.split(/\s+/);
  return parts.slice(0, words).join(" ") + (parts.length > words ? "…" : "");
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
    repoName: session.repoName,
    activity: session.activity,
    lastAnswer: session.lastAnswer,
    pendingCheck: session.pendingCheck,
    runNote: session.runNote,
    grounding: session.groundingView(),
    asks: session.space.asks.map((a) => ({ id: a.id, text: a.text })),
    signedTeps: session.space.cuts.filter((c) => c.signature).length,
    // The chart names each worker by the slice it builds, in the words the
    // human named it — the worker id stays available underneath.
    run: (() => {
      const v = session.runState?.view();
      if (!v) return undefined;
      return {
        ...v,
        units: v.units.map((u) => {
          const title = session.units.find((x) => x.id === u.slice)?.abstract?.title;
          return title ? { ...u, sliceTitle: title } : u;
        }),
      };
    })(),
    // A question belongs to an ask, and the ask has cards on the map: both
    // ride along so a recommendation is never a floating sentence.
    questions: session.space.questions
      .filter((q) => !q.decided)
      .map((q) => {
        const idx = session.space.asks.findIndex((a) => a.id === q.askId);
        const ask = idx >= 0 ? session.space.asks[idx] : undefined;
        const serving = new Set(
          session.space.nodes.filter((n) => n.serves.includes(q.askId)).map((n) => n.id),
        );
        return {
          id: q.id,
          text: q.text,
          recommendation: q.recommendation,
          ...(ask ? { askLabel: `ask ${idx + 1} — ${shortenWords(ask.text, 7)}` } : {}),
          cards: session.units
            .filter((u) => u.changeIds.some((id) => serving.has(id)))
            .map((u) => ({
              id: u.id,
              title: u.abstract?.title ?? shorten(byId.get(u.changeIds[0])?.sentence ?? u.id),
            })),
        };
      }),
    decisions: session.space.questions
      .filter((q) => !!q.decided)
      .map((q) => q.decided!.text),
    // The machine proposes PAIRS, but a unit it wants to grow is ONE
    // decision: every suggestion touching a unit is shown as its family,
    // with the size the merged slice would reach.
    proposals: mergeFamilies(session).map((fam) => {
      const describe = (id: string) => {
        const u = session.units.find((x) => x.id === id);
        const members = (u?.changeIds ?? [])
          .map((cid) => byId.get(cid)?.sentence)
          .filter((x): x is string => !!x);
        return {
          title: u?.abstract?.title ?? members[0] ?? id,
          count: members.length,
          members,
        };
      };
      const anchor = describe(fam.anchorId);
      const joiners = fam.joinerIds.map(describe);
      return {
        id: fam.anchorId,
        anchor,
        joiners,
        resultCount: anchor.count + joiners.reduce((n, j) => n + j.count, 0),
      };
    }),
    impacts: (session.space.impacts ?? []).map((im) => ({
      id: im.id,
      decision: im.decision,
      askText: session.space.asks.find((a) => a.id === im.askId)?.text ?? im.askId,
      affected: session.space.nodes.filter((n) => n.serves.includes(im.askId)).length,
    })),
    units: session.units.map((u) => {
      const signedIn = session.space.cuts.find(
        (c) => c.signature && u.changeIds.some((id) => c.changeIds.includes(id)),
      );
      const nodes = u.changeIds
        .map((id) => byId.get(id))
        .filter((n): n is NonNullable<typeof n> => !!n);
      const first = nodes[0]?.sentence ?? u.id;
      const askIds = new Set(nodes.flatMap((n) => n.serves));
      const firstAskIdx = session.space.asks.findIndex((a) => askIds.has(a.id));
      const firstAsk = firstAskIdx >= 0 ? session.space.asks[firstAskIdx] : undefined;
      return {
        id: u.id,
        askLabel: firstAsk
          ? `ask ${firstAskIdx + 1} — ${shortenWords(firstAsk.text, 7)}`
          : "unassigned",
        // Two faces, one source: the card shows the naming round's rendered
        // title + decision-sized abstract; the machine face (touchpoints,
        // proofs) stays one gesture away behind the flip. Fallback title
        // always: an unnamed unit shows its first member sentence, no body.
        ...(u.abstract?.text ? { abs: u.abstract.text } : {}),
        title: u.abstract?.title ?? shorten(first),
        ...(u.abstract ? {} : { fullTitle: first }),
        count: nodes.length,
        changeIds: u.changeIds,
        island: island.get(u.id) ?? 0,
        inCut: u.changeIds.every((id) => session.cutNodeIds.has(id)) && u.changeIds.length > 0,
        ...(signedIn?.tepId ? { tep: signedIn.tepId } : {}),
        stale: u.changeIds.some((id) => session.stale.has(id)),
        coverage: {
          covered: nodes.filter((n) => n.acceptance.length > 0).length,
          total: nodes.length,
        },
        openQuestions: session.space.questions.filter(
          (q) => !q.decided && askIds.has(q.askId),
        ).length,
        nodes: nodes.map((n) => ({
          id: n.id,
          sentence: n.sentence,
          touchpoints: (n.grounding?.touchpoints ?? []).map(
            (t) => t.path + (t.symbol ? ` › ${t.symbol}` : "") + (t.planned ? " (new)" : ""),
          ),
          acceptance: n.acceptance.map((c) => (c.kind === "assessment" ? `${c.text} (by review)` : c.text)),
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

async function handleInbound(
  session: TandemSession,
  msg: InboundAction,
  push: (message?: string) => void,
  hooks?: PanelHostHooks,
  pushDraft: (draft: { kind: string; items?: string[] }, text: string) => void = () => {},
): Promise<void> {
  if (msg.action === "switch-repo") {
    await hooks?.onSwitchRepo?.();
    return;
  }
  let note: string | undefined;
  if (msg.action === "classify" && msg.text) {
    // Draft classification — records NOTHING; the webview renders the tag.
    const draft = await session.classifyDraft(msg.text);
    push(undefined);
    void session; // the draft rides its own message, not the space push
    return pushDraft(draft, msg.text);
  } else if (msg.action === "capture" && msg.text) {
    const r = await session.capture(msg.text, msg.kind as never);
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "capture-many" && msg.items?.length) {
    const r = await session.captureMany(msg.items);
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "cancel-capture") {
    session.cancelCapture();
    note = "Cancelled.";
  } else if (msg.action === "toggle-cut" && msg.changeIds) {
    session.toggleCut(msg.changeIds);
  } else if (msg.action === "sign-cut") {
    const r = session.signCut();
    note = r.ok ? "Cut signed." : r.reason;
  } else if (msg.action === "accept-delivery" && msg.deliveryId) {
    const r = await session.acceptDelivery(msg.deliveryId);
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "accept-question" && msg.questionId) {
    push("Recording the decision…");
    const r = await session.acceptQuestion(msg.questionId, msg.text);
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "pin" && msg.pinKind && msg.changeIds?.length === 2) {
    session.pin(msg.pinKind as "together" | "apart", msg.changeIds[0], msg.changeIds[1]);
  } else if (msg.action === "answer-worker" && msg.unitId && msg.text) {
    session.answerWorker(msg.unitId, msg.text);
  } else if (msg.action === "stop-run") {
    session.stopRun();
  } else if (msg.action === "accept-merge" && msg.unitId) {
    const r = session.decideMerge(msg.unitId, true);
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "reject-merge" && msg.unitId) {
    const r = session.decideMerge(msg.unitId, false);
    note = r.ok ? undefined : r.reason;
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
  } else if (msg.action === "reground") {
    push("Re-grounding…");
    await session.reground();
  }
  push(note);
}

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
            (draft, text) =>
              void this._panel?.webview.postMessage({ kind: "draft", guessed: draft.kind, items: draft.items, text }),
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
