/**
 * Webview root. Sources the thinking space from the host on mount, provides it through
 * the (vendored-shape) GlobalContext, and persists local mutations back to the
 * host.
 *
 * It also owns the delivery-exit button models (SP-11/2): the host forwards each Spec's
 * state-derived exit set (`delivery-exits`), which this root reduces through the shared
 * `buttonModel` reducer so a double-click is refused rather than double-dispatched. The
 * models flow to the (lazily-mounted) control-center graph via {@link DeliveryExitsContext},
 * since the graph view only mounts when its tab is active and would otherwise miss the
 * exit sets pushed while the kanban tab was showing.
 */
import { createContext, useEffect, useState } from "react";
import { KanbanView } from "./components/kanban";
import { GlobalContext } from "./utils/context";
import { onHostMessage, postToHost } from "./utils/vscode";
import { ThinkingSpace, ModeFlag, ExitActionId, WebviewMessage } from "./types";
// The webview renders/dispatches its delivery-exit buttons SOLELY from the shared
// host-side reducer (esbuild follows this relative import into the bundle; the
// module's only dependency is a type-only `ExitAction` import, so nothing else
// crosses over). One source of truth for the button half — no second derivation.
import {
  ButtonModel,
  buttonModel,
  click,
  reconcile,
} from "../../../src/views/kanban/host/buttonModel";

const EMPTY_THINKING_SPACE: ThinkingSpace = {
  columns: [],
  tasks: {},
  scope: "",
};

/**
 * Delivery-exit button models keyed by Spec id, plus the dispatcher the graph calls
 * on a button press. `dispatch(spec, actionId)` routes through the shared reducer:
 * nothing pending → mark pending + post the mapped host message; already pending →
 * a no-op (idempotent). A fresh `delivery-exits` push reconciles the model (pending
 * cleared, exits re-enabled).
 */
export interface DeliveryExits {
  models: Record<string, ButtonModel>;
  dispatch: (spec: string, actionId: ExitActionId) => void;
}

export const DeliveryExitsContext = createContext<DeliveryExits>({
  models: {},
  dispatch: () => {},
});

/** Map a state-derived exit id to the host message that services it. */
function exitMessage(spec: string, actionId: ExitActionId): WebviewMessage {
  switch (actionId) {
    case "accept":
      // Delivered: run the gated merge spec/SP-{n} → main.
      return { kind: "accept", spec };
    case "request-changes":
    case "attend":
      // Open a Claude session primed with the delivery report (the spec-level analog
      // of /attend) — the delivered rework exit and the stalled attend exit both land
      // here; the prefill differs by state, the host action is one primed session.
      return { kind: "reject", spec };
    case "rerun":
      // Stalled: re-dispatch the makespan scheduler on the Spec.
      return { kind: "rerun", spec };
  }
}

export function App(): JSX.Element {
  const [thinkingSpace, setThinkingSpace] =
    useState<ThinkingSpace>(EMPTY_THINKING_SPACE);
  const [mode, setMode] = useState<ModeFlag>("both");
  const [exitModels, setExitModels] = useState<Record<string, ButtonModel>>({});

  useEffect(() => {
    const unsubscribe = onHostMessage((msg) => {
      if (msg.kind === "state" || msg.kind === "external-change") {
        setThinkingSpace(msg.thinkingSpace);
        setMode(msg.mode);
      } else if (msg.kind === "delivery-exits") {
        // A fresh exit set is the reconcile status event: replace the model, clearing
        // any pending action and re-enabling every exit.
        setExitModels((prev) => ({
          ...prev,
          [msg.spec]: reconcile(
            prev[msg.spec] ?? buttonModel(msg.exits),
            msg.exits,
          ),
        }));
      }
    });
    postToHost({ kind: "load" });
    return unsubscribe;
  }, []);

  const setState = (next: ThinkingSpace) => {
    setThinkingSpace(next);
    postToHost({ kind: "save", thinkingSpace: next });
  };

  const dispatchExit = (spec: string, actionId: ExitActionId) => {
    const model = exitModels[spec];
    if (!model) return;
    // Decide dispatch from the reducer (idempotent: refused while an action is pending),
    // then post the host message exactly once — the state update recomputes the same click.
    const { dispatch } = click(model, actionId);
    if (dispatch) postToHost(exitMessage(spec, actionId));
    setExitModels((prev) => {
      const current = prev[spec];
      if (!current) return prev;
      return { ...prev, [spec]: click(current, actionId).model };
    });
  };

  return (
    <GlobalContext.Provider value={{ state: thinkingSpace, setState }}>
      <DeliveryExitsContext.Provider
        value={{ models: exitModels, dispatch: dispatchExit }}
      >
        <KanbanView mode={mode} />
      </DeliveryExitsContext.Provider>
    </GlobalContext.Provider>
  );
}
