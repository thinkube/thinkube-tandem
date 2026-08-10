/**
 * The postMessage bridge. The webview accepts exactly the session's
 * registered actions and renders exactly what the host pushes — no state
 * of its own beyond selection.
 */

interface PromiseVM {
  id: string;
  text: string;
  file: string;
  checks: string[];
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
  url?: string;
  undelivered?: string[];
}

interface RunView {
  units: {
    id: string;
    slice: string;
    /** The slice in the human's words, when the space still knows it. */
    sliceTitle?: string;
    role: "code" | "test";
    state: string;
    requires: string[];
    startedAt?: number;
    question?: string;
    /** Why it failed, in the words the worker or the gate reported. */
    note?: string;
  }[];
  logs: string[];
  parked: { unitId: string; question: string }[];
  /** How many lines each step holds — the surface pages them on demand. */
  logCounts: Record<string, number>;
}

export interface SpacePush {
  kind: "space";
  running: boolean;
  /** Set when the space predates the model — readable, not writable. */
  legacy?: string;
  asks: { id: string; text: string }[];
  signedTeps: number;
  repoName?: string;
  /** No repository chosen yet — the view renders the chooser state. */
  needsRepo?: boolean;
  /** Liveness: what the machine is doing right now, and for which ask. */
  activity?: { label: string; current: number; total: number; askId?: string };
  /** The in-board answer to the latest question-classified input. */
  lastAnswer?: { question: string; answer: string };
  pendingCheck?: { changeId: string; text: string; kind: "probe" | "assessment" };
  /** Why the last build did not start — rendered on the flow tab. */
  runNote?: string;
  /** One live progress row per ask being grounded right now. */
  grounding?: { askId: string; label: string; current: number; total: number }[];
  run?: RunView;
  /** The step whose own log is open, one page of it. */
  runLog?: {
    step: string;
    lines: string[];
    page: number;
    pages: number;
    total: number;
    pageSize: number;
  };
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
    tep?: string;
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
  ready: { subjects: number; promises: number; thinking: boolean };
  /** A reading that failed: nothing derived, and why. */
  modelFailure?: { reason: string; sentences: number };
  /** The model the round proposed, waiting for you. */
  pendingModel?: {
    subjects: { name: string; claims: { text: string; why?: string }[] }[];
    missing: string[];
  };
  impacts: { id: string; decision: string; askText: string; affected: number }[];
  subjects: SubjectVM[];
  cutScreen: string;
  cutCount: number;
  deliveries: DeliveryVM[];
  message?: string;
}

export interface DraftPush {
  kind: "draft";
  text: string;
  guessed: string;
  items?: string[];
}

export type WebToHost =
  | { action: "classify"; text: string }
  | { action: "capture"; text: string; kind: string }
  | { action: "capture-many"; items: string[] }
  | { action: "cancel-capture" }
  | { action: "reground" }
  | { action: "open-cut-review" }
  | { action: "answer-worker"; unitId: string; text: string }
  | { action: "retry-model" }
  | { action: "reframe"; unitId: string; text: string }
  | { action: "amend"; unitId: string; text: string }
  | { action: "think" }
  | { action: "build"; changeIds?: string[] }
  | { action: "dismiss-promise"; unitId: string; text?: string }
  | { action: "read-log"; stepId?: string; page?: number }
  | { action: "stop-run" }
  | { action: "pin"; pinKind: "together" | "apart"; changeIds: [string, string] }
  | { action: "select-unit"; unitId: string }
  | { action: "accept-delivery"; deliveryId: string }
  | { action: "panic" }
  | { action: "switch-repo" };

interface VsCodeApi {
  postMessage(msg: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const api: VsCodeApi =
  typeof acquireVsCodeApi === "function"
    ? acquireVsCodeApi()
    : { postMessage: () => {} };

export function post(msg: WebToHost): void {
  api.postMessage(msg);
}

export function onDraft(handler: (d: DraftPush) => void): () => void {
  const listener = (e: MessageEvent): void => {
    const data = e.data as DraftPush;
    if (data && data.kind === "draft") handler(data);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

export function onSpace(handler: (push: SpacePush) => void): () => void {
  const listener = (ev: MessageEvent) => {
    const data = ev.data as SpacePush;
    if (data && data.kind === "space") handler(data);
  };
  window.addEventListener("message", listener);
  api.postMessage({ action: "load" });
  return () => window.removeEventListener("message", listener);
}
