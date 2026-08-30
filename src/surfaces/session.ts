/**
 * The v2 session: one space, exactly the registered actions, every change
 * persisted to the store. Signing starts the run; accepting merges the
 * delivery. Long rounds MERGE results into the present space — they
 * never replace it with a copy of their past.
 */
import * as path from "node:path";
import { emptySpace, Space, Unit } from "../core/schema";
import { assessCurrency } from "./currency";
import { DigestStore } from "../derive/pipeline";
import { Knowledge, knowledgeOf } from "../derive/knowledge";
import { renderCutScreen } from "../gates/render";
import { DispatchOutcome } from "../run/dispatch";
import { RunState } from "../run/state";
import { loadOrCreateApprovalSecret, mintApproval } from "../engine/approvalToken";
import { ApprovalStore, createApprovalStore } from "../engine/approvalStore";
import { tepApprovalOf } from "../gates/approval";
import { proposeCheckGesture } from "./checkGesture";
import { acceptDeliveryGesture, executeRun, exemptDocsGesture, GestureResult, rejectDeliveryGesture, signCutGesture, unrunCutOf } from "./runGate";
import { thinkAgainFlow } from "./thinkAgain";
import { applyModel, readEverything, readModel } from "./modelFlow";
import { keepDraftFlow, readDraftFlow } from "./draftFlow";
import { groundSubjectFlow } from "./subjectFlow";
import { addWithNeeds, mergedIds, removeWithDependents, signedIds } from "../core/cutClosure";
import { askState } from "../core/component";
import { amendAsk, editAsk, Price, priceOfEditing } from "../core/reframe";
import { draftReadOf, saveDraftOn } from "./draftGestures";
import { attestOn } from "./attesting";
import { deliveryPageOf } from "./deliveryPage";
import { buildFlow, costOfThinking, WorkCost } from "./buildFlow";
import { addCheckFlow, panicFlow } from "./captureFlows";
import {
  acceptQuestionOn,
  applyAllImpactsOn,
  decideImpactOn,
  rederiveSubjects,
  subjectsOfAsk,
} from "./decisions";
import { loadSpace, makeDigestStore, persistSpace } from "./sessionStore";
import { readRun } from "../run/record";
import { repairClaimIds } from "../core/repair";
import { SessionDeps } from "./sessionDeps";
export type { SessionDeps } from "./sessionDeps";

export class TandemSession {
  space: Space = emptySpace();
  private _approvals: ApprovalStore;
  private _secret: Buffer;
  units: Unit[] = [];
  edges: { from: string; to: string }[] = [];
  cutNodeIds = new Set<string>();
  stale = new Set<string>();
  /** Criteria whose standing proof moved since it was bound — the test
   *  file changed after the anchor's stamp, so "proved" is out of date. */
  proofDrift = new Set<string>();
  running = false;
  /** This session is the one executing the run — not merely watching it.
   *  A watcher reads the record on every load; the driver never does,
   *  because its own state is ahead of the file. */
  driving = false;
  runState: RunState | undefined;
  activity: { label: string; current: number; total: number; askId?: string } | undefined;
  runNote: string | undefined; // why the last build did not start
  openLog: { step: string; page: number } | undefined; // the log being read
  /** The reading waiting for the human, and a reading that failed, both
   *  read from the space so a reload or a second paste cannot lose them. */
  get pendingModel(): Space["proposal"] {
    return this.space.proposal;
  }
  get modelFailure(): Space["readingFailure"] {
    return this.space.readingFailure;
  }
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

  /**
   * The space's own name.
   *
   * A space's store is `<space>/<author>`, so the last segment is the
   * AUTHOR — naming a space "cmxela" told a person nothing and named
   * everyone's spaces the same. The space is the directory holding it.
   */
  get spaceName(): string {
    return path.basename(path.dirname(this.deps.storeDir));
  }

  changed(message?: string): void {
    this.persist();
    this.deps.onChanged?.(message);
  }

  digests(): DigestStore {
    return makeDigestStore(this.deps.storeDir);
  }

  /** Progress rows, keyed by whatever is being thought about. */
  mark(id: string, label: string, current = 0, total = 4): void {
    this._grounding.set(id, { label, current, total });
  }
  clear(id: string): void {
    this._grounding.delete(id);
    if (this._grounding.size === 0) this.activity = undefined;
  }
  stageOf(id: string): (label: string, current: number, total: number) => void {
    return this.stageFor(id);
  }

