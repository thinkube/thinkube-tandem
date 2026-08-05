/**
 * The postMessage bridge. The webview accepts exactly the session's
 * registered actions and renders exactly what the host pushes — no state
 * of its own beyond selection.
 */

export interface UnitVM {
  id: string;
  title: string;
  count: number;
  nodeIds: string[];
  island: number;
  inCut: boolean;
  /** The machine face: the unit's nodes with grounding, for the flip. */
  nodes: { id: string; sentence: string; touchpoints: string[]; checks: string[] }[];
}

export interface DeliveryVM {
  id: string;
  page: string;
  accepted: boolean;
}

export interface SpacePush {
  kind: "space";
  units: UnitVM[];
  edges: { from: string; to: string }[];
  cutScreen: string;
  cutCount: number;
  deliveries: DeliveryVM[];
  message?: string;
}

export type WebToHost =
  | { action: "capture"; text: string }
  | { action: "select-unit"; unitId: string }
  | { action: "toggle-cut"; nodeIds: string[] }
  | { action: "sign-cut" }
  | { action: "accept-delivery"; deliveryId: string };

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
