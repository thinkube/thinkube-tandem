/**
 * INVARIANT — opening the same thinking space twice must always return the
 * one panel already made for it, never build a second one for the same key.
 * This must hold on every call, for as long as the registry exists.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SpacePanels } from "./panels";

function fakePanel() {
  return { disposed: false, dispose() { this.disposed = true; } };
}

test("open() called twice with the same key returns the same panel and makes no second one", () => {
  const made: string[] = [];
  const registry = new SpacePanels((key) => {
    made.push(key);
    return fakePanel() as never;
  });

  const first = registry.open("repo-1/space-a", "space a");
  const second = registry.open("repo-1/space-a", "space a");

  assert.equal(second, first, "the second open() returned the already-made panel");
  assert.deepEqual(made, ["repo-1/space-a"], "the factory was asked for a panel exactly once");
});
