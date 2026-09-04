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

test("nothing on this page is a mark whose meaning is not written beside it", async (t) => {
  const why = await canRender(MEDIA);
  if (why) return t.skip(why);
  const push = pushFor("work");
  const promise = push.subjects.flatMap((s) => s.claims.flatMap((c) => c.promises))[0];
  promise.checks = [
    { id: "k1", text: "the list comes back sorted", verdict: "green" },
    { id: "k2", text: "the mark is on the card", verdict: "red" },
    { id: "k3", text: "a reviewer reads the page", kind: "assessment" },
    { id: "k4", text: "the count matches the cards" },
    { id: "k5", text: "the runner was not there", verdict: "unjudged" },
  ] as never;
  promise.unverified = [{ text: "the overdue mark reads at arm's length", why: "it needs the running product" }] as never;
  const s = await openSurface({ mediaRoot: MEDIA, viewport: { width: 1280, height: 900 } });
  try {
    await s.push(push);
    const seen = await s.read(() => {
      const page = document.querySelector("[data-work-page]");
      return {
        text: page?.textContent ?? "",
        // The mark's own cell, never the words beside it: a separator
        // between text and words means nothing and is read as nothing.
        marks: [...(page?.querySelectorAll("[data-criterion],[data-unverified]") ?? [])]
          .map((el) => (el.firstElementChild?.textContent ?? "").trim())
          .join("|"),
      };
    });
    // Only a tick and a cross: everyone reads those the same way.
    for (const mark of seen.marks.split("|"))
      assert.ok(["", "✓", "✗"].includes(mark), `a mark no one can read: "${mark}"`);
    // And every state that is not proved says what it is, in words.
    assert.match(seen.text, /checked when it is built/);
    assert.match(seen.text, /judged by a reviewer at delivery/);
    assert.match(seen.text, /nothing could judge it/);
    assert.match(seen.text, /only you can see this: it needs the running product/);
    assert.match(seen.text, /not proved/);
  } finally {
    await s.close();
  }
});

test("saying a promise does not hold is offered only once the work is in the project", async (t) => {
  const why = await canRender(MEDIA);
  if (why) return t.skip(why);
  const push = pushFor("work");
  const promise = push.subjects.flatMap((s) => s.claims.flatMap((c) => c.promises))[0];
  // Delivered, and waiting for the person's decision: nothing is deployed,
  // so nobody can have used it.
  promise.checks = [{ id: "k1", text: "the list comes back sorted", verdict: "green", tep: "TEP-1", accepted: false }] as never;
  const s = await openSurface({ mediaRoot: MEDIA, viewport: { width: 1280, height: 900 } });
  try {
    await s.push(push);
    const before = await s.read(() => document.querySelectorAll("[data-does-not-hold]").length);
    assert.equal(before, 0, "asking whether something works before it is deployed is a riddle");

    // Accepted: the work is in the project, and the person can say so.
    promise.checks = [{ id: "k1", text: "the list comes back sorted", verdict: "green", tep: "TEP-1", accepted: true }] as never;
    await s.push(push);
    const seen = await s.read(() => ({
      count: document.querySelectorAll("[data-does-not-hold]").length,
      label: document.querySelector("[data-does-not-hold]")?.textContent ?? "",
    }));
    assert.ok(seen.count > 0, "and once it is, it can be said");
    assert.match(seen.label, /^Say /, "a control is named for what pressing it does");
  } finally {
    await s.close();
  }
});

test("saying a promise does not hold is offered only once the work is in the project, and is named for what it does", async (t) => {
  const why = await canRender(MEDIA);
  if (why) return t.skip(why);
  const push = pushFor("work");
  const promise = push.subjects.flatMap((s) => s.claims.flatMap((c) => c.promises))[0];
  // Delivered and waiting for a decision: nothing is deployed, so nobody
  // can have used it.
  promise.checks = [{ id: "k1", text: "the list comes back sorted", verdict: "green", tep: "TEP-1", accepted: false }] as never;
  const s = await openSurface({ mediaRoot: MEDIA, viewport: { width: 1280, height: 900 } });
  try {
    await s.push(push);
    assert.equal(
      await s.read(() => document.querySelectorAll("[data-does-not-hold]").length),
      0,
      "asking whether something works before it is deployed is a riddle",
    );

    // Accepted: the work is in the project, and the person can say so.
    promise.checks = [{ id: "k1", text: "the list comes back sorted", verdict: "green", tep: "TEP-1", accepted: true }] as never;
    await s.push(push);
    const seen = await s.read(() => ({
      count: document.querySelectorAll("[data-does-not-hold]").length,
      label: document.querySelector("[data-does-not-hold]")?.textContent ?? "",
    }));
    assert.ok(seen.count > 0, "and once it is, it can be said");
    assert.match(seen.label, /^Say /, "a control is named for what pressing it does");
  } finally {
    await s.close();
  }
});
