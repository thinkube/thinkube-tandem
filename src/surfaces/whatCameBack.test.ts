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
  promise.checks = [{ id: "c-1", text: "the list is sorted", verdict: "unjudged", said: "the runner has no database configuration" }];
  push.deliveries[0].proofs = [{ criterionId: "c-1", verdict: "unjudged", said: "the runner has no database configuration" }];
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

test("one failure behind many checks is said once, and the report is painted from this delivery alone", async (t) => {
  const why = await canRender(MEDIA);
  if (why) return t.skip(why);
  const push = pushFor("flow");
  const promises = push.subjects.flatMap((s) => s.claims.flatMap((c) => c.promises)).slice(0, 3);
  const said = "Field required [type=missing, input_value={'POSTGRES_HOST': 'postgres'}]";
  promises.forEach((p, i) => {
    p.checks = [{ id: `c-${i}`, text: `check ${i}`, verdict: "green" }];
  });
  // The newest verdict on the promises is green; this delivery's own is red.
  push.deliveries[0].proofs = promises.map((_, i) => ({ criterionId: `c-${i}`, verdict: "red" as const, said }));
  const s = await openSurface({ mediaRoot: MEDIA, viewport: { width: 1280, height: 900 } });
  try {
    await s.push(push);
    const seen = await s.read(() => {
      const report = document.querySelector("[data-delivery-report]");
      const text = report?.textContent ?? "";
      return {
        common: report?.querySelector("[data-common-failures]")?.textContent ?? "",
        times: text.split("Field required").length - 1,
        notKept: [...(report?.querySelectorAll("[data-asked]") ?? [])].filter((el) => /not kept/.test(el.textContent ?? "")).length,
      };
    });
    assert.match(seen.common, /3 checks failed the same way — Field required/);
    assert.equal(seen.times, 1, "the failure is said once, not under every check");
    assert.ok(seen.notKept > 0, "the sentences are painted from this delivery's own verdicts, not the newest anywhere");
  } finally {
    await s.close();
  }
});
