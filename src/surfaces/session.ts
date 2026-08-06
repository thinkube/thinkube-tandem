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
import { DigestStore, runDerivationPipeline } from "../derive/pipeline";
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
import { acceptOrder } from "../engine/acceptOrder";
import { WorkerModelConfig } from "../engine/workerModel";
import { scanForSecrets } from "../engine/store/frontmatter";
import { runReadRound } from "../derive/round";

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
  "panic",
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
  ground?: typeof runDerivationPipeline;
  dispatch?: typeof dispatchTep;
  readCurrentStamp?: () => Promise<SourceStamp[]>;
  /** Retire a merged TEP's worktrees (best-effort; injectable for tests). */
  retire?: (tepId: string) => Promise<void>;
  /** Per-role worker models (judgment raised above the sonnet base). */
  workerModel?: WorkerModelConfig;
  /** Frontier width for the run (v1 default 4). */
  maxConcurrent?: number;
  /** The docs gate blocks accepts by default; advisory is the escape hatch. */
  docsGateMode?: "blocking" | "advisory";
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

  /** Per-ask context digests, file-backed beside the space. */
  private digestStore(): DigestStore {
    const dir = path.join(this.deps.storeDir, "digests");
    return {
      load: (askId) => {
        try {
          return fs.readFileSync(path.join(dir, `${askId}.md`), "utf8");
        } catch {
          return undefined;
        }
      },
      save: (askId, text) => {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${askId}.md`), text);
      },
    };
  }

  /** Capture an ask verbatim, ground it, recluster, refresh staleness. */
  async capture(text: string): Promise<{ ok: boolean; reason?: string }> {
    const r = addAsk(this.space, text, this.deps.now());
    if (!r.ok) return { ok: false, reason: r.reason };
    this.space = r.space;
    const ground = this.deps.ground ?? runDerivationPipeline;
    const grounded = await ground(this.deps.round, r.added, {
      nextIndex: this.space.nodes.length + 1,
      decisions: this.decisionsInForce(),
      digestStore: this.digestStore(),
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
    const ground = this.deps.ground ?? runDerivationPipeline;
    for (const askId of staleAsks) {
      const ask = this.space.asks.find((a) => a.id === askId);
      if (!ask) continue;
      const keep = this.space.nodes.filter((n) => !n.serves.includes(askId));
      const fresh = await ground(this.deps.round, ask, {
        nextIndex: this.space.nodes.length + 1,
        decisions: this.decisionsInForce(),
        digestStore: this.digestStore(),
      });
      this.space = { ...this.space, nodes: [...keep, ...fresh.changes] };
    }
    this.recluster();
    await this.refreshStaleness();
    this.changed("Re-grounded the stale changes.");
  }

  /** Wipe everything DERIVED and start thinking again: asks survive (your
   *  words are never machine-deleted), deliveries survive (history), but
   *  nodes, questions, pins and unsigned cuts go. Refused once any TEP was
   *  signed — a frozen scope is not erasable. Confirmation is surface-side. */
  panic(): { ok: boolean; reason?: string } {
    if (this.space.cuts.some((c) => c.signature))
      return { ok: false, reason: "a TEP was already signed in this space — panic is refused after a freeze" };
    if (this.running) return { ok: false, reason: "a run is in flight — stop it first" };
    this.space = {
      ...this.space,
      nodes: [],
      questions: [],
      pins: [],
      cuts: [],
    };
    this.cutNodeIds = new Set();
    this.stale = new Set();
    this.recluster();
    this.changed("Cleared the derived thinking — your asks are untouched; re-ground when ready.");
    return { ok: true };
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
      const ground = this.deps.ground ?? runDerivationPipeline;
      const keep = this.space.nodes.filter((n) => !n.serves.includes(ask.id));
      const fresh = await ground(this.deps.round, ask, {
        nextIndex: this.space.nodes.length + 1,
        decisions: this.decisionsInForce(),
        digestStore: this.digestStore(),
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
      let slices;
      try {
        slices = tepSlices({
          space: this.space,
          cut,
          spaceName: path.basename(this.deps.storeDir),
        });
      } catch (err) {
        this.running = false;
        this.changed(
          `Dispatch refused: ${err instanceof Error ? err.message : String(err)}`,
        );
        return undefined;
      }
      const dispatch = this.deps.dispatch ?? dispatchTep;
      const outcome = await dispatch(
        {
          repoRoot: this.deps.round.repoRoot,
          model: this.deps.round.model,
          workerModel: this.deps.workerModel,
          concurrency: this.deps.maxConcurrent,
          suiteCommand: this.deps.suiteCommand ?? ["npm", "test"],
          forge: this.deps.forge,
          state: this.runState,
          spaceName: path.basename(this.deps.storeDir),
          storeDir: this.deps.storeDir,
          supervisorRound: runReadRound,
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

  /** Gate 2. Acceptance in the engine's canonical order — merge → stamp →
   *  retire (best-effort) — refused without green proof BEFORE the merge. */
  async acceptDelivery(
    deliveryId: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    const d = this.space.deliveries.find((x) => x.id === deliveryId);
    if (!d) return { ok: false, reason: `no delivery '${deliveryId}'` };
    const r = acceptDelivery(d, this.deps.now(), this.deps.docsGateMode ?? "blocking");
    if (!r.ok) return r;
    const cut = this.space.cuts.find((c) => c.id === d.cutId);
    const tepId = cut?.tepId;
    try {
      await acceptOrder({
        merge: async () => {
          if (this.deps.forge && d.url) await this.deps.forge.merge(d.url);
          return { merged: !!(this.deps.forge && d.url) };
        },
        stamp: async () => {
          this.space = {
            ...this.space,
            deliveries: this.space.deliveries.map((x) =>
              x.id === deliveryId ? r.delivery : x,
            ),
          };
        },
        retire: async () => {
          if (tepId && this.deps.retire) await this.deps.retire(tepId);
        },
      });
    } catch (err) {
      return {
        ok: false,
        reason: `the forge refused the merge: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    this.changed("Accepted and merged.");
    return { ok: true };
  }

  /** Both faces on disk: the data, and the abstracts rendered from it.
   *  Every store write runs the secret scan — a hit refuses the write
   *  (the state stays live in memory; the message names the leak). */
  persist(): void {
    const body = JSON.stringify(
      { space: this.space, cut: [...this.cutNodeIds] },
      null,
      2,
    );
    const secrets = scanForSecrets(body);
    if (secrets.length) {
      this.deps.onChanged?.(
        `REFUSED to write the store: secret-shaped content detected (${secrets
          .map((m) => m.pattern)
          .join(", ")}) — remove it from the ask/changes first.`,
      );
      return;
    }
    fs.mkdirSync(this.deps.storeDir, { recursive: true });
    fs.writeFileSync(path.join(this.deps.storeDir, "space.json"), body);
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
