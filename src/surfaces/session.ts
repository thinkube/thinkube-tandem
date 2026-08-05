/**
 * The v2 session: owns one space, accepts exactly the registered actions,
 * and persists every change to the store as both faces. Between the two
 * gates it runs the machinery itself: signing a cut starts the run
 * (worktree, blind probes, builders, proofs, forge delivery) and accepting
 * a delivery merges it. The panel is a thin shell around postMessage.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { emptySpace, Space, Unit } from "../core/schema";
import { addAsk } from "../core/intent";
import { formUnits, unitEdges } from "../core/cluster";
import { readStamp, SourceStamp } from "../core/stamp";
import { staleChangeIds } from "../core/stale";
import { runGrounding } from "../derive/ground";
import { RoundDeps } from "../derive/round";
import { signCut, acceptDelivery } from "../gates/sign";
import { renderCutScreen, renderDeliveryPage } from "../gates/render";
import { Forge } from "../dispatch/forge";
import { tepSlices } from "../dispatch/adapter";
import { dispatchTep, DispatchOutcome } from "../run/dispatch";
import { RunState } from "../run/state";
import {
  approvalContentHash,
  approvalStatus,
  loadOrCreateApprovalSecret,
  mintApproval,
} from "../engine/approvalToken";
import { ApprovalStore, createApprovalStore } from "../engine/approvalStore";

type SessionAction =
  | { action: "capture"; text: string }
  | { action: "select-unit"; unitId: string }
  | { action: "toggle-cut"; changeIds: string[] }
  | { action: "sign-cut" }
  | { action: "accept-delivery"; deliveryId: string }
  | { action: "reground" }
  | { action: "flip-face"; artifactId: string };

/** Every action name the session accepts — the reachability test's ground truth. */
export const SESSION_ACTIONS: string[] = [
  "capture",
  "select-unit",
  "toggle-cut",
  "sign-cut",
  "accept-delivery",
  "reground",
  "flip-face",
  "answer-worker",
  "stop-run",
  "accept-question",
  "pin",
];

export interface SessionDeps {
  round: RoundDeps;
  storeDir: string;
  /** Machine-local secret + token store home (globalStorage in the host). */
  storageDir: string;
  now: () => string;
  /** Author identity (git user.name), for author-scoped TEP numbers. */
  author?: string;
  /** The forge for this repo; absent means deliveries stay local branches. */
  forge?: Forge;
  suiteCommand?: string[];
  ground?: typeof runGrounding;
  dispatch?: typeof dispatchTep;
  readCurrentStamp?: () => Promise<SourceStamp[]>;
  /** Called after every state change so the panel can re-push. */
  onChanged?: (message?: string) => void;
}

export class TandemSession {
  space: Space = emptySpace();
  private _approvals: ApprovalStore;
  private _secret: Buffer;
  units: Unit[] = [];
  edges: { from: string; to: string }[] = [];
  cutNodeIds = new Set<string>();
  stale = new Set<string>();
  running = false;
  runState: RunState | undefined;

  constructor(private deps: SessionDeps) {
    this._approvals = createApprovalStore(deps.storageDir);
    this._secret = loadOrCreateApprovalSecret(deps.storageDir);
    this.load();
  }

  /** The signed pair's content: the render the human read + the grounded
   *  member hash — what the minted token binds. */
  private tepContentHash(cut: { changeIds: string[]; tepId?: string }): string {
    const render = renderCutScreen(this.space, { id: "pair", changeIds: cut.changeIds });
    const sig = signCut(this.space, { id: "pair", changeIds: cut.changeIds }, "t", "x");
    const grounding = sig.ok ? sig.cut.signature!.groundingHash : "";
    return approvalContentHash(`${render}\u0000${grounding}`);
  }

  /** Token verdict for a minted TEP — dispatch refuses anything but approved. */
  tepApproval(tepId: string): { approved: boolean; reason?: string } {
    const cut = this.space.cuts.find((c) => c.tepId === tepId);
    if (!cut) return { approved: false, reason: "unknown TEP" };
    const status = approvalStatus(this._approvals.get(`tep:${tepId}`), {
      subjectKey: `tep:${tepId}`,
      contentHash: this.tepContentHash(cut),
      secret: this._secret,
    });
    return status.ok
      ? { approved: true }
      : { approved: false, reason: status.reason };
  }

  private changed(message?: string): void {
    this.persist();
    this.deps.onChanged?.(message);
  }

