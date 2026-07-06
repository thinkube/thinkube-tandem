/**
 * Pure button-model reducer for the kanban delivery-exit surface (SP-11/2, SL-2).
 *
 * One source of truth for the button half: the exit set arrives as {@link ExitAction}s
 * (ids + labels) derived from the run's terminal state, and this reducer tracks which
 * action is pending so a double-click is refused rather than double-dispatched. The
 * webview package (`webview/kanban/`) imports this module into its bundle and
 * renders/dispatches solely from it; `Panel.ts` sends the status events (fresh exit
 * sets) that {@link reconcile}.
 *
 * No VS Code, no DOM, no I/O — a plain reducer so the seam is unit-verifiable.
 */
import type { ExitAction } from "../../../services/orchestratorCore";

export interface ButtonModel {
  exits: ExitAction[];
  /** The action id awaiting a status event, or null when all actions are re-enabled. */
  pending: string | null;
}

/** Fresh model for an exit set — nothing pending, every action dispatchable. */
export function buttonModel(exits: ExitAction[]): ButtonModel {
  return { exits, pending: null };
}

/**
 * Reduce a click into the next model + whether to dispatch.
 *
 * - Nothing pending → mark `actionId` pending and dispatch (instant feedback).
 * - Something already pending → refuse: return the SAME model reference and
 *   `dispatch: false`, for ANY `actionId` (idempotent; the double-click is a no-op
 *   until a status event reconciles).
 */
export function click(
  model: ButtonModel,
  actionId: string,
): { model: ButtonModel; dispatch: boolean } {
  if (model.pending !== null) {
    return { model, dispatch: false };
  }
  return { model: { ...model, pending: actionId }, dispatch: true };
}

/**
 * A status event carries the current exit set; return a fresh model from it with
 * `pending: null` — all actions re-enabled.
 */
export function reconcile(
  model: ButtonModel,
  exits: ExitAction[],
): ButtonModel {
  return { exits, pending: null };
}
