/**
 * The v2 session: owns one space, accepts exactly the registered actions,
 * and persists every change to the store as both faces. Between the two
 * gates it runs the machinery itself: signing a cut starts the run
 * (worktree, blind probes, builders, proofs, forge delivery) and accepting
 * a delivery merges it. The panel is a thin shell around postMessage.
 */
import * as path from "node:path";
import { emptySpace, Space, Unit } from "../core/schema";
import { addAsk } from "../core/intent";
import { advanceSpaceMembership, mergeVerdict, unitEdges } from "../core/suggestions";
import { readStamp } from "../core/stamp";
import { staleChangeIds } from "../core/stale";
import { DigestStore, runDerivationPipeline } from "../derive/pipeline";
import { signCut, acceptDelivery } from "../gates/sign";
import { renderCutScreen, renderDeliveryPage } from "../gates/render";
import { planScopes, refuseAnchorless } from "../dispatch/scopes";
import { dispatchScopePlan } from "../dispatch/scopeRun";
import { DispatchOutcome } from "../run/dispatch";
import { RunState } from "../run/state";
import { loadOrCreateApprovalSecret, mintApproval } from "../engine/approvalToken";
import { ApprovalStore, createApprovalStore } from "../engine/approvalStore";
import { acceptOrder } from "../engine/acceptOrder";
import { tepApprovalOf, tepContentHash } from "../gates/approval";
import { classifyUtterance, splitList, UtteranceKind } from "../derive/classify";
import { nameUnits } from "../derive/name";
import { proposeCheck as proposeCheckRound } from "../derive/checks";
import { addWithNeeds, removeWithDependents } from "../core/cutClosure";
import { clearAbstractsServingAsk, renderUnitAbstracts } from "./naming";
import { addCheckFlow, answerQuestionFlow, decideQuestionFlow, panicFlow, rederiveAskFlow, statementFlow } from "./captureFlows";
import { loadSpace, makeDigestStore, persistSpace } from "./sessionStore";
import { SessionDeps } from "./sessionDeps";
export type { SessionDeps } from "./sessionDeps";
export { SESSION_ACTIONS } from "./affordances";

