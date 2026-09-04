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

test("a sentence delivered by an earlier delivery is not judged again here", async (t) => {
  const why = await canRender(MEDIA);
  if (why) return t.skip(why);
  const push = pushFor("flow");
  // Two deliveries: the first accepted and merged, the second waiting.
  const first = push.sentences[0];
  const second = push.sentences[1];
  first.bound = { tep: "TEP-1", stage: "accepted" };
  second.bound = { tep: "TEP-2", stage: "delivered" };
  const promises = push.subjects.flatMap((s) => s.claims.flatMap((c) => c.promises));
  promises.forEach((p, i) => {
    p.checks = [{ id: `c-${i}`, text: `check ${i}`, verdict: "green" }];
  });
  push.deliveries = [
    { ...push.deliveries[0], id: "delivery-TEP-2", tep: "TEP-2", accepted: false, proofs: [] },
  ] as never;
  const s = await openSurface({ mediaRoot: MEDIA, viewport: { width: 1280, height: 900 } });
  try {
    await s.push(push);
    const seen = await s.read(() => {
      const report = document.querySelector("[data-delivery-report]");
      const rows = [...(report?.querySelectorAll("[data-asked]") ?? [])].map((el) => [
        el.getAttribute("data-asked"),
        el.getAttribute("data-fate"),
      ]);
      return { rows, earlier: report?.querySelector("[data-landed-earlier]")?.textContent ?? "" };
    });
    const fateOfOne = seen.rows.find(([n]) => n === "1")?.[1];
    assert.equal(fateOfOne, "landed earlier", "merged work is not re-judged by another delivery's report");
    assert.match(seen.earlier, /Already in the project/);
    assert.match(seen.earlier, /accepted/);
  } finally {
    await s.close();
  }
});

test("a sentence is judged by its own promises, and a check the pipeline answers is not 'not judged'", async (t) => {
  const why = await canRender(MEDIA);
  if (why) return t.skip(why);
  const push = pushFor("flow");
  // One subject, two sentences: the first's promise waits on the platform,
  // the second's is proved here.
  const subject = push.subjects[0];
  subject.from = [
    { id: "a1", n: 1, text: push.sentences[0].text },
    { id: "a2", n: 2, text: push.sentences[1].text },
  ] as never;
  const [first, second] = subject.claims.flatMap((c) => c.promises);
  subject.claims = [
    { ...subject.claims[0], fromAskId: "a1", fromAskN: 1, promises: [first] },
    { ...subject.claims[0], id: "c2", fromAskId: "a2", fromAskN: 2, promises: [second] },
  ] as never;
  first.checks = [{ id: "k1", text: "the list comes back sorted" }] as never;
  second.checks = [{ id: "k2", text: "the mark is on the card" }] as never;
  for (const s of push.subjects.slice(1)) s.claims = [];
  push.deliveries = [
    {
      ...push.deliveries[0],
      accepted: false,
      proofs: [
        { criterionId: "k1", verdict: "pending" },
        { criterionId: "k2", verdict: "green" },
      ],
      pending: [{ criterionId: "k1", text: "the list comes back sorted", settledBy: "the backend suite in the build pipeline" }],
    },
  ] as never;
  const s = await openSurface({ mediaRoot: MEDIA, viewport: { width: 1280, height: 900 } });
  try {
    await s.push(push);
    const seen = await s.read(() => {
      const report = document.querySelector("[data-delivery-report]");
      return {
        fates: [...(report?.querySelectorAll("[data-asked]") ?? [])].map((el) => [
          el.getAttribute("data-asked"),
          el.getAttribute("data-fate"),
        ]),
        text: report?.textContent ?? "",
      };
    });
    const fate = (n: string) => seen.fates.find(([x]) => x === n)?.[1];
    assert.equal(fate("2"), "done", "a sentence proved here is done");
    assert.equal(fate("1"), "answered after the merge", "and one waiting on the platform says so, never 'not judged'");
    assert.match(seen.text, /the backend suite in the build pipeline/);
  } finally {
    await s.close();
  }
});
