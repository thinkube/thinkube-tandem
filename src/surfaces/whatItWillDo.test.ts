/**
 * The work page is what will be true: the promises of the thing in hand,
 * each with its criteria as ticks, and the line that unlocks Build.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { canRender, openSurface } from "../gates/renderedSurface";
import { pushFor } from "./pages.fixture";

const MEDIA = path.resolve(__dirname, "..", "..", "media", "map");

test("the thing in hand shows its promises with their criteria", async (t) => {
  const why = await canRender(MEDIA);
  if (why) return t.skip(why);
  // A thing in hand, worked out: the state that lands on this page.
  const push = pushFor("work");
  const s = await openSurface({ mediaRoot: MEDIA, viewport: { width: 1280, height: 900 } });
  try {
    await s.push(push);
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
