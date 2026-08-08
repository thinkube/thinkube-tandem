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
  promises: PromiseVM[];
}

interface SubjectVM {
  id: string;
  name: string;
  rules: { id: string; text: string }[];
  thinking?: { label: string; current: number; total: number };
  claims: ClaimVM[];
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
  rules: { id: string; text: string; scope: string; governs: number; fromAsk: string }[];
  /** Promises attached to no claim — scope creep, named on the map. */
  orphans: { id: string; text: string }[];
  /** The model the round proposed, waiting for you. */
  pendingModel?: {
    subjects: { name: string; claims: { text: string; why?: string }[] }[];
    rules: { text: string; scope: string }[];
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
  | { action: "propose-check"; changeIds: string[] }
  | { action: "accept-check"; changeIds: string[]; text: string; kind: string }
  | { action: "answer-worker"; unitId: string; text: string }
  | { action: "accept-model" }
  | { action: "revise-model"; kind: "drop-subject" | "drop-rule" | "to-rule"; page: number }
  | { action: "read-log"; stepId?: string; page?: number }
  | { action: "stop-run" }
  | { action: "accept-question"; questionId: string; text?: string }
  | { action: "pin"; pinKind: "together" | "apart"; changeIds: [string, string] }
  | { action: "select-unit"; unitId: string }
  | { action: "toggle-cut"; changeIds: string[] }
  | { action: "sign-cut" }
  | { action: "accept-delivery"; deliveryId: string }
  | { action: "accept-impact"; impactId: string }
  | { action: "dismiss-impact"; impactId: string }
  | { action: "apply-all-impacts" }
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