  /** Capture an ask verbatim, ground it, recluster, refresh staleness. */
  async capture(text: string): Promise<{ ok: boolean; reason?: string }> {
    const r = addAsk(this.space, text, this.deps.now());
    if (!r.ok) return { ok: false, reason: r.reason };
    this.space = r.space;
    const ground = this.deps.ground ?? runGrounding;
    const grounded = await ground(this.deps.round, r.added, {
      nextIndex: this.space.nodes.length + 1,
      decisions: this.decisionsInForce(),
    });
    const questions = grounded.questions.map((q, i) => ({
      ...q,
      id: `q-${this.space.questions.length + i + 1}`,
    }));
    this.space = {
      ...this.space,
      nodes: [...this.space.nodes, ...grounded.changes],
      questions: [...this.space.questions, ...questions],
    };
    this.recluster();
    await this.refreshStaleness();
    const qNote = questions.length ? ` ${questions.length} question(s) need you.` : "";
    this.changed(
      grounded.changes.length
        ? `Grounded into ${grounded.changes.length} change(s).${qNote}`
        : `The round returned no changes — the ask is captured; re-ground any time.${qNote}`,
    );
    return { ok: true };
  }

  /** Re-derive every ask that has stale nodes; fresh grounding replaces old. */
  async reground(): Promise<void> {
    await this.refreshStaleness();
    const staleAsks = new Set(
      this.space.nodes
        .filter((n) => this.stale.has(n.id))
        .flatMap((n) => n.serves),
    );
    if (staleAsks.size === 0) return;
    const ground = this.deps.ground ?? runGrounding;
    for (const askId of staleAsks) {
      const ask = this.space.asks.find((a) => a.id === askId);
      if (!ask) continue;
      const keep = this.space.nodes.filter((n) => !n.serves.includes(askId));
      const fresh = await ground(this.deps.round, ask, {
        nextIndex: this.space.nodes.length + 1,
        decisions: this.decisionsInForce(),
      });
      this.space = { ...this.space, nodes: [...keep, ...fresh.changes] };
    }
    this.recluster();
    await this.refreshStaleness();
    this.changed("Re-grounded the stale changes.");
  }

  /** The accepted answers governing every later derivation, in force. */
  decisionsInForce(): string[] {
    return this.space.questions
      .filter((q) => q.decided)
      .map((q) => q.decided!.text);
  }

  /**
   * The human's accept on a question: the recommendation (or their edited
   * wording) becomes a DECISION — recorded, injected into every later
   * round, and the affected ask re-grounds under it immediately.
   */
  async acceptQuestion(
    questionId: string,
    editedText?: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    const q = this.space.questions.find((x) => x.id === questionId);
    if (!q) return { ok: false, reason: `no question '${questionId}'` };
    if (q.decided) return { ok: false, reason: "already decided" };
    const text = (editedText ?? q.recommendation ?? "").trim();
    if (!text) return { ok: false, reason: "a decision cannot be empty" };
    this.space = {
      ...this.space,
      questions: this.space.questions.map((x) =>
        x.id === questionId ? { ...x, decided: { text, at: this.deps.now() } } : x,
      ),
    };
    this.changed(`Decision recorded — re-grounding the ask under it…`);
    const ask = this.space.asks.find((a) => a.id === q.askId);
    if (ask) {
      const ground = this.deps.ground ?? runGrounding;
      const keep = this.space.nodes.filter((n) => !n.serves.includes(ask.id));
      const fresh = await ground(this.deps.round, ask, {
        nextIndex: this.space.nodes.length + 1,
        decisions: this.decisionsInForce(),
      });
      this.space = { ...this.space, nodes: [...keep, ...fresh.changes] };
      this.recluster();
    }
    this.changed("Decision in force.");
    return { ok: true };
  }

  /** A human pin: merge or split the pair's units — outranks the coupling. */
  pin(kind: "together" | "apart", a: string, b: string): void {
    this.space = {
      ...this.space,
      pins: [...this.space.pins, { kind, changeIds: [a, b] }],
    };
    this.recluster();
    this.changed(kind === "together" ? "Pinned into one slice." : "Split apart.");
  }

  async refreshStaleness(): Promise<void> {
    const read =
      this.deps.readCurrentStamp ??
      (async () => [await readStamp(this.deps.round.repoRoot)]);
    this.stale = staleChangeIds(this.space, await read());
  }

  recluster(): void {
    this.units = formUnits(this.space.nodes, this.space.pins);
    this.edges = unitEdges(this.space.nodes, this.units);
    this.space = { ...this.space, units: this.units };
  }

  toggleCut(changeIds: string[]): void {
    for (const id of changeIds)
      if (this.cutNodeIds.has(id)) this.cutNodeIds.delete(id);
      else this.cutNodeIds.add(id);
    this.changed();
  }

  cutScreen(): string {
    return renderCutScreen(this.space, {
      id: `cut-${this.space.cuts.length + 1}`,
      changeIds: [...this.cutNodeIds],
    });
  }