  cancelCapture(): void {
    this._captureAbort?.abort();
  }

  /** Read the recorded sentences again after a failure. */
  retryModel(): Promise<{ ok: boolean; reason?: string }> {
    return readEverything(this);
  }

  /**
   * Corrections that are still the human's own: remove work that should
   * not exist, and retire a rule. Everything about SHAPE — what is one
   * thing, what belongs with what, what holds everywhere — is corrected by
   * saying the sentence differently, never by editing the machine's
   * reading of it.
   */
  editModel(edit: {
    kind: "dismiss-promise";
    id: string;
    text?: string;
  }): { ok: boolean; reason?: string } {
    const sp = this.space;
    if (signedIds(sp.cuts).has(edit.id))
      return { ok: false, reason: "that promise is built — it is a record now" };
    this.cutNodeIds.delete(edit.id);
    this.space = { ...sp, nodes: sp.nodes.filter((n) => n.id !== edit.id) };
    this.changed(edit.text?.trim() ? `Dismissed: ${edit.text.trim()}` : "Dismissed.");
    return { ok: true };
  }

  /** What editing a sentence will disturb, before it is disturbed. */
  priceOf(askId: string): Price & { state: "open" | "bound" } {
    return {
      ...priceOfEditing(this.space, askId),
      state: askState(this.space, askId, mergedIds(this.space)),
    };
  }

  /**
   * Say a sentence differently. An open sentence is rewritten and its
   * reading re-formed; a sentence whose work is signed refuses, because
   * changing what is built is new work — which arrives as an amendment.
   */
  async reframe(askId: string, text: string): Promise<{ ok: boolean; reason?: string }> {
    if (this.running) return { ok: false, reason: "a run is in flight — stop it first" };
    const r = editAsk(this.space, askId, text, mergedIds(this.space));
    if (!r.ok) return { ok: false, reason: r.reason };
    this.space = r.space;
    this.changed("Read again, in your words.");
    return readModel(
      this,
      this.space.asks.map((a) => a.text),
      this.space.asks.map((a) => a.id),
    );
  }

  /** A new sentence that supersedes a built one. */
  async amend(askId: string, text: string): Promise<{ ok: boolean; reason?: string }> {
    const r = amendAsk(
      this.space,
      askId,
      text,
      this.deps.now(),
      `ask-${this.author}-${this.space.asks.length + 1}`,
    );
    if (!r.ok) return { ok: false, reason: r.reason };
    this.space = r.space;
    this.changed("Recorded as an amendment — reading it with the rest.");
    return readModel(
      this,
      this.space.asks.map((a) => a.text),
      this.space.asks.map((a) => a.id),
    );
  }

  /** Going to look at the work is what starts the thinking. */
  async think(): Promise<{ ok: boolean; reason?: string }> {
    const pending = this.space.proposal;
    if (pending) {
      this.space = { ...applyModel(this.space, pending, this.author), proposal: undefined };
    }
    const ground = new Set(
      this.space.nodes.flatMap((n) => n.serves).filter((x) => x.startsWith("subject-")),
    );
    const todo = (this.space.subjects ?? []).filter((s) => !ground.has(s.id)).map((s) => s.id);
    if (!todo.length) return { ok: true };
    await groundSubjectFlow(this, todo);
    return { ok: true };
  }

  /** What thinking about the rest will cost, before it is spent. */
  thinkingCost(): WorkCost {
    return costOfThinking(this.space);
  }

  /** Why the last press of Sign and build did nothing — shown under the
   *  button until a press succeeds. A refusal that only scrolls past in
   *  the header is a button that appears to do nothing. */
  buildRefusal?: string;

  /** Commit: assumptions become decisions, whole components go into one cut. */
  async build(excluded: string[] = []): Promise<GestureResult> {
    const r = await buildFlow(this, excluded);
    // A refusal always carries words: the button shows them under itself,
    // so a refusal with nothing to say would read as a button doing nothing.
    this.buildRefusal = undefined;
    if (r.ok) return { ok: true };
    const reason = r.reason ?? "the build was refused";
    this.buildRefusal = reason;
    this.changed(reason);
    return { ok: false, reason };
  }

