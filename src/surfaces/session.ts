/**
 * The v2 session: one space, exactly the registered actions, every change
 * persisted to the store. Signing starts the run; accepting merges the
 * delivery. Long rounds MERGE results into the present space — they
 * never replace it with a copy of their past.
 */
import * as path from "node:path";
import { emptySpace, Space, Unit } from "../core/schema";
import { runReadRound } from "../derive/round";
import { staleByTouchpoints, staleChangeIds } from "../core/stale";
import { filesChangedSince } from "../core/staleFiles";
import { DigestStore, ensureRepoDigest } from "../derive/pipeline";
import { renderCutScreen, renderDeliveryPage } from "../gates/render";
import { verifiedDoors } from "../gates/doors";
import { DispatchOutcome } from "../run/dispatch";
import { RunState } from "../run/state";
import { loadOrCreateApprovalSecret, mintApproval } from "../engine/approvalToken";
import { ApprovalStore, createApprovalStore } from "../engine/approvalStore";
import { tepApprovalOf } from "../gates/approval";
import { classifyUtterance, splitList, UtteranceKind } from "../derive/classify";
import { proposeCheckGesture } from "./checkGesture";
import { acceptDeliveryGesture, executeRun, signCutGesture } from "./runGate";
import { applyModel, inheritRules, proposeModelFlow, retryModel } from "./modelFlow";
import { groundSubjectFlow } from "./subjectFlow";
import { addWithNeeds, removeWithDependents, signedIds } from "../core/cutClosure";
import { addCheckFlow, answerQuestionFlow, decideQuestionFlow, panicFlow, statementFlow } from "./captureFlows";
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
    // A list is a description of one world: the model round reads it whole
    // and proposes what it is about, before any code is read.
    return proposeModelFlow(this, texts);
  }

  /** The human accepted the proposed model: it becomes the space, and every
   *  subject grounds once under the rules in force. */
  async acceptModel(): Promise<{ ok: boolean; reason?: string }> {
    const pending = this.space.proposal;
    if (!pending) return { ok: false, reason: "nothing proposed" };
    this.space = { ...applyModel(this.space, pending, this.author), proposal: undefined };
    // A rule from an earlier round reaches these subjects before they ground.
    const inherited = await inheritRules(this);
    if (inherited) this.changed(`${inherited} rule(s) already in force apply here.`);
    this.changed(
      `${this.space.subjects?.length ?? 0} subject(s) recorded — thinking about them now.`,
    );
    await groundSubjectFlow(this, (this.space.subjects ?? []).map((s) => s.id));
    return { ok: true };
  }

  /** Read the recorded sentences again after a failure. */
  retryModel(): Promise<{ ok: boolean; reason?: string }> {
    return retryModel(this);
  }

  /** Corrections to the recorded model. Each one changes something real:
   *  the shape of what will be derived, or what governs it. */
  editModel(edit: {
    kind: "rename-subject" | "merge-subject" | "split-claim" | "move-claim" | "promote-claim" | "dismiss-promise" | "retire-rule";
    id: string;
    into?: string;
    text?: string;
  }): { ok: boolean; reason?: string } {
    const sp = this.space;
    const subjects = sp.subjects ?? [];
    const claims = sp.claims ?? [];
    const rules = sp.rules ?? [];
    switch (edit.kind) {
      case "rename-subject": {
        if (!edit.text?.trim()) return { ok: false, reason: "a subject needs a name" };
        this.space = {
          ...sp,
          subjects: subjects.map((x) => (x.id === edit.id ? { ...x, name: edit.text!.trim() } : x)),
        };
        this.changed("Renamed — your word for it.");
        return { ok: true };
      }
      case "merge-subject": {
        const into = subjects.find((x) => x.id === edit.into);
        const gone = subjects.find((x) => x.id === edit.id);
        if (!into || !gone) return { ok: false, reason: "no such subject" };
        this.space = {
          ...sp,
          subjects: subjects
            .filter((x) => x.id !== gone.id)
            .map((x) => (x.id === into.id ? { ...x, from: [...x.from, ...gone.from] } : x)),
          claims: claims.map((c) => (c.subjectId === gone.id ? { ...c, subjectId: into.id } : c)),
          rules: rules.map((r) => ({
            ...r,
            governs: [...new Set(r.governs.map((g) => (g === gone.id ? into.id : g)))],
          })),
        };
        this.changed(`“${gone.name}” and “${into.name}” were one thing — now they are.`);
        return { ok: true };
      }
      case "split-claim": {
        const claim = claims.find((c) => c.id === edit.id);
        if (!claim) return { ok: false, reason: "no such claim" };
        const id = `subject-${this.author}-${subjects.length + 1}`;
        this.space = {
          ...sp,
          subjects: [...subjects, { id, name: edit.text?.trim() || claim.text.slice(0, 48), from: [claim.fromAsk] }],
          claims: claims.map((c) => (c.id === claim.id ? { ...c, subjectId: id } : c)),
        };
        this.changed("Split into its own subject — it derives on its own now.");
        return { ok: true };
      }
      case "move-claim": {
        if (!subjects.some((x) => x.id === edit.into)) return { ok: false, reason: "no such subject" };
        this.space = {
          ...sp,
          claims: claims.map((c) => (c.id === edit.id ? { ...c, subjectId: edit.into! } : c)),
        };
        this.changed("Moved — it derives with its new subject.");
        return { ok: true };
      }
      case "promote-claim": {
        const claim = claims.find((c) => c.id === edit.id);
        if (!claim) return { ok: false, reason: "no such claim" };
        this.space = {
          ...sp,
          claims: claims.filter((c) => c.id !== claim.id),
          rules: [
            ...rules,
            {
              id: `rule-${this.author}-${rules.length + 1}`,
              text: claim.text,
              scope: edit.text?.trim() || "every subject",
              fromAsk: claim.fromAsk,
              governs: subjects.map((x) => x.id),
            },
          ],
        };
        this.changed("Promoted to a rule — it governs every subject, and any new one that matches.");
        return { ok: true };
      }
      case "dismiss-promise": {
        if (signedIds(sp.cuts).has(edit.id))
          return { ok: false, reason: "that promise is signed — it is a record now" };
        this.cutNodeIds.delete(edit.id);
        this.space = { ...sp, nodes: sp.nodes.filter((n) => n.id !== edit.id) };
        this.changed(edit.text?.trim() ? `Dismissed: ${edit.text.trim()}` : "Dismissed.");
        return { ok: true };
      }
      case "retire-rule": {
        this.space = { ...sp, rules: rules.filter((r) => r.id !== edit.id) };
        this.changed("Retired — it governs nothing from now on.");
        return { ok: true };
      }
    }
  }

  /** Corrections to the proposal, before it is recorded. */
  reviseModel(edit: { kind: "drop-subject" | "drop-rule" | "to-rule"; index: number }): void {
    const p = this.space.proposal;
    if (!p) return;
    const subjects = [...p.subjects];
    const rules = [...p.rules];
    if (edit.kind === "drop-subject") subjects.splice(edit.index, 1);
    else if (edit.kind === "drop-rule") rules.splice(edit.index, 1);
    else if (edit.kind === "to-rule") {
      const sub = subjects[edit.index];
      if (sub) {
        for (const c of sub.claims) rules.push({ text: c.text, scope: "every subject", from: c.from });
        subjects.splice(edit.index, 1);
      }
    }
    this.space = { ...this.space, proposal: { ...p, subjects, rules } };
    this.changed();
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
        digests: this.digests(),
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
    return proposeModelFlow(this, [text]);
  }

  /** One reading of the repository BEFORE a batch fans out: every ask then
   *  grounds warm, and no worker spends its turn re-reading the same code.
   *  An injected pipeline owns its own reading — nothing runs here. */
  async warmRepoDigest(): Promise<void> {
    const round = this.deps.contextRound ?? (this.deps.ground ? undefined : runReadRound);
    if (!round) return;
    this.activity = {
      label: "reading your code once — every ask will reuse it",
      current: 1,
      total: 1,
    };
    this.deps.onChanged?.();
    await ensureRepoDigest(this.deps.round, this.digests(), round).catch(() => {});
    this.activity = undefined;
    this.deps.onChanged?.();
  }

  readLog(step: string | null, page?: number): void {
    // page -1 means the newest, which is what a reader wants first.
    this.openLog = step ? { step, page: page ?? -1 } : undefined;
    this.deps.onChanged?.();
  }

  logView() {
    if (!this.openLog || !this.runState) return undefined;
    const { step, page } = this.openLog;
    return { step, ...this.runState.logPage(step, page < 0 ? undefined : page) };
  }

  groundingView(): { askId: string; label: string; current: number; total: number }[] {
    return [...this._grounding.entries()].map(([askId, v]) => ({ askId, ...v }));
  }

  /** Progress lives ON the ask's own row; the aggregate counts only what
   *  actually runs. Shared by grounding and every re-derivation. */
  stageFor(askId: string): (label: string, current: number, total: number) => void {
    return (label, current, total) => {
      this._grounding.set(askId, { label, current, total });
      const running = [...this._grounding.values()].filter((v) => v.label !== "waiting").length;
      this.activity = {
        label: running > 1 ? `${label} (${running} asks in parallel)` : label,
        current,
        total,
        askId,
      };
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
      this.space = folded.space;
      this.cutNodeIds = new Set(folded.cut);
        void this.refreshStaleness().then(() => this.deps.onChanged?.());
    } catch {
      this.space = emptySpace();
    }
  
  }
}
