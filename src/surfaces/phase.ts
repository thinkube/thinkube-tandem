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
 *    drafting   nothing read yet — whether there is text to read is the box's
 *               own knowledge (typing is not pushed), never the host's
 *    read       read, waiting for keep or edit
 *    understood asks recorded and derived; nothing signed or running
 *    signed     a cut signed and not delivered (waiting to run, stopped, or withheld)
 *    running    a run in flight
 *    delivered  a delivery waiting for accept/reject
 */
export type Phase = "drafting" | "read" | "understood" | "signed" | "running" | "delivered";

export function phaseOf(session: TandemSession): Phase {
  if (session.running) return "running";
  if (session.space.deliveries.some((d) => !d.acceptedAt && !d.withheld && !d.rejectedAt)) return "delivered";
  if (session.unrunCut()) return "signed";
  if (session.pendingModel) return "read";
  if (session.space.subjects?.length || session.space.nodes.length) return "understood";
  return "drafting";
}

/** The controls that shape work, and the phases in which the host acts on
 *  each. Every other action (reading a log, selecting a unit, answering a
 *  parked worker, saving the draft text, switching space) is always on. */
const OPEN: readonly Phase[] = ["understood", "delivered"];
const ALLOWED: Partial<Record<string, readonly Phase[]>> = {
  // Whether there is text to read is the box's own knowledge.
  "read-draft": ["drafting", "read", "understood", "delivered"],
  "keep-draft": ["read"],
  "cancel-capture": ["read"],
  "capture-many": ["read"],
  // The intent page's "see what this will build" keeps the reading first.
  think: ["read", ...OPEN],
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
  "docs-not-needed": OPEN,
  build: OPEN,
  rerun: ["signed", "delivered"],
  "think-again": ["signed"],
  "stop-run": ["running"],
  "accept-delivery": ["delivered"],
  "reject-delivery": ["delivered"],
  panic: ["drafting", "read", "understood"],
  "switch-repo": ["drafting", "read", "understood", "signed", "delivered"],
};

/**
 * Every shaping action this table governs.
 *
 * An action missing from the table is not merely ungoverned: `refusedNow`
 * refuses it in no phase, and `allowedNow` never lists it, so the host
 * always acts on it and the surface never enables its control. The two
 * halves fail in opposite directions and neither says anything. A unit
 * that built a new control once discovered this from the inside and had
 * no way to fix it — the table is not its to write.
 */
export function gatedActions(): string[] {
  return Object.keys(ALLOWED);
}

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
  };
  return `not now: ${why[phase]}`;
}
