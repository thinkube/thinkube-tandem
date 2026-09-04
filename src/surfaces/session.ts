/**
 * The v2 session: one space, exactly the registered actions, every change
 * persisted to the store. Signing starts the run; accepting merges the
 * delivery. Long rounds MERGE results into the present space — they
 * never replace it with a copy of their past.
 */
import { builtIds } from "../core/contradiction";
import { contradictOn } from "./contradicting";
import { AUTHOR_MISSING, currentAuthor } from "../core/author";
import * as path from "node:path";
import { emptySpace, Space, Unit, Spec } from "../core/schema";
import { documentationPromise } from "../core/docsDuty";
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
import { acceptDeliveryGesture, catchUpOnMergedWork, executeRun, exemptDocsGesture, GestureResult, rejectDeliveryGesture, signCutGesture, unrunCutOf } from "./runGate";
import { thinkAgainFlow } from "./thinkAgain";
import { applyModel, readEverything, readModel } from "./modelFlow";
import { keepDraftFlow, readDraftFlow } from "./draftFlow";
import { groundSubjectFlow } from "./subjectFlow";
import { addWithNeeds, mergedIds, removeWithDependents, signedIds } from "../core/cutClosure";
import { promisesOfSpec, proposeSpecs, specsFrom } from "../derive/specs";
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
import { builtSurfaceText } from "../gates/doors";
export type { SessionDeps } from "./sessionDeps";

/** The constructor options `SessionDeps` does not itself carry: an
 *  injectable reader for the built webview surface, read once and held
 *  for a whole push rather than once per delivery. Kept here rather than
 *  widening `SessionDeps` — every existing caller already satisfies this
 *  intersection unchanged, since the field is optional. */
type SessionDepsWithSurface = SessionDeps & { readBuiltSurface?: () => string };

export class TandemSession {
  space: Space = emptySpace();
  private _approvals: ApprovalStore;
  private _secret: Buffer;
  units: Unit[] = [];
  edges: { from: string; to: string }[] = [];
  cutNodeIds = new Set<string>();
  /** The set the cut in hand was chosen from, if it was. */
  cutSpecId: string | undefined;
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

  constructor(readonly deps: SessionDepsWithSurface) {
    this._approvals = createApprovalStore(deps.storageDir);
    this._secret = loadOrCreateApprovalSecret(deps.storageDir);
    this.load();
  }

