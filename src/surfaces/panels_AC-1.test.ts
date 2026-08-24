/**
 * A registry of open space tabs must not build a second tab for a space
 * that already has one open — opening the same key twice has to bring the
 * existing tab forward, never mint a duplicate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SpaceTabs } from "./panels";
import type { SpaceTab } from "./panels";

function fakeTab(key: string, title: string): SpaceTab {
  const disposedCbs: (() => void)[] = [];
  return {
    key,
    title,
    reveal() {},
    push() {},
    onDisposed(cb: () => void) {
      disposedCbs.push(cb);
    },
    dispose() {
      for (const cb of disposedCbs) cb();
    },
  };
}

// INVARIANT: opening the same key twice returns the identical tab instance
// and never asks the factory for a second one — a space owns exactly one tab.
test("SpaceTabs.open called twice with the same key returns the same tab and builds only once", () => {
  let calls = 0;
  const tabs = new SpaceTabs((key, title) => {
    calls++;
    return fakeTab(key, title);
  });
  const first = tabs.open("repo/main", "Main");
  const second = tabs.open("repo/main", "Main");
  assert.equal(second, first, "expected the same tab instance on the second open");
  assert.equal(calls, 1, `expected the factory to be asked once, was asked ${calls} times`);
});
