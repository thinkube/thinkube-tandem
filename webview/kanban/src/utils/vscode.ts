/**
 * Thin wrapper around the webview's `acquireVsCodeApi()` handle.
 *
 * Exported as a singleton — VS Code throws if `acquireVsCodeApi` is called
 * more than once per webview, and modules can be re-imported under HMR.
 *
 * Outside the VS Code host (e.g. when running `vite preview` in a plain
 * browser for visual tweaks), the function is undefined; we fall back to
 * console logging so the UI still mounts.
 */
import type { HostMessage, WebviewMessage } from "../types";

declare global {
  function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
  };
}

const handle = (() => {
  try {
    return typeof acquireVsCodeApi === "function"
      ? acquireVsCodeApi()
      : undefined;
  } catch {
    return undefined;
  }
})();

export function postToHost(message: WebviewMessage): void {
  if (handle) {
    handle.postMessage(message);
  } else {
    console.info("[kanban] (no host) →", message);
  }
}

export function onHostMessage(cb: (message: HostMessage) => void): () => void {
  const listener = (ev: MessageEvent<HostMessage>) => {
    if (!ev.data || typeof ev.data !== "object") return;
    cb(ev.data);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
