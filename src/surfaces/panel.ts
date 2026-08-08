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
  stepId?: string;
  page?: number;
  into?: string;
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
  const byId = new Map(session.space.nodes.map((n) => [n.id, n]));
  return {
    kind: "space",
    running: session.running,
    // A space derived before the model existed cannot be read as subjects
    // and claims. It stays readable; new work starts in a new space.
    legacy:
      session.space.nodes.length > 0 && !(session.space.subjects ?? []).length
        ? "This space was thought through before subjects and claims existed. Its promises are kept and readable, but new work starts in a new thinking space — paste your asks there."
        : undefined,
    repoName: session.repoName,
    activity: session.activity,
    lastAnswer: session.lastAnswer,
    pendingCheck: session.pendingCheck,
    runNote: session.runNote,
    grounding: session.groundingView(),
    asks: session.space.asks.map((a) => ({ id: a.id, text: a.text })),
    signedTeps: session.space.cuts.filter((c) => c.signature).length,
    runLog: session.logView(),
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
    impacts: (session.space.impacts ?? []).map((im) => ({
      id: im.id,
      decision: im.decision,
      askText: session.space.asks.find((a) => a.id === im.askId)?.text ?? im.askId,
      affected: session.space.nodes.filter((n) => n.serves.includes(im.askId)).length,
    })),
    // Graph 1 — the model, in the human's words. Graph 2 — the promises,
    // each under the claim it makes true.
    subjects: (session.space.subjects ?? []).map((s) => {
      const claims = (session.space.claims ?? []).filter((c) => c.subjectId === s.id);
      const rules = (session.space.rules ?? []).filter((r) => r.governs.includes(s.id));
      return {
        id: s.id,
        name: s.name,
        rules: rules.map((r) => ({ id: r.id, text: r.text })),
        thinking: session.groundingView().find((g) => g.askId === s.id),
        claims: claims.map((c) => {
          const promises = session.space.nodes.filter((n) => n.servesClaim === c.id);
          return {
            id: c.id,
            text: c.text,
            why: c.why,
            fromAsk: session.space.asks.find((a) => a.id === c.fromAsk)?.text ?? "",
            promises: promises.map((n) => ({
              id: n.id,
              text: n.sentence,
              file: (n.grounding?.touchpoints ?? []).map((t) => t.path).join(", "),
              checks: n.acceptance.map((a) =>
                a.kind === "assessment" ? `${a.text} (by review)` : a.text,
              ),
              needs: n.needs,
              inCut: session.cutNodeIds.has(n.id),
              stale: session.stale.has(n.id),
              tep: session.space.cuts.find(
                (cu) => cu.signature && cu.changeIds.includes(n.id),
              )?.tepId,
            })),
          };
        }),
      };
    }),
    rules: (session.space.rules ?? []).map((r) => ({
      id: r.id,
      text: r.text,
      scope: r.scope,
      governs: r.governs.length,
      fromAsk: session.space.asks.find((a) => a.id === r.fromAsk)?.text ?? "",
    })),
    // A promise attached to no claim is scope creep — named, never hidden.
    orphans: session.space.nodes
      .filter((n) => !n.servesClaim)
      .map((n) => ({ id: n.id, text: n.sentence })),
    modelFailure: session.modelFailure
      ? { reason: session.modelFailure.reason, sentences: session.modelFailure.texts.length }
      : undefined,
    pendingModel: session.pendingModel
      ? {
          subjects: session.pendingModel.model.subjects.map((s) => ({
            name: s.name,
            claims: s.claims.map((c) => ({ text: c.text, why: c.why })),
          })),
          rules: session.pendingModel.model.rules.map((r) => ({ text: r.text, scope: r.scope })),
          missing: session.pendingModel.missing.map(
            (n) => session.pendingModel!.askIds[n - 1] ?? `sentence ${n}`,
          ),
        }
      : undefined,
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
  } else if (msg.action === "answer-worker" && msg.unitId && msg.text) {
    session.answerWorker(msg.unitId, msg.text);
  } else if (msg.action === "accept-model") {
    push("Recording the model…");
    const r = await session.acceptModel();
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "revise-model" && msg.kind && msg.page !== undefined) {
    session.reviseModel({ kind: msg.kind as never, index: msg.page });
  } else if (
    msg.action === "rename-subject" ||
    msg.action === "merge-subject" ||
    msg.action === "split-claim" ||
    msg.action === "move-claim" ||
    msg.action === "promote-claim" ||
    msg.action === "dismiss-promise" ||
    msg.action === "retire-rule"
  ) {
    const r = session.editModel({
      kind: msg.action as never,
      id: msg.unitId ?? "",
      ...(msg.into ? { into: msg.into } : {}),
      ...(msg.text ? { text: msg.text } : {}),
    });
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "retry-model") {
    push("Reading your list again…");
    const r = await session.retryModel();
    note = r.ok ? undefined : r.reason;
  } else if (msg.action === "read-log") {
    session.readLog(msg.stepId ?? null, msg.page);
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
