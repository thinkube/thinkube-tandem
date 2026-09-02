/**
 * The delivery report reads for the person who asked: their sentences and
 * what happened to each, a failure in plain words under the sentence it
 * broke, and what could not be judged said once. No criterion labels, no
 * commands, no identifiers where a reader looks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { canRender, openSurface } from "../gates/renderedSurface";
import { pushFor } from "./pages.fixture";

const MEDIA = path.resolve(__dirname, "..", "..", "media", "map");

test("what came back is said per sentence, in the person's words", async (t) => {
  const why = await canRender(MEDIA);
  if (why) return t.skip(why);
  const push = pushFor("flow");
  // One check that could not run, on the first promise the fixture has.
  const sub = push.subjects.find((s) => s.claims.some((c) => c.promises.length))!;
  const promise = sub.claims.flatMap((c) => c.promises)[0];
  promise.checks = [{ text: "the list is sorted", verdict: "unjudged", said: "the runner has no database configuration" }];
  const s = await openSurface({ mediaRoot: MEDIA, viewport: { width: 1280, height: 900 } });
  try {
    await s.push(push);
    const seen = await s.read(() => {
      const report = document.querySelector("[data-delivery-report]");
      const visible = [...(report?.querySelectorAll("*") ?? [])]
        .filter((el) => !el.closest("details") && el.children.length === 0)
        .map((el) => el.textContent ?? "")
        .join("\n");
      return {
        rows: report?.querySelectorAll("[data-asked]").length ?? 0,
        unjudged: report?.querySelector("[data-unjudged]")?.textContent ?? "",
        machineWords: (visible.match(/review-\d+|\$ f=|_AC-\d+|#eu-|TEP-/g) ?? []).slice(0, 5),
      };
    });
    assert.ok(seen.rows > 0, "the sentences are there");
    assert.match(seen.unjudged, /1 check could not run — the runner has no database configuration/);
    assert.deepEqual(seen.machineWords, [], "nothing the machine calls things is where a person reads");
  } finally {
    await s.close();
  }
});
