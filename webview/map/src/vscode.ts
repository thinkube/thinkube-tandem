/**
 * The postMessage bridge. The webview accepts exactly the session's
 * registered actions and renders exactly what the host pushes — no state
 * of its own beyond selection.
 *
 * What the two sides agree on — the push, the actions, and which of them
 * the phase governs — lives in the host's tree and is re-exported here, so
 * the surface's files import it from one place and the contract has one
 * home. What stays here is what only a webview has: the vscode api handle
 * and the window listener.
 */
import { can, noteAllowed } from "../../../src/surfaces/surfaceContract";
import type { SpacePush, WebToHost } from "../../../src/surfaces/surfaceContract";

export { can, noteAllowed, whyNot } from "../../../src/surfaces/surfaceContract";
export type { SpacePush, WebToHost } from "../../../src/surfaces/surfaceContract";

interface VsCodeApi {
  postMessage(msg: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const api: VsCodeApi =
  typeof acquireVsCodeApi === "function"
    ? acquireVsCodeApi()
    : { postMessage: () => {} };

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
