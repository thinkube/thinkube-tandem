/**
 * Doors: a claim that needs a person to act needs a place to act — a page
 * and a control that actually render. The machine proves it, never the
 * human: code that can perform a cut with no button reaching it is a
 * defect the machine reports, and a delivery whose claim needs a door that
 * is not there is undelivered and named.
 *
 * The registry alone cannot prove this. It records that an action has a
 * page and a gesture, but an entry can describe a button nobody built.
 * The proof runs against what really renders: the built webview source,
 * where every page carries its handle and every gesture carries its
 * control's handle as a data attribute.
 */
import { AFFORDANCES, PAGES } from "../surfaces/affordances";

/** A gesture the surface must offer, and the handles that prove it exists:
 *  the page's own handle, and the control's. */
export interface Door {
  action: string;
  page: string;
  /** Same value as `page` — the key of `PAGES` this door lives on. Earlier
   *  callers of this shape named the field `surface`; kept as an optional
   *  alias so both names read the same page key without forcing every
   *  directly-constructed fixture to carry it. */
  surface?: string;
  label: string;
  gesture: string;
  /** The data attribute a rendered control carries, e.g. `data-sign-cut`. */
  handle: string;
}

/** Every human door the registry declares, with the handles to look for. */
export function declaredDoors(): Door[] {
  return Object.entries(AFFORDANCES)
    .filter(([, e]) => e.kind === "human")
    .map(([action, e]) => {
      const affordance = (e as { affordance: { page: string; gesture: string } }).affordance;
      const page = PAGES[affordance.page];
      return {
        action,
        page: affordance.page,
        surface: affordance.page,
        label: page?.label ?? affordance.page,
        gesture: affordance.gesture,
        handle: `data-${action}`,
      };
    });
}

/**
 * Which declared doors do NOT appear in the built surface. `surfaceText` is
 * the rendered webview source; a door is present when its own handle
 * appears, or the action is posted from a control the surface carries.
 * Judged on the control alone — whether the door's PAGE also rendered is a
 * separate question, answered by `missingPages`/`verifiedDoors`, not folded
 * in here.
 */
export function missingDoors(surfaceText: string, doors: Door[] = declaredDoors()): Door[] {
  return doors.filter((d) => {
    const controlThere = surfaceText.includes(d.handle) || surfaceText.includes(`"${d.action}"`);
    return !controlThere;
  });
}

/** Every declared page whose handle is absent from the given surface text. */
export function missingPages(surfaceText: string): { page: string; handle: string }[] {
  return Object.entries(PAGES)
    .filter(([, p]) => !surfaceText.includes(p.handle))
    .map(([page, p]) => ({ page, handle: p.handle }));
}

/**
 * The doors proved present in the surface this build shipped. With no
 * surface text at all, nothing is verified — a door is proved by finding
 * it, never assumed present because nobody looked. A door needs both its
 * own control AND its page to render: a control that renders on a page
 * that itself never rendered is not a way in.
 */
export function verifiedDoors(surfaceText?: string): Door[] {
  const doors = declaredDoors();
  if (!surfaceText) return [];
  const missingControl = new Set(missingDoors(surfaceText, doors).map((x) => x.action));
  const missingPageHandles = new Set(missingPages(surfaceText).map((p) => p.handle));
  return doors.filter((x) => {
    if (missingControl.has(x.action)) return false;
    const pageHandle = PAGES[x.page]?.handle;
    if (pageHandle && missingPageHandles.has(pageHandle)) return false;
    return true;
  });
}

/**
 * The built webview source, read once through an injectable reader so a
 * caller can hold the result rather than reading the filesystem again for
 * every delivery on every push. Returns an empty string — never throws —
 * when the reader has nothing to give: an absent build is "no doors
 * verified", not a crash.
 */
export function builtSurfaceText(read?: () => string): string {
  if (!read) return "";
  try {
    return read();
  } catch {
    return "";
  }
}