  /** The draft a person is writing, and what becomes of it — one subject,
   *  kept together in `./draftGestures`. */
  saveDraft = (text: string): void => saveDraftOn(this, text);
  readDraft = (): Promise<{ ok: boolean; reason?: string }> => readDraftFlow(this);
  keepDraft = (): { ok: boolean; reason?: string } => keepDraftFlow(this);
  draftRead = (): string[] => draftReadOf(this);

  /**
   * What is known about this repository, built once and carried into
   * every step of a derivation: the map extracted from the code itself,
   * the reading of what a map cannot show, and the decisions in force.
   *
   * There is no version of this that runs without the map. Deriving from
   * a guess about a repository nobody read is how a machine produces
   * confident work about code that does not exist — and from the outside
   * that looks exactly like work about code that does.
   */
  async knowledge(): Promise<Knowledge> {
    if (this.deps.knowledge) return this.deps.knowledge();
    this.activity = { label: "mapping your code, once", current: 1, total: 1 };
    this.deps.onChanged?.();
    try {
      return await knowledgeOf({
        deps: this.deps.round,
        cacheRoot: this.deps.storeDir,
        decisions: this.decisionsInForce(),
        store: this.digests(),
        ...(this.deps.contextRound ? { round: this.deps.contextRound } : {}),
      });
    } finally {
      this.activity = undefined;
      this.deps.onChanged?.();
    }
  }

  readLog(step: string | null): void {
    this.openLog = step ? { step, page: -1 } : undefined;
    this.deps.onChanged?.();
  }

  logView() {
    if (!this.openLog || !this.runState) return undefined;
    return { step: this.openLog.step, ...this.runState.logTail(this.openLog.step) };
  }

  groundingView(): { askId: string; label: string; current: number; total: number }[] {
    return [...this._grounding.entries()].map(([askId, v]) => ({ askId, ...v }));
  }

  /**
   * Progress lives ON each subject's own row, because each one is at its
   * own stage. The single line above them may therefore never quote a
   * stage while several are running: borrowing whichever subject reported
   * last describes none of them, and its step count belongs to that one
   * subject alone. With several in flight it counts SUBJECTS; with one, it
   * is that subject's own stage.
   */
  stageFor(askId: string): (label: string, current: number, total: number) => void {
    return (label, current, total) => {
      this._grounding.set(askId, { label, current, total });
      const rows = [...this._grounding.values()];
      // With several subjects in flight the aggregate belongs to whoever
      // is running the batch — it alone knows how many have finished. This
      // only speaks when it is the single subject's own stage.
      if (rows.length === 1) this.activity = { label, current, total, askId };
      this.deps.onChanged?.();
    };
  }

  /** Out-of-date promises re-derive the subject they belong to. */
  async reground(): Promise<void> {
    await this.refreshStaleness();
    const staleSubjects = new Set(
      this.space.nodes
        .filter((n) => this.stale.has(n.id) && n.servesClaim)
        .map((n) => (this.space.claims ?? []).find((c) => c.id === n.servesClaim)?.subjectId)
        .filter((id): id is string => !!id),
    );
    if (!staleSubjects.size) return;
    await rederiveSubjects(this, [...staleSubjects]);
    await this.refreshStaleness();
    this.changed("Re-read the code and refreshed the out-of-date promises.");
  }

