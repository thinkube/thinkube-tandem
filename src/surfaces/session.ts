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
import { renderCutScreen, renderDeliveryPage } from "../gates/render";
import { verifiedDoors } from "../gates/doors";
import { DispatchOutcome } from "../run/dispatch";
import { RunState } from "../run/state";
import { loadOrCreateApprovalSecret, mintApproval } from "../engine/approvalToken";
import { ApprovalStore, createApprovalStore } from "../engine/approvalStore";
import { tepApprovalOf } from "../gates/approval";
import { proposeCheckGesture } from "./checkGesture";
import {
  acceptDeliveryGesture,
  answerWorkerGesture,
  executeRun,
  rerunGesture,
  signCutGesture,
  stopRunGesture,
  unrunCutOf,
} from "./runGate";
import { applyModel, readEverything, readModel } from "./modelFlow";
import { keepDraftFlow, readDraftFlow } from "./draftFlow";
import { groundSubjectFlow } from "./subjectFlow";
import { addWithNeeds, mergedIds, removeWithDependents, signedIds } from "../core/cutClosure";
import { askState } from "../core/component";
import { amendAsk, editAsk, Price, priceOfEditing } from "../core/reframe";
import { buildFlow, costOfThinking, WorkCost } from "./buildFlow";
import { addCheckFlow, decideQuestionFlow, panicFlow } from "./captureFlows";
import { loadSpace, makeDigestStore, persistSpace } from "./sessionStore";
import { loadLastRun } from "../run/record";
import { repairClaimIds } from "../core/repair";
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
  /** Criteria whose standing proof moved since it was bound — the test
   *  file changed after the anchor's stamp, so "proved" is out of date. */
  proofDrift = new Set<string>();
  running = false;
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

  /** The thinking space's own display name, exactly as given — never the
   *  repository or project label. What a tab is titled with. */
  get spaceName(): string | undefined {
    return this.deps.spaceName;
  }

  /** The owner-and-slug key this session was resolved under — what a tab
   *  is addressed by. */
  get spaceKey(): string | undefined {
    return this.deps.spaceKey;
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

  /** Commit: assumptions become decisions, whole components go into one cut. */
  build(excluded: string[] = []): Promise<{ ok: boolean; reason?: string }> {
    return buildFlow(this, excluded);
  }

  /** What you are writing, before any of it is an ask. */
  saveDraft(text: string): void {
    this.space = { ...this.space, draft: text };
    this.persist();
  }

  /** Read the draft — one round, as often as you ask for it. */
  readDraft(): Promise<{ ok: boolean; reason?: string }> {
    return readDraftFlow(this);
  }

  /** Keep the reading: the draft's lines become asks. Spends nothing. */
  keepDraft(): { ok: boolean; reason?: string } {
    return keepDraftFlow(this);
  }

  /** The lines of the reading that are still draft. */
  draftRead(): string[] {
    return (this.space.proposal?.texts ?? []).slice(this.space.asks.length);
  }

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
    await this.rederiveSubjects([...staleSubjects]);
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
    this.changed(
      r.staged
        ? "Decision in force — its implication is staged below; accept it to re-derive."
        : "Decision in force.",
    );
    return { ok: true };
  }

  /** What a decision touches. A question raised while grounding names its
   *  subject; one captured against a sentence names the ask it came from. */
  private subjectsOfAsk(id: string): string[] {
    if ((this.space.subjects ?? []).some((s) => s.id === id)) return [id];
    return [
      ...new Set(
        (this.space.claims ?? []).filter((c) => c.fromAsk === id).map((c) => c.subjectId),
      ),
    ];
  }

  /** Drop the unsigned promises of these subjects, then derive them again.
   *  A promise belongs to a subject either by the claim it serves or by the
   *  subject it was ground for — both, so nothing survives as a duplicate. */
  private async rederiveSubjects(ids: string[]): Promise<void> {
    const subjects = new Set(ids);
    const claimIds = new Set(
      (this.space.claims ?? []).filter((c) => subjects.has(c.subjectId)).map((c) => c.id),
    );
    const signed = signedIds(this.space.cuts);
    const goes = new Set(
      this.space.nodes
        .filter(
          (n) =>
            !signed.has(n.id) &&
            ((n.servesClaim && claimIds.has(n.servesClaim)) ||
              n.serves.some((sv) => subjects.has(sv))),
        )
        .map((n) => n.id),
    );
    this.space = { ...this.space, nodes: this.space.nodes.filter((n) => !goes.has(n.id)) };
    // A cut cannot hold a promise that no longer exists.
    for (const id of goes) this.cutNodeIds.delete(id);
    await groundSubjectFlow(this, ids);
  }

  /** Accept = ONE re-derivation of each subject the decision touches, under
   *  every decision in force; the sibling implications go with it. */
  async decideImpact(impactId: string, accept: boolean): Promise<{ ok: boolean; reason?: string }> {
    const im = (this.space.impacts ?? []).find((x) => x.id === impactId);
    if (!im) return { ok: false, reason: `no staged impact '${impactId}'` };
    if (!accept) {
      this.space = {
        ...this.space,
        impacts: (this.space.impacts ?? []).filter((x) => x.id !== impactId),
      };
      this.changed("Dismissed — the definitions stay as they are.");
      return { ok: true };
    }
    const covered = (this.space.impacts ?? []).filter((x) => x.askId === im.askId).length;
    this.space = {
      ...this.space,
      impacts: (this.space.impacts ?? []).filter((x) => x.askId !== im.askId),
    };
    const subjects = this.subjectsOfAsk(im.askId);
    if (!subjects.length) return { ok: false, reason: "that ask is not part of any subject" };
    await this.rederiveSubjects(subjects);
    this.changed(
      `Re-derived ${subjects.length} subject(s) under every decision in force` +
        (covered > 1 ? ` — one pass covered ${covered} accepted implications` : "") + ".",
    );
    return { ok: true };
  }

  /** One press for every staged implication: each affected subject derives
   *  again once, five at a time, progress on its own row. */
  async applyAllImpacts(): Promise<{ ok: boolean; reason?: string }> {
    const impacts = this.space.impacts ?? [];
    if (!impacts.length) return { ok: false, reason: "no implications are staged" };
    const subjects = [...new Set(impacts.flatMap((im) => this.subjectsOfAsk(im.askId)))];
    this.space = { ...this.space, impacts: [] };
    if (!subjects.length) return { ok: false, reason: "those asks are not part of any subject" };
    await this.rederiveSubjects(subjects);
    this.changed(
      `Applied ${impacts.length} implication(s): ${subjects.length} subject(s) re-derived once each.`,
    );
    return { ok: true };
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
      ...(this.space.pendingDocsExemption
        ? { docsExemption: this.space.pendingDocsExemption }
        : {}),
    });
  }

  /**
   * Before signing: say documentation is not needed for this cut, in your
   * own words. A blank or whitespace-only reason is refused and nothing is
   * recorded — the cut review page then carries the reason word for word.
   */
  excuseDocs(reason: string): { ok: boolean; reason?: string } {
    const text = reason.trim();
    if (!text)
      return {
        ok: false,
        reason: "documentation cannot be excused without a reason — type why it is not needed",
      };
    this.space = { ...this.space, pendingDocsExemption: { reason: text } };
    this.changed("Documentation excused for this cut.");
    return { ok: true };
  }

  /** Gate 1. On success the run starts — nothing between the gates is human. */
  signCut(): { ok: boolean; reason?: string } {
    return signCutGesture(this);
  }

  execute(cutId: string): Promise<DispatchOutcome | undefined> {
    return executeRun(this, cutId);
  }

  /** Signed work that never delivered, if there is any. */
  unrunCut(): { id: string; tepId?: string } | undefined {
    return unrunCutOf(this);
  }

  /** Start the signed work that never delivered, again. */
  rerun(): Promise<{ ok: boolean; reason?: string }> {
    return rerunGesture(this);
  }

  /** Answer a parked worker — the oracle's door on the run view. */
  answerWorker(unitId: string, text: string): boolean {
    return answerWorkerGesture(this, unitId, text);
  }

  /** Stop the run: abort every live worker; the run drains and reports. */
  stopRun(): number {
    return stopRunGesture(this);
  }

  deliveryPage(deliveryId: string): string | undefined {
    const d = this.space.deliveries.find((x) => x.id === deliveryId);
    if (!d) return undefined;
    // Every walkthrough line names a door the machine verified renders.
    const doors = verifiedDoors();
    const experience = new Map<string, string>();
    for (const n of this.space.nodes) {
      const door = doors.find((x) => n.sentence.toLowerCase().includes(x.action.replace(/-/g, " ")));
      if (door) experience.set(n.id, `${door.surface} — ${door.gesture}`);
    }
    return renderDeliveryPage(this.space, d, experience);
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
      this.space = repairClaimIds(folded.space);
      this.cutNodeIds = new Set(folded.cut);
      // A delivery on the record and an orchestration page saying nothing
      // ran are the same run told two ways. The last one is read back.
      const last = loadLastRun(this.deps.storeDir);
      if (last && !this.runState)
        this.runState = RunState.from(last, () => this.deps.onChanged?.());
        void this.refreshStaleness().then(() => this.deps.onChanged?.());
    } catch {
      this.space = emptySpace();
    }
  
  }
}
