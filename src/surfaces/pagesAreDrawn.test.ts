/**
 * Every page the register declares is actually drawn, and can be reached.
 *
 * The criterion this replaces read: "every handle declared in PAGES appears
 * literally in the webview source, reading the source files, not the built
 * bundle". It held a delivery hostage for two days, and it could not have
 * told anyone what they wanted to know. A handle appears in the source of a
 * page that renders at zero height; it appears in a file nothing imports;
 * it appears in a comment. The question was never whether the text is
 * present — it was whether the page is there when you go looking for it.
 *
 * So this asks the rendered surface. A page is drawn when its handle is in
 * the document, its element has a size, and the tab that leads to it takes
 * you there. Nothing about the source of anything.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { canRender, openSurface } from "../gates/renderedSurface";
import { AFFORDANCES, PAGES } from "./affordances";
import { SURFACE_PAGES } from "./surfaceLayout";
import { pushFor } from "./pages.fixture";

const MEDIA = path.resolve(__dirname, "..", "..", "media", "map");

/** Which declared handles are in the document, and whether they have a size.
 *  The page follows the state, so each page is reached by the state that
 *  leads there. */
async function drawn(handles: readonly string[]): Promise<Record<string, { there: boolean; sized: boolean }>> {
  const s = await openSurface({ mediaRoot: MEDIA, viewport: { width: 1280, height: 900 } });
  try {
    const seen: Record<string, { there: boolean; sized: boolean }> = {};
    for (const page of SURFACE_PAGES) {
      await s.push(pushFor(page));
      const here = await s.readWith(
        (hs: string[]) =>
          Object.fromEntries(
            hs.map((h) => {
              const el = document.querySelector(`[${h}]`);
              const r = el?.getBoundingClientRect();
              return [h, { there: !!el, sized: !!r && r.width > 0 && r.height > 0 }];
            }),
          ),
        [...handles],
      );
      for (const [h, state] of Object.entries(here))
        seen[h] = { there: seen[h]?.there || state.there, sized: seen[h]?.sized || state.sized };
    }
    return seen;
  } finally {
    await s.close();
  }
}

test("every declared page is drawn, and has a size when you are on it", async (t) => {
  const why = await canRender(MEDIA);
  if (why) return t.skip(why);

  const handles = Object.values(PAGES).map((p) => p.handle);
  assert.ok(handles.length > 0, "set up: the register declares at least one page");
  const seen = await drawn(handles);

  const missing = handles.filter((h) => !seen[h]?.there);
  assert.deepEqual(missing, [], "a page the register promises and the surface never draws");

  const invisible = handles.filter((h) => seen[h]?.there && !seen[h]?.sized);
  assert.deepEqual(
    invisible,
    [],
    "drawn but with no size — present in the document and absent from the window, which is the shape the whole surface was in",
  );
});

test("every human door's page is one the surface really draws", async (t) => {
  const why = await canRender(MEDIA);
  if (why) return t.skip(why);

  // A door names a page a person goes to. If the register names a page the
  // surface does not draw, the instruction sends someone nowhere — which is
  // the ask about instructions pointing at places that do not exist.
  const doors = Object.entries(AFFORDANCES).flatMap(([action, e]) =>
    e.kind === "human" ? [{ action, page: e.affordance.page }] : [],
  );
  assert.ok(doors.length > 0, "set up: some doors are human");

  const unknown = doors.filter((d) => !PAGES[d.page]);
  assert.deepEqual(unknown, [], "a door pointing at a page the register does not declare");

  const seen = await drawn([...new Set(doors.map((d) => PAGES[d.page].handle))]);
  const nowhere = doors
    .filter((d) => !seen[PAGES[d.page].handle]?.sized)
    .map((d) => `${d.action} → ${PAGES[d.page].label}`);
  assert.deepEqual(nowhere, [], "a door whose page cannot be seen — the gesture it describes leads nowhere");
});
