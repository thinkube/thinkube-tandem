/**
 * Doors: a claim that needs a person to act needs a place to act — a
 * control that actually renders. The machine proves it, never the human:
 * code that can perform a cut with no button reaching it is a defect the
 * machine reports, and a delivery whose claim needs a door that is not
 * there is undelivered and named.
 *
 * The registry alone cannot prove this. It records that an action has a
 * surface and a gesture, but an entry can describe a button nobody built.
 * The proof runs against what really renders: the built webview bundle,
 * where every gesture carries its handle as a data attribute.
 */
import { AFFORDANCES } from "../surfaces/affordances";

/** A gesture the surface must offer, and the handle that proves it exists. */
export interface Door {
  action: string;
  surface: string;
  gesture: string;
  /** The data attribute a rendered control carries, e.g. `data-sign-cut`. */
  handle: string;
}

/** Every human door the registry declares, with the handle to look for. */
export function declaredDoors(): Door[] {
  return Object.entries(AFFORDANCES)
    .filter(([, e]) => e.kind === "human")
    .map(([action, e]) => ({
      action,
      surface: (e as { affordance: { surface: string } }).affordance.surface,
      gesture: (e as { affordance: { gesture: string } }).affordance.gesture,
      handle: `data-${action}`,
    }));
}

/**
 * Which declared doors do NOT appear in the built surface. `bundle` is the
 * rendered webview source; a door is present when its handle appears, or
 * when the action is posted from a control the bundle carries.
 */
export function missingDoors(bundle: string, doors: Door[] = declaredDoors()): Door[] {
  return doors.filter(
    (d) => !bundle.includes(d.handle) && !bundle.includes(`"${d.action}"`),
  );
}

/** The doors proved present in the surface this build shipped. */
export function verifiedDoors(bundleText?: string): Door[] {
  const doors = declaredDoors();
  if (!bundleText) return doors;
  const missing = new Set(missingDoors(bundleText, doors).map((x) => x.action));
  return doors.filter((x) => !missing.has(x.action));
}

/**
 * The walkthrough for a delivery: one line per promise, each naming a door
 * that was verified to exist. A promise whose door is missing yields no
 * line — the delivery says it is undelivered instead of inventing a way in.
 */
export function walkthroughLines(
  promises: { id: string; sentence: string; action?: string }[],
  present: Set<string>,
): { id: string; line: string }[] {
  return promises.flatMap((p) => {
    const door = p.action ? declaredDoors().find((d) => d.action === p.action) : undefined;
    if (!door || !present.has(door.action)) return [];
    return [{ id: p.id, line: `see it: ${door.surface} — ${door.gesture}` }];
  });
}
