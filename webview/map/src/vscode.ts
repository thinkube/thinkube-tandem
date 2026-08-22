/**
 * The postMessage bridge. The webview accepts exactly the session's
 * registered actions and renders exactly what the host pushes — no state
 * of its own beyond selection.
 */

/** One check, with its verification state — read on the claim card
 *  independently of how many iterations produced it. */
interface CheckVM {
  text: string;
  /** "assessment" = judged once at delivery by an independent reviewer;
   *  absent = a standing probe. */
  kind?: "assessment";
  /** The newest verdict any delivery recorded for this check. */
  verdict?: "green" | "red";
  tep?: string;
  accepted?: boolean;
  /** Where the standing proof lives in the repository's own suite. */
  proof?: { path: string; test?: string };
  /** The world moved since this was verified — proved-then, not proved-now. */
  drifted?: boolean;
}

interface PromiseVM {
  id: string;
  text: string;
  file: string;
  checks: CheckVM[];
  /** Effects the machine cannot verify, with the reason — notes, not checks. */
  unverified?: { text: string; why: string }[];
  needs: string[];
  inCut: boolean;
  stale: boolean;
  tep?: string;
}

interface ClaimVM {
  id: string;
  text: string;
  why?: string;
  /** The human's sentence this claim was read from — never replaced. */
  fromAsk: string;
  /** Its id and its number in your list, so the claim can point back. */
  fromAskId: string;
  fromAskN: number;
  promises: PromiseVM[];
}

interface SubjectVM {
  id: string;
  name: string;
  thinking?: { label: string; current: number; total: number };
  claims: ClaimVM[];
  /** The sentences of yours this object was read from — its provenance,
   *  shown so a second listing of your words reads as a link and not as
   *  repetition. */
  from: { id: string; n: number; text: string }[];
}

interface DeliveryVM {
  id: string;
  page: string;
  accepted: boolean;
  /** Why it cannot be accepted, from the gate that would refuse it. */
  blocked?: string;
  url?: string;
  undelivered?: string[];
  /** Why the delivery was withheld, and the signed work to run again. */
  withheld?: string;
  rerun?: { id: string; tepId?: string };
}

interface RunView {
  units: {
    id: string;
    slice: string;
    /** The slice in the human's words, when the space still knows it. */
    sliceTitle?: string;
    role: "code" | "test" | "maintain";
    /** What this unit builds, in the reading's own words. */
    what?: string;
    state: string;
    requires: string[];
    /** Why it waits, per edge: a cross-slice dependency, or the probes
     *  that must exist before a coder starts. */
    waits?: { on: string; kind: "needs" | "probes"; what?: string }[];
    startedAt?: number;
    question?: string;
    /** Why it failed, in the words the worker or the gate reported. */
    note?: string;
    /** What it is doing or waiting on right now, and since when. */
    activity?: { text: string; since: number };
  }[];
  logs: string[];
  parked: { unitId: string; question: string }[];
  /** How many lines each step holds — the surface pages them on demand. */
  logCounts: Record<string, number>;
}

export interface SpacePush {
  kind: "space";
  running: boolean;
  /** Where the space is in its sequence of steps — controls follow it. */
  phase: "drafting" | "read" | "understood" | "signed" | "running" | "delivered";
  /** The shaping actions the host acts on right now; a control for any
   *  other shaping action is disabled, and `post` drops it. */
  allowed: string[];
  /** Set when the space predates the model — readable, not writable. */
  legacy?: string;
  signedTeps: number;
  repoName?: string;
  /** Documentation excused for this cut, in the human's own words — absent
   *  when nothing has been excused. */
  docsExemption?: { reason: string };
  /** No repository chosen yet — the view renders the chooser state. */
  needsRepo?: boolean;
  /** Liveness: what the machine is doing right now, and for which ask. */
  activity?: { label: string; current: number; total: number; askId?: string };
  pendingCheck?: { changeId: string; text: string; kind: "probe" | "assessment" };
  /** Why the last build did not start — rendered on the flow tab. */
  runNote?: string;
  /** Work that was signed and never delivered — it can be run again. */
  unrun?: { id: string; tepId?: string };
  /** One live progress row per ask being grounded right now. */
  grounding?: { askId: string; label: string; current: number; total: number }[];
  run?: RunView;
  /** The step whose own log is open, one page of it. */
  /** The tail of one step's own log, and how long the whole log is. */
  runLog?: { step: string; lines: string[]; total: number; shown: number };
  questions: {
    id: string;
    text: string;
    recommendation?: string;
    askLabel?: string;
    cards: { id: string; title: string }[];
  }[];
  decisions: string[];
  /** Promises attached to no claim. `subject` names the subject the
   *  promise was derived for, when there is one — its absence is what
   *  makes a promise genuine scope creep. `choices` are the claims it
   *  could be attached to. */
  /** Promises the machine could not attach to any claim. */
  orphans: { id: string; text: string }[];
  /** Your sentences: what each decided, what was assumed in its name, and
   *  whether it is still yours to edit. */
  sentences: {
    id: string;
    text: string;
    state: "open" | "bound";
    subjects: number;
    promises: number;
    alsoReads: string[];
    amends?: string;
    /** What became of this ask's work: approved, delivered, or accepted
     *  into the project. Absent while the ask is still yours to edit. */
    bound?: { tep?: string; stage: "signed" | "delivered" | "accepted" };
    assumptions: { question: string; answer: string; clause?: string; assumed: boolean }[];
  }[];
  /** What thinking about what is left will cost. */
  cost: { subjects: number; rounds: number };
  /** What the machine read before the code moved under it: how many
   *  promises say something that may no longer be true, how many objects
   *  would be read again to settle them, and what that costs. */
  outOfDate: { promises: number; subjects: number; rounds: number };
  /** What can be committed right now. `thinking` means the machine is
   *  still deriving and nothing may be committed yet. */
  ready: { subjects: number; promises: number; asks: number; thinking: boolean };
  /** A reading that failed: nothing derived, and why. */
  modelFailure?: { reason: string; sentences: number };
  /** The model the round proposed, waiting for you. */
  /** What you are writing, kept with the space so it survives a reload. */
  draft: string;
  /** The reading of the draft, and whether it still matches what is
   *  written: subjects with their claims, each claim carrying the words
   *  it was read from, the pronoun that stood for the subject, and any
   *  earlier claim it displaces. */
  pendingModel?: {
    subjects: {
      name: string;
      from: number[];
      claims: {
        text: string;
        why?: string;
        from: number;
        quote?: string;
        mention?: string;
        replaces?: string;
      }[];
    }[];
    /** The sentences it was read from, in order — what the marks are
     *  drawn on. Recorded asks first, then what is still written. */
    texts: string[];
    /** The tail of `texts` that is still yours to change: what the words
     *  in the box were read as. Compared with the box to know whether the
     *  reading is behind. */
    fresh: string[];
    missing: string[];
  };
  impacts: { id: string; decision: string; askText: string; affected: number }[];
  subjects: SubjectVM[];
  cutCount: number;
  deliveries: DeliveryVM[];
  message?: string;
}

