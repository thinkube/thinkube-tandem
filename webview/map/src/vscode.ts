/**
 * The postMessage bridge. The webview accepts exactly the session's
 * registered actions and renders exactly what the host pushes — no state
 * of its own beyond selection.
 */

export interface UnitVM {
  id: string;
  title: string;
  count: number;
  changeIds: string[];
  island: number;
  inCut: boolean;
  /** Some of this unit's grounding no longer matches the repo. */
  stale: boolean;
  /** The machine face: the unit's nodes with grounding, for the flip. */
  nodes: { id: string; sentence: string; touchpoints: string[]; acceptance: string[] }[];
}

interface DeliveryVM {
  id: string;
  page: string;
  accepted: boolean;
  url?: string;
  undelivered?: string[];
}

interface RunView {
  units: { id: string; slice: string; role: "code" | "test"; state: string; question?: string }[];
  logs: string[];
  parked: { unitId: string; question: string }[];
}

export interface SpacePush {
  kind: "space";
  running: boolean;
  asks: { id: string; text: string }[];
  signedTeps: number;
  repoName?: string;
  run?: RunView;
  questions: { id: string; text: string; recommendation?: string }[];
  decisions: string[];
  units: UnitVM[];
  edges: { from: string; to: string }[];
  cutScreen: string;
  cutCount: number;
  deliveries: DeliveryVM[];
  message?: string;
}

export type WebToHost =
  | { action: "capture"; text: string }
  | { action: "reground" }
  | { action: "answer-worker"; unitId: string; text: string }
  | { action: "stop-run" }
  | { action: "accept-question"; questionId: string; text?: string }
  | { action: "pin"; pinKind: "together" | "apart"; changeIds: [string, string] }
  | { action: "select-unit"; unitId: string }
  | { action: "toggle-cut"; changeIds: string[] }
  | { action: "sign-cut" }
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

export function onSpace(handler: (push: SpacePush) => void): () => void {
  const listener = (ev: MessageEvent) => {
    const data = ev.data as SpacePush;
    if (data && data.kind === "space") handler(data);
  };
  window.addEventListener("message", listener);
  api.postMessage({ action: "load" });
  return () => window.removeEventListener("message", listener);
}
