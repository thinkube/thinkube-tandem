/**
 * Every page of the surface is visible in the window it is drawn in.
 *
 * A delivery of a hundred and ninety proofs was handed over green over a
 * window in which the ask list took seventeen hundred pixels of an eight
 * hundred pixel column, every page below it was laid out at ZERO height, and
 * the top of each one sat below the fold. Three hundred and ninety-one
 * checks passed on that tree. Not one of them opened the page.
 *
 * They could not have caught it. "The tab row is rendered before the pages
 * in the JSX" is true of a window showing nothing; so is "the ask list is
 * drawn once"; so is every assertion about what a file says. A layout exists
 * only while something is running, and only a running thing can be asked.
 *
 * So this renders the built surface in a browser, at three sizes, and asks
 * the smallest question there is: can the page be seen at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { canRender, openSurface, type OpenSurface } from "../gates/renderedSurface";
import { SURFACE_PAGES } from "./surfaceLayout";
import { pushFor } from "./pages.fixture";

const MEDIA = path.resolve(__dirname, "..", "..", "media", "map");

/**
 * A real push, recorded from a space with nineteen asks — the state the
 * surface was in when every page collapsed.
 *
 * Recorded rather than hand-built: the push is a wide contract, and a
 * hand-made one is missing a field the moment the contract grows, which
 * shows up as the surface silently drawing nothing. A recording either
 * still renders or it does not, and when it does not, the contract moved
 * and the fixture is re-recorded on purpose.
 */
/** Read from the repository, not from beside the compiled check: compiled,
 *  `__dirname` is out-test/surfaces, where no fixture is emitted. */
const FIXTURE = path.resolve(__dirname, "..", "..", "src", "surfaces", "surfaceFits.push.json");
const PUSH = JSON.parse(
  fs.readFileSync(fs.existsSync(FIXTURE) ? FIXTURE : path.join(__dirname, "surfaceFits.push.json"), "utf8"),
) as Record<string, unknown>;

const SIZES = [
  { name: "a narrow panel", width: 900, height: 700 },
  { name: "a full window", width: 1440, height: 900 },
  { name: "a large monitor", width: 2560, height: 1440 },
];

/** Every page's own container, measured after the surface has settled. */
async function pageBoxes(s: OpenSurface): Promise<{ page: string; height: number; top: number }[]> {
  return s.read(() =>
    [...document.querySelectorAll("[data-write-page],[data-intent-page],[data-work-page],[data-flow-page]")].map(
      (el) => {
        const r = el.getBoundingClientRect();
        return {
          page: [...el.attributes].map((a) => a.name).find((n) => n.endsWith("-page")) ?? "?",
          height: Math.round(r.height),
          top: Math.round(r.top),
        };
      },
    ),
  );
}

test("every page can be seen in the window it is drawn in", async (t) => {
  const why = await canRender(MEDIA);
  if (why) return t.skip(why);

  for (const size of SIZES) {
    const s = await openSurface({ mediaRoot: MEDIA, viewport: { width: size.width, height: size.height } });
    try {
      for (const label of SURFACE_PAGES) {
        await s.push(pushFor(label));
        const drawn = await s.read(() => document.querySelectorAll("[data-strip]").length);
        assert.ok(
          drawn > 0,
          `${size.name} · ${label}: the surface stopped drawing entirely — a page that throws ` +
            `takes the whole window with it, because nothing catches it`,
        );
        const boxes = await pageBoxes(s);
        assert.equal(boxes.length, 1, `${size.name} · ${label}: expected exactly one page drawn`);
        const [box] = boxes;

        assert.ok(
          box.height > 0,
          `${size.name} · ${label}: the page is ${box.height}px high — it is drawn and cannot be seen`,
        );
        assert.ok(
          box.top < size.height,
          `${size.name} · ${label}: the page starts at ${box.top}px, below a ${size.height}px window`,
        );
      }
    } finally {
      await s.close();
    }
  }
});

test("the page keeps most of the column it is drawn in", async (t) => {
  const why = await canRender(MEDIA);
  if (why) return t.skip(why);

  // Zero height is the extreme; a page squeezed to a strip is the same
  // defect caught earlier. Everything above a page is chrome — a title, a
  // tab row, a list — and chrome that takes most of the window has taken
  // the thing the window is for.
  const s = await openSurface({ mediaRoot: MEDIA, viewport: { width: 1100, height: 800 } });
  try {
    for (const page of SURFACE_PAGES) {
      await s.push(pushFor(page));
      const share = await s.read(() => {
        const app = document.querySelector("#root")?.children[0];
        const column = app?.getBoundingClientRect().height ?? 0;
        const page = document.querySelector(
          "[data-write-page],[data-intent-page],[data-work-page],[data-flow-page]",
        );
        const chrome = [...(app?.children ?? [])]
          .filter((c) => !c.contains(page))
          .map((c) => ({
            what: [...c.attributes].map((a) => a.name).find((n) => n.startsWith("data-")) ?? c.tagName,
            height: Math.round(c.getBoundingClientRect().height),
          }))
          .sort((a, b) => b.height - a.height);
        return { column, page: Math.round(page?.getBoundingClientRect().height ?? 0), worst: chrome[0] };
      });
      assert.ok(
        share.page >= share.column / 2,
        `page ${page}: the page has ${share.page}px of a ${share.column}px column — ` +
          `${share.worst?.what ?? "something above it"} takes ${share.worst?.height ?? 0}px`,
      );
    }
  } finally {
    await s.close();
  }
});
