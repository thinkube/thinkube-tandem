/**
 * A card's state, said twice: a tone for its frame and a short word that
 * survives being drawn small. Colour alone is not a word — at the zoom
 * where chips are dropped, the frame is the only thing left, so it must
 * carry the state on its own.
 *
 * The in-cut mark ("cut", coloured gold) says a card is part of the signed
 * work. It is a different fact from a card's live state, so no state tone
 * may reuse "cut" or gold — a card can be both in the cut and running, and
 * the two marks must stay visually distinct.
 *
 * Reached from webview/map/src/proto/nodeCard.tsx and
 * webview/map/src/Run.tsx, which the webview workspace's own entry point
 * reaches.
 */

export function stateFace(state: string): { word: string; tone: "run" | "q" | "pass" | "na" | "idle" | "block"; why: string } {
  switch (state) {
    case "ready":
      return { word: "ready", tone: "idle", why: "Waiting for what it needs before it can start." };
    case "running":
      return { word: "running", tone: "run", why: "Working right now." };
    case "parked":
      return { word: "needs you", tone: "q", why: "Stopped on a question only you can answer." };
    case "done":
      return { word: "passed", tone: "pass", why: "Finished and its checks came back green." };
    case "failed":
      return { word: "failed", tone: "na", why: "Stopped with an error — its promise was not kept." };
    case "blocked":
      return { word: "never ran", tone: "block", why: "The run stopped, or something this waits on failed, so this was never dispatched." };
    default:
      return { word: state || "unknown", tone: "idle", why: "An unrecognised state." };
  }
}
