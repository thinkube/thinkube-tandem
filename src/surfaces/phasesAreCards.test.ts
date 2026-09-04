/**
 * The door and the delivery are cards on the run page, read the way every
 * card is read, and there is no second place the run's lines are shown.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { canRender, openSurface } from "../gates/renderedSurface";
import { pushFor } from "./pages.fixture";

const MEDIA = path.resolve(__dirname, "..", "..", "media", "map");

test("a run at the door shows the door working, and the delivery waiting", async (t) => {
  const why = await canRender(MEDIA);
  if (why) return t.skip(why);
  const push = pushFor("flow");
  push.running = true;
  push.deliveries = [];
  push.run = {
    ...push.run!,
    phases: { door: { state: "running", doing: "proving the product build" }, gate: { state: "pending" }, live: { state: "pending" }, delivery: { state: "pending" } },
  };
  const s = await openSurface({ mediaRoot: MEDIA, viewport: { width: 1280, height: 900 } });
  try {
    await s.push(push);
    const seen = await s.read(() => ({
      door: document.querySelector('[data-node="door"]')?.textContent ?? "",
      delivery: document.querySelector('[data-node="delivery"]')?.textContent ?? "",
      progress: document.querySelector("[data-run-progress-text]")?.textContent ?? "",
      bottomPane: !!document.querySelector("[data-run-log]"),
    }));
    assert.match(seen.door, /preparing the tree/);
    assert.match(seen.door, /proving the product build/);
    assert.match(seen.delivery, /handing it over/);
    assert.match(seen.progress, /preparing the tree — proving the product build/);
    assert.equal(seen.bottomPane, false, "one way to read a log: the card");
  } finally {
    await s.close();
  }
});

test("a card wears its promise and nothing that reads as code or as an id", async (t) => {
  const why = await canRender(MEDIA);
  if (why) return t.skip(why);
  const push = pushFor("flow");
  push.running = true;
  push.deliveries = [];
  for (const u of push.run!.units) u.promiseLabel = undefined;
  push.run!.units.push({
    id: "SL-1-tests#eu-0",
    slice: "SL-1-tests",
    role: "maintain",
    state: "ready",
    requires: [],
    what: "[The task list comes back sorted.] The tests that already exist are brought under it.",
  } as never);
  const s = await openSurface({ mediaRoot: MEDIA, viewport: { width: 1280, height: 900 } });
  try {
    await s.push(push);
    const cards = await s.read(() => [...document.querySelectorAll("[data-node]")].map((el) => el.textContent ?? ""));
    assert.ok(cards.length > 2);
    for (const c of cards) {
      assert.doesNotMatch(c, /lands at/, c.slice(0, 80));
      assert.doesNotMatch(c, /SL-\d+'s|#eu-\d/, c.slice(0, 80));
      assert.doesNotMatch(c, /\(\w+: \w+/, `a signature on a card: ${c.slice(0, 80)}`);
    }
    assert.ok(cards.some((c) => /The task list comes back sorted\./.test(c)), "the maintain card wears the promise it serves");
  } finally {
    await s.close();
  }
});

test("a run at the closing gate shows the gate grading, in its own words", async (t) => {
  const why = await canRender(MEDIA);
  if (why) return t.skip(why);
  const push = pushFor("flow");
  push.running = true;
  push.deliveries = [];
  push.run = {
    ...push.run!,
    phases: {
      door: { state: "done", doing: "the tree is ready" },
      gate: { state: "running", doing: "running the repository's own suite" },
      live: { state: "pending" }, delivery: { state: "pending" },
    },
  };
  const s = await openSurface({ mediaRoot: MEDIA, viewport: { width: 1280, height: 900 } });
  try {
    await s.push(push);
    const seen = await s.read(() => ({
      gate: document.querySelector('[data-node="gate"]')?.textContent ?? "",
      progress: document.querySelector("[data-run-progress-text]")?.textContent ?? "",
    }));
    assert.match(seen.gate, /running the repository's own suite/);
    assert.doesNotMatch(seen.gate, /passed/, "a gate still grading has not passed");
    assert.match(seen.progress, /grading — running the repository's own suite/);
  } finally {
    await s.close();
  }
});