  panic(): { ok: boolean; reason?: string } {
    if (this.running) return { ok: false, reason: "a run is in flight — stop it first" };
    const r = panicFlow(this.space);
    if ("reason" in r) return { ok: false, reason: r.reason };
    this.space = r.space;
    this.cutNodeIds = new Set();
    this.stale = new Set();
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
  acceptQuestion(questionId: string, editedText?: string): Promise<{ ok: boolean; reason?: string }> {
    return acceptQuestionOn(this, questionId, editedText);
  }

  decideImpact(impactId: string, accept: boolean): Promise<{ ok: boolean; reason?: string }> {
    return decideImpactOn(this, impactId, accept);
  }

  applyAllImpacts(): Promise<{ ok: boolean; reason?: string }> {
    return applyAllImpactsOn(this);
  }


  /** A human pin — outranks the computed coupling. */
  /** Out of date only when a file the promise lands in changed. */
  async refreshStaleness(): Promise<void> {
    const r = await assessCurrency(this.space, {
      repoRoot: this.deps.round.repoRoot,
      readCurrentStamp: this.deps.readCurrentStamp,
      scopeDir: (scope) => this.deps.scopes?.().find((x) => x.id === scope)?.dir,
    });
    this.stale = r.stale;
    this.proofDrift = r.proofDrift;
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

  /** The recorded reason documentation is not needed for the cut about to be
   *  signed. Kept here, not on a node, because it belongs to the cut that
   *  does not exist until the sign gesture builds it — signCutGesture reads
   *  this and puts it on the cut it mints. */
  docsExemptionReason: string | undefined;

  /** "Documentation is not needed here" — with a reason, recorded before
   *  signing so it travels onto the cut. An empty or whitespace-only reason
   *  is refused and nothing is recorded, because a blank reason is not one. */
  exemptDocs(reason: string): GestureResult {
    return exemptDocsGesture(this, reason);
  }

  /** Gate 1. On success the run starts — nothing between the gates is human. */
  signCut(): GestureResult {
    return signCutGesture(this);
  }

  execute(cutId: string): Promise<DispatchOutcome | undefined> {
    return executeRun(this, cutId);
  }

  /**
   * Signed work that never delivered, if there is any: the cut is a
   * record and cannot be signed twice, so without this a run that
   * refused itself — a plan the engine would not accept, a forge that
   * was not reachable — left the work sealed and unreachable, with the
   * one button that could have started it already spent.
   */
  unrunCut(): { id: string; tepId?: string } | undefined {
    return unrunCutOf(this.space);
  }

  /** Think again: withdraw the signed cut that delivered nothing and derive
   *  its promises anew (src/surfaces/thinkAgain.ts). */
  thinkAgain(): Promise<{ ok: boolean; reason?: string }> {
    return thinkAgainFlow(
      this,
      (id) => subjectsOfAsk(this, id),
      (ids) => rederiveSubjects(this, ids),
    );
  }

  /**
   * Run the signed work again.
   *
   * Resuming by default: a slice an earlier run committed stands, and only
   * what never finished runs again. `fresh` discards that branch first, so
   * every unit is proved again on the base as it stands today — what a
   * person wants when the machinery itself changed under the last run, and
   * its finished units were judged by rules since corrected.
   */
  async rerun(fresh = false): Promise<{ ok: boolean; reason?: string }> {
    const c = this.unrunCut();
    if (!c) return { ok: false, reason: "there is no signed work waiting to run" };
    if (this.running) return { ok: false, reason: "a run is already in flight" };
    await executeRun(this, c.id, { fresh });
    return { ok: true };
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

  /** The delivery, rendered for a person to read — in `./deliveryPage`. */
  deliveryPage = (deliveryId: string): string | undefined => deliveryPageOf(this, deliveryId);

  /** Gate 2. Acceptance in the engine's canonical order — merge → stamp →
   *  retire (best-effort) — refused without green proof BEFORE the merge. */
  acceptDelivery(deliveryId: string): Promise<{ ok: boolean; reason?: string }> {
    return acceptDeliveryGesture(this, deliveryId);
  }

  /** What only a person can settle, settled — kept in `./attesting`. */
  attestDelivery = (
    deliveryId: string,
    criterionId: string,
    held: boolean,
    note?: string,
  ): { ok: boolean; reason?: string } => attestOn(this, deliveryId, criterionId, held, note);

  /** Refuse a delivery: the cut goes back to signed and can run again. */
  rejectDelivery(deliveryId: string): { ok: boolean; reason?: string } {
    return rejectDeliveryGesture(this, deliveryId, this.deps.now());
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
      this.space = repairClaimIds(folded.space);
      this.cutNodeIds = new Set(folded.cut);
      // A run this session does not drive is read from disk every time,
      // situation and all: a surface that did not start a run shows what
      // its driver shows, for as long as it runs. Only the driver skips
      // the read — its own state is ahead of the file.
      if (!this.driving) {
        const seen = readRun(this.deps.storeDir, () => this.deps.onChanged?.());
        if (seen) Object.assign(this, { runState: seen.state, running: seen.running, runNote: seen.note });
      }
      void this.refreshStaleness().then(() => this.deps.onChanged?.());
    } catch {
      this.space = emptySpace();
    }
  }
}
