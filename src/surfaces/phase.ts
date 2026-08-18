/**
 * The phase of a space: one word the host and the surface both read, so a
 * control is enabled exactly when the host would act on it and disabled when
 * it would refuse. The table here is the only copy — the surface receives
 * the allowed list with every push and never decides on its own.
 */
import type { TandemSession } from "./session";

/** Where the space is in its sequence of steps: one word the surface and
 *  the host both read, so a control is enabled exactly when the host would
 *  act on it and disabled when it would refuse.
 *
 *    empty      nothing written
 *    drafting   text in the box, not yet read
 *    read       read, waiting for keep or edit
 *    understood asks recorded and derived; nothing signed or running
 *    signed     a cut signed and not delivered (waiting to run, stopped, or withheld)
 *    running    a run in flight
 *    delivered  a delivery waiting for accept/reject
 */
export type Phase = "empty" | "drafting" | "read" | "understood" | "signed" | "running" | "delivered";

export function phaseOf(session: TandemSession): Phase {
  if (session.running) return "running";
  if (session.space.deliveries.some((d) => !d.acceptedAt && !d.withheld)) return "delivered";
  if (session.unrunCut()) return "signed";
  if (session.pendingModel) return "read";
  if (session.space.subjects?.length || session.space.nodes.length) return "understood";
  if ((session.space.draft ?? "").trim()) return "drafting";
  return "empty";
}

/** The controls that shape work, and the phases in which the host acts on
 *  each. Every other action (reading a log, selecting a unit, answering a
 *  parked worker, saving the draft text, switching space) is always on. */
const OPEN: readonly Phase[] = ["understood", "delivered"];
const ALLOWED: Partial<Record<string, readonly Phase[]>> = {
  "read-draft": ["drafting", "read", "understood", "delivered"],
  "keep-draft": ["read"],
  "cancel-capture": ["read"],
  "capture-many": ["read"],
  think: OPEN,
  reground: OPEN,
  reframe: OPEN,
  amend: OPEN,
  "dismiss-promise": OPEN,
  "propose-check": OPEN,
  "accept-check": OPEN,
  "accept-question": OPEN,
  "accept-impact": OPEN,
  "dismiss-impact": OPEN,
  "apply-all-impacts": OPEN,
  "open-cut-review": OPEN,
  build: OPEN,
  rerun: ["signed"],
  "stop-run": ["running"],
  "accept-delivery": ["delivered"],
  panic: ["drafting", "read", "understood"],
  "switch-repo": ["empty", "drafting", "read", "understood", "signed", "delivered"],
};

/** The shaping actions the host acts on in this phase — sent with every
 *  push so the surface enables exactly these and nothing else. */
export function allowedNow(phase: Phase): string[] {
  return Object.entries(ALLOWED).filter(([, phases]) => phases!.includes(phase)).map(([a]) => a);
}

/** Why an action is refused now, or nothing. */
export function refusedNow(action: string, phase: Phase): string | undefined {
  const allowed = ALLOWED[action];
  if (!allowed || allowed.includes(phase)) return undefined;
  const why: Record<Phase, string> = {
    running: "a run is in flight — stop it first",
    signed: "signed work is waiting to run — run it, or it stays as it is",
    delivered: "a delivery is waiting for your decision",
    read: "the reading is waiting for keep or edit",
    understood: "nothing is signed or running",
    drafting: "nothing has been read yet",
    empty: "nothing has been written yet",
  };
  return `not now: ${why[phase]}`;
}