  /** Gate 1. On success the run starts — nothing between the gates is human. */
  signCut(): { ok: boolean; reason?: string } {
    const cut = {
      id: `cut-${this.space.cuts.length + 1}`,
      changeIds: [...this.cutNodeIds],
    };
    const r = signCut(this.space, cut, this.deps.now(), this.deps.author ?? "user");
    if (!r.ok) return r;
    this.space = { ...this.space, cuts: [...this.space.cuts, r.cut] };
    // The human's click IS the mint (this message only arrives from the
    // panel): a content-bound token in the machine-local store — the same
    // no-expiry, edit-re-arms discipline the engine's gates verify.
    this._approvals.put(
      `tep:${r.cut.tepId}`,
      mintApproval(`tep:${r.cut.tepId}`, this.tepContentHash(r.cut), Date.now(), this._secret),
    );
    this.cutNodeIds.clear();
    this.changed(`${r.cut.tepId} minted — the run is starting.`);
    void this.execute(r.cut.id);
    return { ok: true };
  }

  /** The run between the gates, driven by the imported engine. */
  async execute(cutId: string): Promise<DispatchOutcome | undefined> {
    const cut = this.space.cuts.find((c) => c.id === cutId);
    if (!cut || this.running) return undefined;
    const approval = cut.tepId ? this.tepApproval(cut.tepId) : { approved: false, reason: "unsigned" };
    if (!approval.approved) {
      this.changed(`Dispatch refused: ${approval.reason} — re-sign the cut.`);
      return undefined;
    }
    if (!this.deps.forge) {
      this.changed("No forge is configured — the cut stays signed, undelivered.");
      return undefined;
    }
    this.running = true;
    this.runState = new RunState(() => this.deps.onChanged?.());
    this.changed(`Building ${cut.tepId ?? cutId}…`);
    try {
      const slices = tepSlices({
        space: this.space,
        cut,
        spaceName: path.basename(this.deps.storeDir),
      });
      const dispatch = this.deps.dispatch ?? dispatchTep;
      const outcome = await dispatch(
        {
          repoRoot: this.deps.round.repoRoot,
          model: this.deps.round.model,
          suiteCommand: this.deps.suiteCommand ?? ["npm", "test"],
          forge: this.deps.forge,
          state: this.runState,
          spaceName: path.basename(this.deps.storeDir),
        },
        this.space,
        cut,
        slices,
      );
      if (outcome.delivery) {
        this.space = {
          ...this.space,
          deliveries: [
            ...this.space.deliveries,
            {
              ...outcome.delivery,
              ...(outcome.url ? { url: outcome.url } : {}),
              ...(outcome.undelivered.length
                ? { undelivered: outcome.undelivered }
                : {}),
            },
          ],
        };
        this.changed(`Delivery ready on ${outcome.delivery.branch}.`);
      } else {
        this.changed(`The run refused: ${outcome.refusals.join("; ")}`);
      }
      return outcome;
    } finally {
      this.running = false;
    }
  }

  /** Answer a parked worker — the oracle's door on the run view. */
  answerWorker(unitId: string, text: string): boolean {
    const ok = this.runState?.answer(unitId, text) ?? false;
    if (ok) this.changed(`Answered ${unitId}.`);
    return ok;
  }

  /** Stop the run: abort every live worker; the run drains and reports. */
  stopRun(): number {
    const n = this.runState?.halt() ?? 0;
    this.changed(n ? `Stopped — ${n} worker(s) aborted.` : "Nothing to stop.");
    return n;
  }

  deliveryPage(deliveryId: string): string | undefined {
    const d = this.space.deliveries.find((x) => x.id === deliveryId);
    return d ? renderDeliveryPage(this.space, d) : undefined;
  }

  /** Gate 2. Acceptance merges on the forge; refused without green proof. */
  async acceptDelivery(
    deliveryId: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    const d = this.space.deliveries.find((x) => x.id === deliveryId);
    if (!d) return { ok: false, reason: `no delivery '${deliveryId}'` };
    const r = acceptDelivery(d, this.deps.now());
    if (!r.ok) return r;
    if (this.deps.forge && d.url) {
      try {
        await this.deps.forge.merge(d.url);
      } catch (err) {
        return {
          ok: false,
          reason: `the forge refused the merge: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
    this.space = {
      ...this.space,
      deliveries: this.space.deliveries.map((x) =>
        x.id === deliveryId ? r.delivery : x,
      ),
    };
    this.changed("Accepted and merged.");
    return { ok: true };
  }

  /** Both faces on disk: the data, and the abstracts rendered from it. */
  persist(): void {
    fs.mkdirSync(this.deps.storeDir, { recursive: true });
    fs.writeFileSync(
      path.join(this.deps.storeDir, "space.json"),
      JSON.stringify({ space: this.space, cut: [...this.cutNodeIds] }, null, 2),
    );
  }

  load(): void {
    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(this.deps.storeDir, "space.json"), "utf8"),
      ) as { space: Space; cut: string[] };
      this.space = raw.space;
      this.cutNodeIds = new Set(raw.cut);
      this.recluster();
      void this.refreshStaleness().then(() => this.deps.onChanged?.());
    } catch {
      this.space = emptySpace();
    }
  }
}
