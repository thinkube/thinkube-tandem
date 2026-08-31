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
import * as fs from "node:fs";
import * as path from "node:path";
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
 *
 * A standing region is the one exception, and not a loosening of that
 * rule: it is drawn outside the page wrappers on every tab, so there is no
 * page whose absence could strand its control. Such a door is proved by
 * its own control alone.
 */
export function verifiedDoors(surfaceText?: string): Door[] {
  const doors = declaredDoors();
  if (!surfaceText) return [];
  const missingControl = new Set(missingDoors(surfaceText, doors).map((x) => x.action));
  const missingPageHandles = new Set(missingPages(surfaceText).map((p) => p.handle));
  return doors.filter((x) => {
    if (missingControl.has(x.action)) return false;
    const page = PAGES[x.page];
    if (page?.standing) return true;
    if (page?.handle && missingPageHandles.has(page.handle)) return false;
    return true;
  });
}

/**
 * The webview's own SOURCE, read from disk: every `.tsx`/`.ts` file under
 * `webview/map/src`, concatenated. This is what the handle proof runs
 * against, rather than the built bundle — a bundler may rename, inline or
 * drop a literal, so a handle found in the bundle proves the bundler's
 * output and a handle found here proves what a person wrote.
 *
 * Reading the real files is the point: a proof that never opens the code it
 * is about is green for a stub as readily as for the real surface.
 *
 * Returns an empty string — never throws — when the tree has no webview
 * source to read. An absent surface is "nothing verified", not a crash.
 */
export function webviewSourceText(root?: string): string {
  const dir = root ? path.join(root, "webview", "map", "src") : findWebviewSource();
  if (!dir) return "";
  const parts: string[] = [];
  const walk = (at: string): void => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) parts.push(fs.readFileSync(full, "utf8"));
    }
  };
  try {
    walk(dir);
  } catch {
    return "";
  }
  return parts.join("\n");
}

/**
 * Where the webview's source lives, found by walking up from this compiled
 * module and from the working directory. A check runs from whatever
 * directory its runner chose — the repository root, an `out-test` tree, an
 * isolated runner copy — and a proof that silently reads nothing because it
 * guessed the wrong root is green while proving nothing, which is the one
 * failure this whole seam exists to prevent. Returns undefined only when
 * the tree genuinely has no webview source.
 */
function findWebviewSource(): string | undefined {
  const seen = new Set<string>();
  for (const start of [__dirname, process.cwd()]) {
    let at = start;
    for (;;) {
      if (!seen.has(at)) {
        seen.add(at);
        const candidate = path.join(at, "webview", "map", "src");
        if (fs.existsSync(candidate)) return candidate;
      }
      const up = path.dirname(at);
      if (up === at) break;
      at = up;
    }
  }
  return undefined;
}

/**
 * The webview surface, read once through an injectable reader so a caller
 * can hold the result rather than reading the filesystem again for every
 * delivery on every push. With no reader injected it falls back to the
 * webview's own source on disk, so a caller that supplies nothing still
 * proves against the real surface instead of against an empty string.
 * Returns an empty string — never throws — when there is nothing to read:
 * an absent surface is "no doors verified", not a crash.
 */
export function builtSurfaceText(read?: () => string): string {
  try {
    return read ? read() : webviewSourceText();
  } catch {
    return "";
  }
}