export type WebToHost =
  | { action: "save-draft"; text: string }
  | { action: "read-draft" }
  | { action: "keep-draft" }
  | { action: "cancel-capture" }
  | { action: "reground" }
  | { action: "open-cut-review" }
  | { action: "excuse-docs"; text: string }
  | { action: "answer-worker"; unitId: string; text: string }
  | { action: "retry-model" }
  | { action: "reframe"; unitId: string; text: string }
  | { action: "amend"; unitId: string; text: string }
  | { action: "think" }
  | { action: "build"; changeIds?: string[] }
  | { action: "dismiss-promise"; unitId: string; text?: string }
  | { action: "read-log"; stepId?: string }
  | { action: "stop-run" }
  | { action: "pin"; pinKind: "together" | "apart"; changeIds: [string, string] }
  | { action: "select-unit"; unitId: string }
  | { action: "accept-delivery"; deliveryId: string }
  | { action: "panic" }
  | { action: "rerun" }
  | { action: "accept-question"; questionId: string; text?: string }
  | { action: "accept-impact"; impactId: string }
  | { action: "dismiss-impact"; impactId: string }
  | { action: "apply-all-impacts" }
  | { action: "propose-check"; changeIds: string[] }
  | { action: "accept-check"; changeIds: string[]; text: string; kind: "probe" | "assessment" }
  | { action: "switch-repo" };

interface VsCodeApi {
  postMessage(msg: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const api: VsCodeApi =
  typeof acquireVsCodeApi === "function"
    ? acquireVsCodeApi()
    : { postMessage: () => {} };

/** The shaping actions the host allows right now, from the last push.
 *  Before the first push nothing is known, so nothing is refused here —
 *  the host still refuses on its side. */
let allowedNow: string[] | undefined;
/** What the host allows now — set by every push, and by a harness that
 *  renders the surface without a host. */
export function noteAllowed(allowed: string[] | undefined): void {
  allowedNow = allowed;
}
const SHAPING = new Set([
  "read-draft", "keep-draft", "cancel-capture", "capture-many", "think", "reground", "reframe",
  "amend", "dismiss-promise", "propose-check", "accept-check", "accept-question", "accept-impact",
  "dismiss-impact", "apply-all-impacts", "open-cut-review", "excuse-docs", "build", "rerun",
  "stop-run", "accept-delivery", "panic", "switch-repo",
]);

/** Whether the host would act on this action now. Non-shaping actions
 *  (reading a log, selecting, answering a worker, saving text) are always on. */
export function can(action: string): boolean {
  if (!SHAPING.has(action)) return true;
  return !allowedNow || allowedNow.includes(action);
}

/** Why a control is off, for its tooltip — one sentence per phase. */
export function whyNot(phase: SpacePush["phase"] | undefined): string {
  switch (phase) {
    case "running": return "A run is in flight — stop it first.";
    case "signed": return "Signed work is waiting to run — run it, or it stays as it is.";
    case "delivered": return "A delivery is waiting for your decision.";
    case "read": return "The reading is waiting for keep or edit.";
    case "drafting": return "Nothing has been read yet.";
    default: return "Not now.";
  }
}

export function post(msg: WebToHost): void {
  if (!can(msg.action)) return;
  api.postMessage(msg);
}


export function onSpace(handler: (push: SpacePush) => void): () => void {
  const listener = (ev: MessageEvent) => {
    const data = ev.data as SpacePush;
    if (data && data.kind === "space") {
      if (Array.isArray(data.allowed)) noteAllowed(data.allowed);
      handler(data);
    }
  };
  window.addEventListener("message", listener);
  api.postMessage({ action: "load" });
  return () => window.removeEventListener("message", listener);
}
