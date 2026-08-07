/**
 * The v2 session: one space, exactly the registered actions, every change
 * persisted to the store. Signing starts the run; accepting merges the
 * delivery. Long rounds MERGE results into the present space — they
 * never replace it with a copy of their past.
 */
import * as path from "node:path";
import { emptySpace, Space, Unit } from "../core/schema";
import { addAsk } from "../core/intent";
import { advanceSpaceMembership, mergeVerdict, unitEdges } from "../core/suggestions";
import { readStamp } from "../core/stamp";
import { staleByTouchpoints, staleChangeIds } from "../core/stale";
import { filesChangedSince } from "../core/staleFiles";
import { DigestStore, runDerivationPipeline } from "../derive/pipeline";
import { renderCutScreen, renderDeliveryPage } from "../gates/render";
import { DispatchOutcome } from "../run/dispatch";
import { RunState } from "../run/state";
import { loadOrCreateApprovalSecret, mintApproval } from "../engine/approvalToken";
import { ApprovalStore, createApprovalStore } from "../engine/approvalStore";
import { tepApprovalOf } from "../gates/approval";
import { classifyUtterance, splitList, UtteranceKind } from "../derive/classify";
import { nameUnits } from "../derive/name";
import { proposeCheckGesture } from "./checkGesture";
import { acceptDeliveryGesture, executeRun, signCutGesture } from "./runGate";
import { captureManyFlow } from "./captureMany";
import { addWithNeeds, removeWithDependents, signedIds } from "../core/cutClosure";
import { clearAbstractsServingAsk, renderUnitAbstracts } from "./naming";
import { addCheckFlow, answerQuestionFlow, applyRederive, decideQuestionFlow, panicFlow, rederiveAskFlow, statementFlow } from "./captureFlows";
import { loadSpace, makeDigestStore, persistSpace } from "./sessionStore";
import { SessionDeps } from "./sessionDeps";
export type { SessionDeps } from "./sessionDeps";
export { SESSION_ACTIONS } from "./affordances";

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
  activity: { label: string; current: number; total: number; askId?: string } | undefined;
  lastAnswer: { question: string; answer: string } | undefined;
  runNote: string | undefined; // why the last build did not start
  private _captureAbort: AbortController | undefined;
  _grounding = new Map<string, { label: string; current: number; total: number }>();

  constructor(readonly deps: SessionDeps) {
    this._approvals = createApprovalStore(deps.storageDir);
    this._secret = loadOrCreateApprovalSecret(deps.storageDir);
    this.load();
  }

  get author(): string {
    return this.deps.author ?? "user";
  }

  tepApproval(tepId: string): { approved: boolean; reason?: string } {
    return tepApprovalOf(this.space, this._approvals, this._secret, tepId);
  }

  /** The human's click IS the mint: a content-bound token, edit-re-armed. */
  mintTepApproval(tepId: string, contentHash: string): void {
    this._approvals.put(`tep:${tepId}`, mintApproval(`tep:${tepId}`, contentHash, Date.now(), this._secret));
  }

  get repoName(): string {
    return this.deps.scope?.label ?? path.basename(this.deps.round.repoRoot);
  }

  changed(message?: string): void {
    this.persist();
    this.deps.onChanged?.(message);
  }

  private digestStore(): DigestStore {
    return makeDigestStore(this.deps.storeDir);
  }

  async classifyDraft(text: string): Promise<{ kind: UtteranceKind; items?: string[] }> {
    const items = splitList(text);
    if (items) return { kind: "ask", items };
    const classify = this.deps.classify ?? classifyUtterance;
    return { kind: await classify(this.deps.round, text) };
  }

  cancelCapture(): void {
    this._captureAbort?.abort();
  }

  captureMany(texts: string[]): Promise<{ ok: boolean; reason?: string }> {
    return captureManyFlow(this, texts);
  }

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
    this.changed(); // visible on the list BEFORE thinking starts
    await this.groundAsk(r.added, "s");
    await this.renderAbstracts();
    return { ok: true };
  }

  groundingView(): { askId: string; label: string; current: number; total: number }[] {
    return [...this._grounding.entries()].map(([askId, v]) => ({ askId, ...v }));
  }

  async groundAsk(
    ask: { id: string; text: string; at: string },
    mintPrefix: string,
    quiet = false,
  ): Promise<{ promises: number; questions: number }> {
    const ground = this.deps.ground ?? runDerivationPipeline;
    this._captureAbort ??= new AbortController();
    this._grounding.set(ask.id, { label: "starting", current: 0, total: 7 });
    const grounded = await ground({ ...this.deps.round, abort: this._captureAbort }, ask, {
      nextIndex: 1,
      decisions: this.decisionsInForce(),
      digestStore: this.digestStore(),
      mintNodeId: (n) => `node-${this.author}-${mintPrefix}${ask.id.split("-").pop()}-${n}`,
      ...(this.deps.scopes ? { scopes: this.deps.scopes() } : {}),
      onStage: (label, current, total) => {
        this._grounding.set(ask.id, { label, current, total });
        const running = [...this._grounding.values()].filter((v) => v.label !== "waiting").length;
        this.activity = {
          label: running > 1 ? `${label} (${running} asks in parallel)` : label,
          current,
          total,
          askId: ask.id,
        };
        this.deps.onChanged?.();
      },
    });
    this._grounding.delete(ask.id);
    if (this._grounding.size === 0) {
      this.activity = undefined;
      this._captureAbort = undefined;
    }
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
      quiet
        ? undefined
        : `${grounded.changes.length ? `Derived ${grounded.changes.length} promise(s)` : "No promises derived"} for "${ask.text.slice(0, 32)}…".${qNote}`,
    );
    return { promises: grounded.changes.length, questions: questions.length };
  }

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
      this.space = applyRederive(this.space, await rederiveAskFlow({
        space: this.space,
        ask,
        round: this.deps.round,
        ground: this.deps.ground ?? runDerivationPipeline,
        decisions: this.decisionsInForce(),
        digests: this.digestStore(),
        mintNodeId: (n) => `node-${this.author}-${n}`,
        ...(this.deps.scopes ? { scopes: this.deps.scopes() } : {}),
        onStage: (label, current, total) => {
          this.activity = { label, current, total };
          this.deps.onChanged?.();
        },
      }));
    }
    this.activity = undefined;
    this.recluster();
    await this.refreshStaleness();
    this.changed("Re-read the code and refreshed the out-of-date promises.");
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
    this.space = applyRederive(this.space, await rederiveAskFlow({
      space: this.space,
      ask,
      round: this.deps.round,
      ground: this.deps.ground ?? runDerivationPipeline,
      decisions: this.decisionsInForce(),
      digests: this.digestStore(),
      mintNodeId: (n) => `node-${this.author}-${n}`,
      ...(this.deps.scopes ? { scopes: this.deps.scopes() } : {}),
      onStage: (label, current, total) => {
        this.activity = { label, current, total };
        this.deps.onChanged?.();
      },
    }));
    this.activity = undefined;
    this.recluster();
    await this.refreshStaleness();
    this.changed(
      `Re-derived under the decision: ${this.space.nodes.filter((n) => n.serves.includes(ask.id)).length} promise(s) now serve "${ask.text.slice(0, 40)}…". Merges and pins on the OLD promises no longer apply.`,
    );
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

  /** Out of date only when a file the promise lands in changed. */
  async refreshStaleness(): Promise<void> {
    if (this.deps.readCurrentStamp) { // test seam: whole-repo comparison
      this.stale = staleChangeIds(this.space, await this.deps.readCurrentStamp());
      return;
    }
    this.stale = await staleByTouchpoints(
      this.space,
      (root, head) => filesChangedSince(root, head),
      (scope) =>
        scope
          ? this.deps.scopes?.().find((x) => x.id === scope)?.dir
          : this.deps.round.repoRoot,
    );
  }

  /** Append-only membership (TEP-22) — see core/membership.ts. */
  recluster(): void {
    this.space = advanceSpaceMembership(this.space, this.author);
    // Suggestions pointing at units that no longer exist are noise — drop.
    const live = new Set(this.space.units.map((u) => u.id));
    this.space = {
      ...this.space,
      proposals: (this.space.proposals ?? []).filter((p) => live.has(p.a) && live.has(p.b)),
    };
    this.units = this.space.units;
    this.edges = unitEdges(this.space.nodes, this.units);
  }

  private _naming = false;
  private _nameAgain = false;

  /** Naming coalesces: a request during a running pass marks it dirty and
   *  the pass runs once more at the end — N quick accepts cost one or two
   *  rounds, never N, and no request is silently dropped. */
  async renderAbstracts(): Promise<void> {
    if (this._naming) {
      this._nameAgain = true;
      return;
    }
    this._naming = true;
    try {
      do {
        this._nameAgain = false;
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
          // Merge into the PRESENT space; unchanged units keep their names.
          this.space = {
            ...this.space,
            units: this.space.units.map((u) => {
              const a = next.get(u.id);
              return a && a.of.join(",") === [...u.changeIds].join(",") ? { ...u, abstract: a } : u;
            }),
          };
          this.units = this.space.units;
          this.changed();
        }
      } while (this._nameAgain);
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

  proposeCheckFor(changeId: string): Promise<{ ok: boolean; reason?: string }> {
    return proposeCheckGesture(this, changeId);
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
      ? addWithNeeds(this.cutNodeIds, changeIds, this.space.nodes, signedIds(this.space.cuts))
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
    return signCutGesture(this);
  }

  execute(cutId: string): Promise<DispatchOutcome | undefined> {
    return executeRun(this, cutId);
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
  acceptDelivery(deliveryId: string): Promise<{ ok: boolean; reason?: string }> {
    return acceptDeliveryGesture(this, deliveryId);
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
