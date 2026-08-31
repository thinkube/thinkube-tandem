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
import { can, noteAllowed, noteRefusal, refusalIfRefused } from "../../../src/surfaces/surfaceContract";
import type { SpacePush, WebToHost } from "../../../src/surfaces/surfaceContract";

export {
  can,
  noteAllowed,
  refusalSentence,
  refusalIfRefused,
  SHAPING,
} from "../../../src/surfaces/surfaceContract";
export type { SpacePush, WebToHost } from "../../../src/surfaces/surfaceContract";
export { SURFACE_PAGES } from "../../../src/surfaces/surfaceLayout";

interface VsCodeApi {
  postMessage(msg: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const api: VsCodeApi =
  typeof acquireVsCodeApi === "function"
    ? acquireVsCodeApi()
    : { postMessage: () => {} };

/** Who to tell when a press was refused — the panel's own message line,
 *  so it can show the sentence the moment the press happens rather than
 *  waiting for the next push. */
let onRefusal: ((sentence: string) => void) | undefined;
export function watchRefusals(handler: (sentence: string) => void): () => void {
  onRefusal = handler;
  return () => {
    if (onRefusal === handler) onRefusal = undefined;
  };
}

/** Send a governed press to the host, or — when the phase refuses it —
 *  record the sentence for it through the contract and send nothing. A
 *  refused press is never silently dropped: the watcher registered through
 *  `watchRefusals` carries the sentence straight to the panel's message
 *  line. */
export function post(msg: WebToHost): void {
  const refusal = refusalIfRefused(msg.action);
  if (refusal) {
    noteRefusal(refusal);
    onRefusal?.(refusal);
    return;
  }
  api.postMessage(msg);
}

export function onSpace(handler: (push: SpacePush) => void): () => void {
  const listener = (ev: MessageEvent) => {
    const data = ev.data as SpacePush;
    if (data && data.kind === "space") {
      if (Array.isArray(data.allowed)) noteAllowed(data.allowed, data.phase);
      handler(data);
    }
  };
  window.addEventListener("message", listener);
  post({ action: "load" });
  return () => window.removeEventListener("message", listener);
}