  get author(): string {
    // Who is thinking, from the environment when the caller did not say:
    // GITHUB_USERNAME, else the owner the GitHub CLI recorded for the
    // token. Never a default — an invented name is the same on every
    // installation and separates nobody.
    const author = this.deps.author ?? currentAuthor();
    if (!author) throw new Error(AUTHOR_MISSING);
    return author;
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

  /** Read every sentence again from nothing: what they produced goes,
   *  signed work stays, and the reading is applied and grouped. The words
   *  were kept by the person already, so the reading is not put to them
   *  again — it is applied the moment it arrives. */
  async rereadAll(): Promise<{ ok: boolean; reason?: string }> {
    const r = await readEverything(this);
    if (!r.ok) return r;
    const pending = this.space.proposal;
    if (pending) this.space = { ...applyModel(this.space, pending, this.author), proposal: undefined };
    // What was chosen and cut was of the old reading; nothing is in hand.
    this.cutSpecId = undefined;
    this.cutNodeIds = new Set();
    this.changed(`Read again: ${(this.space.subjects ?? []).length} subject(s). Grouping them into things…`);
    return this.groupIntoSpecs();
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

  /**
   * Going to look at the work is what starts the thinking — and it stops at
   * the sets.
   *
   * It used to ground every subject here, which made the grouping useless:
   * the sets exist to decide what is worth working out, and working
   * everything out first is the cost they were meant to avoid. Nineteen asks
   * ground at once became one cut, one gate, one delivery and three days.
   *
   * So this reads the asks into subjects and proposes the sets. What a set
   * costs to work out is paid when it is chosen, and never for the sets you
   * do not build.
   */
  async think(): Promise<{ ok: boolean; reason?: string }> {
    const pending = this.space.proposal;
    if (pending) {
      this.space = { ...applyModel(this.space, pending, this.author), proposal: undefined };
    }
    // First press: offer the sets, which costs nothing. A person who wants
    // them takes one and pays for that one alone.
    if (!(this.space.specs ?? []).length) return this.groupIntoSpecs();
    // Pressed again with the sets already on screen, it means the other
    // thing: work all of it out. A set is an OFFER, not a gate — it is not
    // an offer if declining it leaves you unable to build anything, and
    // being marched through the sets one at a time is not a decision
    // anybody asked to make.
    const todo = this.ungrounded({ subjectIds: (this.space.subjects ?? []).map((s) => s.id) });
    if (!todo.length) return { ok: true };
    await groundSubjectFlow(this, todo);
    return { ok: true };
  }

  /**
   * The subjects of a set that nothing has been derived from yet.
   *
   * Grounded means "some promise serves an ask this subject came from" —
   * the same path `promisesOfSpec` walks to find a set's promises. Asking
   * the question a second way, by the shape of an identifier, is how the
   * two answers drift apart and a set is ground twice or never.
   */
  private ungrounded(spec: { subjectIds: string[] }): string[] {
    // A promise serves the SUBJECT it was derived from. Asking whether one
    // serves the subject's ASK never matches, so every subject looked
    // ungrounded and every think() derived all of them again and appended:
    // nine asks reached eighty-five promises where an honest derivation
    // gives nine. The asks are still accepted for spaces holding promises
    // recorded before subjects existed.
    const served = new Set(this.space.nodes.flatMap((n) => n.serves));
    return (this.space.subjects ?? [])
      .filter(
        (s) =>
          spec.subjectIds.includes(s.id) && !served.has(s.id) && !s.from.some((a) => served.has(a)),
      )
      .map((s) => s.id);
  }

  /** What thinking about the rest will cost, before it is spent. */
  /** The thing in hand, when a set was chosen and not touched since. */
  chosenSpec(): Spec | undefined {
    return (this.space.specs ?? []).find((s) => s.id === this.cutSpecId);
  }

  thinkingCost(): WorkCost {
    return costOfThinking(this.space, this.chosenSpec()?.subjectIds);
  }

  /** Why the last press of Sign and build did nothing — shown under the
   *  button until a press succeeds. A refusal that only scrolls past in
   *  the header is a button that appears to do nothing. */
  buildRefusal?: string;
  /** Why the last press of Accept did nothing — beside the button until a press succeeds. */
  acceptRefusal?: string;

  /** Commit: assumptions become decisions, whole components go into one cut. */
  async build(specId: string): Promise<GestureResult> {
    const r = await buildFlow(this, specId);
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

  /**
   * Group the subjects into sets worth delivering on their own.
   *
   * Asked once, on what the reading already produced, before any grounding —
   * the cheapest point in the system to decide it, and the one that decides
   * whether the work arrives in one piece or five. The proposal is the
   * machine's; the grouping is the person's, and every set can be edited
   * afterwards.
   */
  async groupIntoSpecs(): Promise<{ ok: boolean; reason?: string }> {
    if (this.running) return { ok: false, reason: "a run is in flight — stop it first" };
    const subjects = this.space.subjects ?? [];
    if (subjects.length < 2)
      return { ok: false, reason: "there is nothing to group yet — read some asks first" };
    this.activity = { label: "grouping your sentences into things to build", current: 1, total: 1 };
    this.deps.onChanged?.();
    let proposed;
    try {
      proposed = await (this.deps.proposeSpecs ?? proposeSpecs)(
        { repoRoot: this.deps.round.repoRoot, model: this.deps.round.model },
        this.space,
      );
    } finally {
      this.activity = undefined;
    }
    if (!proposed) return { ok: false, reason: "I could not see sets in these — group them yourself" };
    this.space = { ...this.space, specs: specsFrom(proposed, (n) => `spec-${this.spaceName}-${n}`) };
    this.changed(`${this.space.specs!.length} sets, each worth delivering on its own.`);
    return { ok: true };
  }

  /**
   * Put one spec's promises in the cut, and nothing else.
   *
   * This is the whole point of the layer. Dispatch, the gate and the delivery
   * are already per-cut; what was missing was anything that ever put fewer
   * than everything into one. Nineteen asks went in together and came out
   * three days later as one delivery nobody could correct.
   *
   * Closed under needs like any other choice: a promise this one depends on
   * comes with it, or the work cannot stand.
   */
  async chooseSpec(specId: string): Promise<{ ok: boolean; reason?: string }> {
    if (this.running) return { ok: false, reason: "a run is in flight — stop it first" };
    const spec = (this.space.specs ?? []).find((s) => s.id === specId);
    if (!spec) return { ok: false, reason: `no set called '${specId}'` };
    // Choosing a set is what pays for working it out. Nothing is derived
    // from a set nobody chose, which is the whole saving: the sets you do
    // not build cost nothing to have considered.
    const todo = this.ungrounded(spec);
    if (todo.length) await groundSubjectFlow(this, todo);
    // Documentation is part of every delivery: when nothing in the thing
    // lands a page, the machine promises one, and "not needed" is the
    // person's move on the page, not "please document".
    const docs = documentationPromise(this.space, spec, (n) => `node-${this.author}-gap-${n}`);
    if (docs) this.space = { ...this.space, nodes: [...this.space.nodes, docs] };
    const ids = promisesOfSpec(this.space, spec);
    if (!ids.length)
      return { ok: false, reason: `nothing came out of "${spec.name}" — say more about it, or pick another set` };
    this.cutNodeIds = new Set();
    this.cutSpecId = spec.id;
    const r = addWithNeeds(this.cutNodeIds, ids, this.space.nodes, builtIds(this.space));
    this.changed(r.note ?? `"${spec.name}" — ${this.cutNodeIds.size} promise(s) to build and look at.`);
    return { ok: true };
  }

  /** Closed under needs: adds pull dependencies, removals drop dependents. */
  toggleCut(changeIds: string[]): void {
    // Touched by hand, the cut is no longer the set it was offered as.
    this.cutSpecId = undefined;
    const adding = changeIds.some((id) => !this.cutNodeIds.has(id));
    const r = adding
      ? addWithNeeds(this.cutNodeIds, changeIds, this.space.nodes, builtIds(this.space))
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

  /** The delivery, rendered for a person to read — in `./deliveryPage`.
   *  `surfaceText` is read once by the caller (a whole push, however many
   *  deliveries it carries) and handed to every delivery here — never
   *  re-read per delivery. Defaults to a fresh single read for callers
   *  (tests, the CLI) that render one delivery on its own. */
  deliveryPage = (deliveryId: string, surfaceText?: string): string | undefined =>
    deliveryPageOf(this, deliveryId, surfaceText ?? this.readBuiltSurfaceOnce());

  /** The built webview surface, read once through the injected reader and
   *  cached on this session — never re-read for a later push. A build does
   *  not change while this process is alive; reading it again on every
   *  push (or once per delivery within a push) is unneeded I/O with the
   *  same answer every time. */
  private _builtSurfaceText: string | undefined;
  readBuiltSurfaceOnce(): string {
    if (this._builtSurfaceText === undefined) {
      this._builtSurfaceText = builtSurfaceText(this.deps.readBuiltSurface);
    }
    return this._builtSurfaceText;
  }

  /** Gate 2. Acceptance in the engine's canonical order — merge → stamp →
   *  retire (best-effort) — refused without green proof BEFORE the merge. */
  async acceptDelivery(deliveryId: string): Promise<{ ok: boolean; reason?: string }> {
    this.acceptRefusal = undefined;
    const r = await acceptDeliveryGesture(this, deliveryId);
    if (!r.ok) {
      this.acceptRefusal = r.reason ?? "the delivery was not accepted";
      this.changed(this.acceptRefusal);
    }
    return r;
  }

  /** What the platform did with merged work, asked again: a verdict of
   *  "could not judge" is not an answer about the work, and the person can
   *  ask for another. */
  askPlatformAgain(): Promise<void> {
    this.space = {
      ...this.space,
      deliveries: this.space.deliveries.map((d) =>
        d.afterMerge?.outcome === "unjudged" ? { ...d, afterMerge: undefined } : d,
      ),
    };
    this.persist();
    return catchUpOnMergedWork(this);
  }

  /** A delivered promise, or one criterion of it, does not hold — kept in
   *  `./contradicting`. The mirror of attesting, and in half of this
   *  platform's targets the only word the world can send back. */
  contradict = (
    target: { promiseId?: string; criterionId?: string },
    said: string,
  ): { ok: boolean; reason?: string } => contradictOn(this, target, said);

  /** What only a person can settle, settled — kept in `./attesting`. */
  attestDelivery = (
    deliveryId: string,
    criterionId: string,
    held: boolean,
    note?: string,
  ): { ok: boolean; reason?: string } => attestOn(this, deliveryId, criterionId, held, note);

  /** Say no to a delivery: the work is taken back out of the project, and
   *  the cut goes back to signed so it can run again. */
  rejectDelivery(deliveryId: string): Promise<{ ok: boolean; reason?: string }> {
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
