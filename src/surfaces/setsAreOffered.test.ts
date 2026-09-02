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
import * as path from "node:path";
import { canRender, openSurface } from "../gates/renderedSurface";
import { quietPush } from "./pages.fixture";

const MEDIA = path.resolve(__dirname, "..", "..", "media", "map");

const withSets = (specs: unknown[]): Record<string, unknown> => ({
  ...quietPush(),
  allowed: ["group-into-sets", "choose-set", "think", "build"],
  specs,
});

/** An understood space lands on the intent page by itself. */
async function onIntent<T>(push: Record<string, unknown>, read: () => T): Promise<T> {
  const s = await openSurface({ mediaRoot: MEDIA, viewport: { width: 1280, height: 900 } });
  try {
    await s.push(push);
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
      { id: "spec-1", name: "the layout is stable", subjects: 5, promises: 12, chosen: true, built: false, repos: ["thinkube-tandem"] },
      { id: "spec-2", name: "I can read the run graph", subjects: 3, promises: 7, chosen: false, built: false, repos: ["thinkube-tandem"] },
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

test("a set says where it lands, whether it is built, and which is in hand", async (t) => {
  const why = await canRender(MEDIA);
  if (why) return t.skip(why);

  const seen = await onIntent(
    withSets([
      { id: "s1", name: "the provider and its consumer", subjects: 2, promises: 6, chosen: false, built: false, repos: ["thinkube-tandem", "apps/todo"] },
      { id: "s2", name: "already done", subjects: 1, promises: 3, chosen: false, built: true, repos: ["thinkube-tandem"] },
      { id: "s3", name: "the one in hand", subjects: 4, promises: 9, chosen: true, built: false, repos: ["thinkube-tandem"] },
    ]),
    () => ({
      sets: [...document.querySelectorAll("[data-choose-set]")].map((b) => ({
        text: (b.textContent ?? "").replace(/\s+/g, " ").trim(),
        pressable: !(b as HTMLButtonElement).disabled,
      })),
      header: (document.querySelector("[data-set-in-hand]")?.textContent ?? "").trim(),
    }),
  );

  // Found by name, never by position: the sets are drawn in the order they
  // should be built, so where one sits is information rather than an echo
  // of the order they arrived in.
  const of = (name: string) => seen.sets.find((x) => x.text.includes(name))!;

  // Two repositories is said, not hidden: the parts are delivered separately
  // and accepted together, so a person choosing it should know before they do.
  assert.match(of("the provider and its consumer").text, /in thinkube-tandem and apps\/todo/);
  assert.doesNotMatch(of("the one in hand").text, /in thinkube-tandem and/, "one repository needs no saying");

  assert.match(of("already done").text, /built/, "a set already signed says so");
  assert.equal(of("already done").pressable, false, "and is not offered again");

  // And a set already built is behind you, whatever its size.
  assert.equal(
    seen.sets[seen.sets.length - 1].text.includes("already done"),
    true,
    "what is built comes last — the order is what to do next, not a list",
  );

  assert.match(seen.header, /the one in hand/, "no page is silent about which set it is showing");
});