/** Every action name the session accepts — the reachability test's ground truth. */


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
  /** Liveness: what is being worked on right now. */
  activity: { label: string; current: number; total: number; askId?: string } | undefined;
  /** The latest in-board answer to a question. */
  lastAnswer: { question: string; answer: string } | undefined;
  runNote: string | undefined; // why the last build did not start — shown ON the flow tab
  private _captureAbort: AbortController | undefined;

  constructor(private deps: SessionDeps) {
    this._approvals = createApprovalStore(deps.storageDir);
    this._secret = loadOrCreateApprovalSecret(deps.storageDir);
    this.load();
  }

  private get author(): string {
    return this.deps.author ?? "user";
  }

  /** Token verdict for a minted TEP. */
  tepApproval(tepId: string): { approved: boolean; reason?: string } {
    return tepApprovalOf(this.space, this._approvals, this._secret, tepId);
  }

  get repoName(): string {
    return this.deps.scope?.label ?? path.basename(this.deps.round.repoRoot);
  }

  private changed(message?: string): void {
    this.persist();
    this.deps.onChanged?.(message);
  }

  /** Per-ask digests, file-backed beside the space. */
  private digestStore(): DigestStore {
    return makeDigestStore(this.deps.storeDir);
  }

  /** Classify a DRAFT — records nothing; a pasted list previews items. */
  async classifyDraft(text: string): Promise<{ kind: UtteranceKind; items?: string[] }> {
    const items = splitList(text);
    if (items) return { kind: "ask", items };
    const classify = this.deps.classify ?? classifyUtterance;
    return { kind: await classify(this.deps.round, text) };
  }

  /** The human pressed Cancel. */
  cancelCapture(): void {
    this._captureAbort?.abort();
  }

  /** The confirmed list-paste: several asks in order. */
  async captureMany(texts: string[]): Promise<{ ok: boolean; reason?: string }> {
    for (const t of texts) {
      const r = await this.capture(t, "ask");
      if (!r.ok) return r;
    }
    return { ok: true };
  }

  /** Capture with the CONFIRMED kind: an ask grounds, a question is
   *  answered and recorded nowhere, a rule becomes a decision. */
  async capture(text: string, confirmedKind?: UtteranceKind): Promise<{ ok: boolean; reason?: string }> {
    const classify = this.deps.classify ?? classifyUtterance;
    const kind = confirmedKind ?? (await classify(this.deps.round, text));
    if (kind === "question") {
      this.lastAnswer = await answerQuestionFlow({
        round: this.deps.round,
        space: this.space,
        text,
        decisions: this.decisionsInForce(),
        digests: this.digestStore(),
        answerRound: this.deps.answerRound,
      });
      this.deps.onChanged?.();
      return { ok: true };
    }
    if (kind === "statement") {
      this.space = statementFlow(this.space, this.author, this.deps.now(), text);
      this.changed("Recorded as a decision in force — every later derivation builds under it.");
      return { ok: true };
    }
    const r = addAsk(
      this.space,
      text,
      this.deps.now(),
      `ask-${this.author}-${this.space.asks.length + 1}`,
    );
    if (!r.ok) return { ok: false, reason: r.reason };
    this.space = r.space;
    this.changed(); // the ask is visibly on the list BEFORE any thinking starts
    const ground = this.deps.ground ?? runDerivationPipeline;
    this._captureAbort = new AbortController();
    const grounded = await ground(
      { ...this.deps.round, abort: this._captureAbort },
      r.added,
      {
        nextIndex: this.space.nodes.length + 1,
        decisions: this.decisionsInForce(),
        digestStore: this.digestStore(),
        mintNodeId: (n) => `node-${this.author}-${n}`,
        ...(this.deps.scopes ? { scopes: this.deps.scopes() } : {}),
        onStage: (label, current, total) => {
          this.activity = { label, current, total, askId: r.added.id };
          this.deps.onChanged?.();
        },
      },
    );
    this.activity = undefined;
    this._captureAbort = undefined;
    const questions = grounded.questions.map((q, i) => ({
      ...q,
      id: `q-${this.author}-${this.space.questions.length + i + 1}`,
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
    await this.renderAbstracts();
    return { ok: true };
  }

  /** Re-derive every stale ask; fresh grounding replaces old. */
  async reground(): Promise<void> {
    await this.refreshStaleness();
    const staleAsks = new Set(
      this.space.nodes
        .filter((n) => this.stale.has(n.id))
        .flatMap((n) => n.serves),
    );
    if (staleAsks.size === 0) return;
    for (const askId of staleAsks) {
      const ask = this.space.asks.find((a) => a.id === askId);
      if (!ask) continue;
      this.space = await rederiveAskFlow({
        space: this.space,
        ask,
        round: this.deps.round,
        ground: this.deps.ground ?? runDerivationPipeline,
        decisions: this.decisionsInForce(),
        digests: this.digestStore(),
        mintNodeId: (n) => `node-${this.author}-${n}`,
        ...(this.deps.scopes ? { scopes: this.deps.scopes() } : {}),
      });
    }
    this.recluster();
    await this.refreshStaleness();
    this.changed("Re-grounded the stale changes.");
    await this.renderAbstracts();
  }

  panic(): { ok: boolean; reason?: string } {
    if (this.running) return { ok: false, reason: "a run is in flight — stop it first" };
    const r = panicFlow(this.space);
    if ("reason" in r) return { ok: false, reason: r.reason };
    this.space = r.space;
    this.cutNodeIds = new Set();
    this.stale = new Set();
    this.recluster();
    this.changed("Cleared the derived thinking — your asks are untouched; re-ground when ready.");
    return { ok: true };
  }

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
    const r = decideQuestionFlow({
      space: this.space,
      questionId,
      editedText,
      now: this.deps.now(),
      author: this.author,
    });
    if ("reason" in r) return { ok: false, reason: r.reason };
    this.space = r.space;
    if (r.askId) {
      // SPEC: re-name units whose question was since decided.
      this.space = clearAbstractsServingAsk(this.space, r.askId);
      this.units = this.space.units;
    }
    this.changed(
      r.staged
        ? "Decision in force — its implication is staged below; accept it to re-derive."
        : "Decision in force.",
    );
    void this.renderAbstracts();
    return { ok: true };
  }

  /** Accept = re-derive under the decisions; dismiss touches nothing. */
  async decideImpact(
    impactId: string,
    accept: boolean,
  ): Promise<{ ok: boolean; reason?: string }> {
    const im = (this.space.impacts ?? []).find((x) => x.id === impactId);
    if (!im) return { ok: false, reason: `no staged impact '${impactId}'` };
    this.space = {
      ...this.space,
      impacts: (this.space.impacts ?? []).filter((x) => x.id !== impactId),
    };
    if (!accept) {
      this.changed("Dismissed — the definitions stay as they are.");
      return { ok: true };
    }
    const ask = this.space.asks.find((a) => a.id === im.askId);
    if (!ask) return { ok: false, reason: "the ask no longer exists" };
    this.space = await rederiveAskFlow({
      space: this.space,
      ask,
      round: this.deps.round,
      ground: this.deps.ground ?? runDerivationPipeline,
      decisions: this.decisionsInForce(),
      digests: this.digestStore(),
      mintNodeId: (n) => `node-${this.author}-${n}`,
      ...(this.deps.scopes ? { scopes: this.deps.scopes() } : {}),
    });
    this.recluster();
    await this.refreshStaleness();
    this.changed("Re-derived under the decision.");
    await this.renderAbstracts();
    return { ok: true };
  }

  /** A human pin — outranks the computed coupling. */
  pin(kind: "together" | "apart", a: string, b: string): void {
    this.space = {
      ...this.space,
      pins: [...this.space.pins, { kind, changeIds: [a, b] }],
    };
    this.recluster();
    this.changed(kind === "together" ? "Pinned into one slice." : "Split apart.");
    void this.renderAbstracts();
  }

  async refreshStaleness(): Promise<void> {
    const read =
      this.deps.readCurrentStamp ??
      (async () => [await readStamp(this.deps.round.repoRoot)]);
    this.stale = staleChangeIds(this.space, await read());
  }

  /** Append-only membership (TEP-22) — see core/membership.ts. */
  recluster(): void {
    this.space = advanceSpaceMembership(this.space, this.author);
    this.units = this.space.units;
    this.edges = unitEdges(this.space.nodes, this.units);
  }

  private _naming = false;

  async renderAbstracts(): Promise<void> {
    if (this._naming) return;
    this._naming = true;
    try {
      const next = await renderUnitAbstracts({
        space: this.space,
        round: this.deps.round,
        name: this.deps.name ?? nameUnits,
        readStamps:
          this.deps.readCurrentStamp ??
          (async () => [await readStamp(this.deps.round.repoRoot)]),
        onActivity: (a) => {
          this.activity = a;
          this.deps.onChanged?.();
        },
      });
      if (next) {
        this.space = next;
        this.units = this.space.units;
        this.changed();
      }
    } finally {
      this._naming = false;
    }
  }

  /** Accept applies the staged merge; reject vetoes the pair FOREVER. */
  decideMerge(proposalId: string, accept: boolean): { ok: boolean; reason?: string } {
    const r = mergeVerdict(this.space, proposalId, accept);
    if ("reason" in r) return { ok: false, reason: r.reason };
    this.space = r.space;
    this.units = this.space.units;
    this.edges = unitEdges(this.space.nodes, this.units);
    this.changed(r.message);
    void this.renderAbstracts();
    return { ok: true };
  }

  pendingCheck: { changeId: string; text: string; kind: "probe" | "assessment" } | undefined; // proposal awaiting accept

  /** The machine proposes a check; the human's wording wins. */
  async proposeCheckFor(changeId: string): Promise<{ ok: boolean; reason?: string }> {
    const n = this.space.nodes.find((x) => x.id === changeId);
    if (!n) return { ok: false, reason: `no promise '${changeId}'` };
    const ask = this.space.asks.find((a) => n.serves.includes(a.id));
    this.activity = { label: "writing a check for the promise", current: 1, total: 1 };
    this.deps.onChanged?.();
    const p = await (this.deps.proposeCheck ?? proposeCheckRound)(this.deps.round, n, ask?.text ?? "").catch(() => undefined);
    this.activity = undefined;
    if (p) this.pendingCheck = { changeId, ...p };
    this.deps.onChanged?.(p ? undefined : "The round could not write a check — try again or reword the promise.");
    return p ? { ok: true } : { ok: false, reason: "no check produced" };
  }

  acceptCheck(changeId: string, text: string, kind: "probe" | "assessment"): { ok: boolean; reason?: string } {
    const r = addCheckFlow(this.space, changeId, text, kind, this.author);
    if ("reason" in r) return { ok: false, reason: r.reason };
    this.space = r.space;
    this.pendingCheck = undefined;
    this.changed(r.message);
    return { ok: true };
  }

  /** Closed under needs: adds pull dependencies, removals drop dependents. */
  toggleCut(changeIds: string[]): void {
    const adding = changeIds.some((id) => !this.cutNodeIds.has(id));
    const r = adding
      ? addWithNeeds(this.cutNodeIds, changeIds, this.space.nodes)
      : removeWithDependents(this.cutNodeIds, changeIds, this.space.nodes);
    this.changed(r.note);
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
      id: `cut-${this.author}-${this.space.cuts.length + 1}`,
      changeIds: [...this.cutNodeIds],
    };
    const r = signCut(this.space, cut, this.deps.now(), this.author, this.deps.nextTepNumber?.());
    if (!r.ok) return r;
    this.space = { ...this.space, cuts: [...this.space.cuts, r.cut] };
    // The human's click IS the mint (this message only arrives from the
    // panel): a content-bound token in the machine-local store — the same
    // no-expiry, edit-re-arms discipline the engine's gates verify.
    this._approvals.put(
      `tep:${r.cut.tepId}`,
      mintApproval(`tep:${r.cut.tepId}`, tepContentHash(this.space, r.cut), Date.now(), this._secret),
    );
    this.cutNodeIds.clear();
    this.changed(`${r.cut.tepId} minted — the run is starting.`);
    void this.execute(r.cut.id);
    return { ok: true };
  }

  async execute(cutId: string): Promise<DispatchOutcome | undefined> {
    const cut = this.space.cuts.find((c) => c.id === cutId);
    if (!cut || this.running) return undefined;
    const approval = cut.tepId ? this.tepApproval(cut.tepId) : { approved: false, reason: "unsigned" };
    if (!approval.approved) {
      this.runNote = `The build could not start: ${approval.reason} — re-sign the cut.`;
      this.changed(this.runNote);
      return undefined;
    }
    // A project space resolves a forge PER REPOSITORY BATCH; only a
    // plain repository session needs the anchor forge.
    if (!this.deps.forge && !this.deps.resolveScope) {
      this.runNote =
        "The build could not start: no forge is reachable for this repository — set thinkubeTandem.giteaToken (or use a repository whose remote carries its credential). The cut stays signed, undelivered.";
      this.changed(this.runNote);
      return undefined;
    }
    this.runNote = undefined;
    this.running = true;
    this.runState = new RunState(() => this.deps.onChanged?.());
    this.changed(`Building ${cut.tepId ?? cutId}…`);
    try {
      const plan = planScopes(this.space, cut);
      if (!plan.ok) {
        this.running = false;
        this.runNote = `The build could not start: ${plan.reason}.`;
        this.changed(this.runNote);
        return undefined;
      }
      const anchorRefusal = this.deps.anchorless ? refuseAnchorless(plan, this.space) : undefined;
      if (anchorRefusal) {
        this.running = false;
        this.runNote = anchorRefusal;
        this.changed(anchorRefusal);
        return undefined;
      }
      const last = await dispatchScopePlan({
        plan,
        cut,
        space: () => this.space,
        deps: this.deps,
        runState: this.runState!,
        spaceName: path.basename(this.deps.storeDir),
        onDelivery: (delivery, note) => {
          this.space = { ...this.space, deliveries: [...this.space.deliveries, delivery] };
          this.changed(note);
        },
        changed: (m) => this.changed(m),
      });
      return last;
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

  private _lastWritten = "";

  /** Append-only store: every change appends ONE immutable record in this
   *  user's own subtree; the state is the fold. Secret-scanned. */
  persist(): void {
    this._lastWritten = persistSpace({
      storeDir: this.deps.storeDir,
      author: this.author,
      now: this.deps.now,
      space: this.space,
      cut: [...this.cutNodeIds],
      lastWritten: this._lastWritten,
      onRefused: (m) => this.deps.onChanged?.(m),
    });
  }

  load(): void {
    try {
      const folded = loadSpace({
        projectDir: this.deps.projectDir,
        storeDir: this.deps.storeDir,
        author: this.author,
        now: this.deps.now,
      });
      this.space = folded.space;
      this.cutNodeIds = new Set(folded.cut);
      this.recluster();
      void this.refreshStaleness().then(() => this.deps.onChanged?.());
    } catch {
      this.space = emptySpace();
    }
  
  }
}
