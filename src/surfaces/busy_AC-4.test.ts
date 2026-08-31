/**
 * INVARIANT — the status bar speaks for every open space at once, not just
 * one: busyLine given two busy spaces returns text saying two spaces are
 * busy, with a detail that names both. A person with more than one space
 * open must be told there is more than one thing going on, and be able to
 * find out which spaces those are.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spaceBusy, busyLine } from "./busy";

test("busyLine reports two busy spaces by count and names both in the detail", () => {
  const alpha = spaceBusy("owner/alpha", "Alpha", {
    running: true,
    runState: { view: () => ({ units: [{ id: "u1", state: "running" }], parked: [] }) },
  });
  const beta = spaceBusy("owner/beta", "Beta", {
    running: true,
    runState: { view: () => ({ units: [{ id: "u1", state: "running" }], parked: [] }) },
  });
  assert.ok(alpha && beta, "both sessions must be reported busy");

  const line = busyLine([alpha!, beta!], Date.now());
  assert.ok(line, "two busy spaces must produce a busy line");
  assert.ok(line!.text.includes("2"), "the text must say two spaces are busy");
  assert.ok(line!.detail.includes("Alpha"), "the detail must name Alpha");
  assert.ok(line!.detail.includes("Beta"), "the detail must name Beta");
});
