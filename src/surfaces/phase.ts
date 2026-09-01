/**
 * The phase of a space: one word the host and the surface both read, so a
 * control is enabled exactly when the host would act on it and disabled when
 * it would refuse. The table here is the only copy — the surface receives
 * the allowed list with every push and never decides on its own.
 */
import type { TandemSession } from "./session";
import { refusalSentence } from "./surfaceContract";
import { ACTIONS, liveIn } from "./actions";
import type { Phase } from "./actions";

/** Where the space is in its sequence of steps: one word the surface and
 *  the host both read, so a control is enabled exactly when the host would
 *  act on it and disabled when it would refuse.
 *
 *    drafting   nothing read yet — whether there is text to read is the box's
 *               own knowledge (typing is not pushed), never the host's
 *    read       read, waiting for keep or edit
 *    understood asks recorded and derived; nothing signed or running
 *    signed     a cut signed and not delivered (waiting to run, stopped, or withheld)
 *    running    a run in flight
 *    delivered  a delivery waiting for accept/reject
 */
export type { Phase } from "./actions";

export function phaseOf(session: TandemSession): Phase {
  if (session.running) return "running";
  if (session.space.deliveries.some((d) => !d.acceptedAt && !d.withheld && !d.rejectedAt)) return "delivered";
  if (session.unrunCut()) return "signed";
  if (session.pendingModel) return "read";
  if (session.space.subjects?.length || session.space.nodes.length) return "understood";
  return "drafting";
}

/** The shaping actions the host acts on in this phase — sent with every
 *  push so the surface enables exactly these and nothing else. Read from
 *  the one declaration in `actions.ts`; there is no second table here. */
export function allowedNow(phase: Phase): string[] {
  return liveIn(phase);
}

/** Why an action is refused now, or nothing — the same sentence
 *  `refusalSentence` gives the surface for this action and phase, so the
 *  host and the surface never say two different things about one press. */
export function refusedNow(action: string, phase: Phase): string | undefined {
  const a = ACTIONS[action];
  if (!a?.when || a.when.includes(phase)) return undefined;
  return refusalSentence(action, phase);
}
