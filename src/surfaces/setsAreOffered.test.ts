/**
 * The sets are on the surface, and pressing one is a real gesture.
 *
 * A layer nobody can reach is machinery, not a change. `inCut` was computed
 * on every promise, carried through the contract, and read by nothing — the
 * whole in-cut mark unreachable, and nobody noticed for as long as the only
 * checks were about source text. So this one is proved by rendering the built
 * surface and pressing the thing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { canRender, openSurface } from "../gates/renderedSurface";

const MEDIA = path.resolve(__dirname, "..", "..", "media", "map");
const FIXTURE = path.resolve(__dirname, "..", "..", "src", "surfaces", "surfaceFits.push.json");
const BASE = JSON.parse(
  fs.readFileSync(fs.existsSync(FIXTURE) ? FIXTURE : path.join(__dirname, "surfaceFits.push.json"), "utf8"),
) as Record<string, unknown>;

const withSets = (specs: unknown[]): Record<string, unknown> => ({
  ...BASE,
  phase: "understood",
  allowed: ["group-into-sets", "choose-set", "think", "build"],
  specs,
});

async function onIntent<T>(push: Record<string, unknown>, read: () => T): Promise<T> {
  const s = await openSurface({ mediaRoot: MEDIA, viewport: { width: 1280, height: 900 } });
  try {
    await s.push(push);
    await s.act(() => {
      const b = [...document.querySelectorAll("[data-tabs] button")].find((x) =>
        /Intent/.test(x.textContent ?? ""),
      ) as HTMLElement | undefined;
      b?.click();
    }, 0);
    return await s.read(read);
  } finally {
    await s.close();
  }
}

test("with no grouping yet, the surface offers to make one", async (t) => {
  const why = await canRender(MEDIA);
  if (why) return t.skip(why);

  const seen = await onIntent(withSets([]), () => {
    const b = document.querySelector("[data-group-into-sets]") as HTMLButtonElement | null;
    const r = b?.getBoundingClientRect();
    return { there: !!b, enabled: b ? !b.disabled : false, sized: !!r && r.height > 0 };
  });
  assert.deepEqual(seen, { there: true, enabled: true, sized: true });
});

test("each set is drawn with what it covers, and the chosen one says so", async (t) => {
  const why = await canRender(MEDIA);
  if (why) return t.skip(why);

  const seen = await onIntent(
    withSets([
      { id: "spec-1", name: "the layout is stable", subjects: 5, promises: 12, chosen: true },
      { id: "spec-2", name: "I can read the run graph", subjects: 3, promises: 7, chosen: false },
    ]),
    () =>
      [...document.querySelectorAll("[data-choose-set]")].map((b) => ({
        id: b.getAttribute("data-choose-set"),
        text: (b.textContent ?? "").replace(/\s+/g, " ").trim(),
        pressable: !(b as HTMLButtonElement).disabled && b.getBoundingClientRect().height > 0,
      })),
  );

  assert.equal(seen.length, 2, "one control per set");
  assert.deepEqual(seen.map((s) => s.id), ["spec-1", "spec-2"]);
  assert.ok(seen.every((s) => s.pressable), "a set nobody can press is not an offer");
  assert.match(seen[0].text, /the layout is stable/, "named as what becomes true, in the person's register");
  assert.match(seen[0].text, /12 promises/, "with its size, before it is built");
  assert.match(seen[0].text, /in the cut/, "and the one in hand says so");
  assert.doesNotMatch(seen[1].text, /in the cut/);
});
