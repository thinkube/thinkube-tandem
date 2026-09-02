/**
 * The work page is what will be true: the promises of the thing in hand,
 * each with its criteria as ticks, and the line that unlocks Build.
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
) as Record<string, unknown> & { subjects: { from: { n: number }[]; claims: { promises: unknown[] }[] }[] };

test("the thing in hand shows its promises with their criteria", async (t) => {
  const why = await canRender(MEDIA);
  if (why) return t.skip(why);
  // A thing carrying the sentences of the first subject that has promises.
  const sub = BASE.subjects.find((s) => s.claims.some((c) => c.promises.length));
  assert.ok(sub, "set up: the fixture has a subject with promises");
  const asks = sub!.from.map((f) => f.n);
  const push = {
    ...BASE,
    phase: "understood",
    running: false,
    deliveries: [],
    signedIdle: undefined,
    allowed: ["choose-set", "build"],
    cost: { subjects: 0, rounds: 0 },
    documentation: { state: "missing", landings: [] },
    specs: [{ id: "s1", name: "the first thing", subjects: 1, asks, promises: 3, chosen: true, built: false, repos: ["r"] }],
  };
  const s = await openSurface({ mediaRoot: MEDIA, viewport: { width: 1280, height: 900 } });
  try {
    await s.push(push);
    await s.act(() => {
      const b = [...document.querySelectorAll("[data-tabs] button")].find((x) => /Work/.test(x.textContent ?? "")) as HTMLElement | undefined;
      b?.click();
    }, 0);
    const seen = await s.read(() => ({
      wills: document.querySelectorAll("[data-will]").length,
      criteria: document.querySelectorAll("[data-criterion]").length,
      docs: !!document.querySelector("[data-docs-exemption-reason]"),
      next: (document.querySelector("[data-next]")?.textContent ?? "").trim(),
      nextEnabled: !(document.querySelector("[data-next]") as HTMLButtonElement | null)?.disabled,
    }));
    assert.ok(seen.wills > 0, "the promises are drawn");
    assert.ok(seen.criteria > 0, "with their criteria");
    assert.equal(seen.docs, true, "the documentation line is there to fill");
    assert.match(seen.next, /^Build these \d+/, "the strip offers to build them");
    assert.equal(seen.nextEnabled, false, "and waits for the documentation line");
    // The browser asks for a favicon the surface does not ship; that is
    // not the page throwing.
    assert.deepEqual(s.threw().filter((e) => !/favicon|404/.test(e)), []);
  } finally {
    await s.close();
  }
});
