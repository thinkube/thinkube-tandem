/**
 * INVARIANT — when nothing is busy, the machine says nothing: busyLine
 * given no busy spaces returns undefined rather than an empty or blank
 * line. A status bar that always prints something would be unable to fall
 * back to its ordinary "choose a repository" text when idle.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { busyLine } from "./busy";

test("busyLine returns undefined when there are no busy spaces", () => {
  assert.equal(busyLine([], Date.now()), undefined);
});
