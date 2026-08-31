/**
 * The single rule that decides which page the space surface shows.
 *
 * A push from the host never moves the page — it only ever reports what
 * happened. The one exception is a move the reader asked for earlier
 * ("take me to the work once it's worked out"): that move is armed by a
 * reader-awaits-work event and only lands on a later push, and only when
 * the push says the work is worked out. Every other move — choosing a
 * tab, choosing workers or the delivery report — is a reader gesture and
 * takes effect immediately.
 */

type SurfaceTab = "write" | "intent" | "work" | "flow";
type FlowView = "workers" | "report";

export interface ViewState {
  tab: SurfaceTab;
  flowView: FlowView;
  awaited: SurfaceTab | null;
}

export type ViewEvent =
  | { kind: "reader-tab"; tab: SurfaceTab; hasReport: boolean }
  | { kind: "reader-flow-view"; view: FlowView }
  | { kind: "reader-awaits-work" }
  | { kind: "push"; workedOut: boolean };

export function nextView(state: ViewState, event: ViewEvent): ViewState {
  switch (event.kind) {
    case "reader-tab":
      return {
        tab: event.tab,
        flowView: event.tab === "flow" ? (event.hasReport ? "report" : "workers") : state.flowView,
        awaited: null,
      };
    case "reader-flow-view":
      return { ...state, flowView: event.view };
    case "reader-awaits-work":
      return { ...state, awaited: "work" };
    case "push":
      if (state.awaited === "work" && event.workedOut) {
        return { ...state, tab: "work", awaited: null };
      }
      return state;
    default:
      return state;
  }
}
