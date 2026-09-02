/**
 * The page is the state. Nothing is navigated: what the space is doing
 * decides what is on screen, the way the mock's states follow each other.
 *
 * Write while there is nothing read; your sentences once they are; what
 * it will do once a thing is chosen and worked out; the run while it
 * runs; what came back once it is delivered and not yet accepted. One
 * rule, decided from the push, so a page can never be reached in a state
 * that has nothing to show on it.
 */
import type { SpacePush } from "./surfaceContract";
import type { SurfacePage } from "./surfaceLayout";

export function pageFor(push: SpacePush): SurfacePage {
  if (push.running || push.run?.parked?.length) return "flow";
  if (push.deliveries.some((d) => !d.accepted)) return "flow";
  if (push.pendingModel || push.sentences.length === 0) return "write";
  const chosen = (push.specs ?? []).some((sp) => sp.chosen);
  const working = !!push.activity || (push.grounding?.length ?? 0) > 0;
  if (chosen && !working && push.cost.subjects === 0 && (push.ready.promises > 0 || push.signedIdle)) return "work";
  return "intent";
}

/** On the run page: the workers while they run, the report once they have. */
export function flowViewFor(push: SpacePush): "workers" | "report" {
  return push.running || !push.deliveries.length ? "workers" : "report";
}
