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
    phases: { door: { state: "running", doing: "proving the product build" }, delivery: { state: "pending" } },
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
