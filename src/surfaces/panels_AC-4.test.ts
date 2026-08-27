/**
 * INVARIANT — disposeAll() must always dispose every panel the registry
 * currently holds, across every open space, and leave the registry empty
 * afterward (a later open() for any of those keys makes a fresh panel).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SpacePanels } from "./panels";

function fakePanel() {
  return { disposed: false, dispose() { this.disposed = true; } };
}

test("disposeAll() disposes every held panel and leaves the registry empty", () => {
  const panels: ReturnType<typeof fakePanel>[] = [];
  let madeCount = 0;
  const registry = new SpacePanels(() => {
    madeCount++;
    const p = fakePanel();
    panels.push(p);
    return p as never;
  });

  registry.open("repo-1/space-a", "space a");
  registry.open("repo-1/space-b", "space b");
  assert.equal(madeCount, 2);

  registry.disposeAll();

  assert.ok(
    panels.every((p) => p.disposed),
    "every panel the registry held was disposed",
  );

  registry.open("repo-1/space-a", "space a");
  assert.equal(madeCount, 3, "the registry was empty, so reopening asked the factory for a fresh panel");
});
