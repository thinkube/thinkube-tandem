/**
 * Shutting the extension down must close every open space tab, not just
 * the one that happened to be in front — disposing the registry disposes
 * every tab it holds and leaves it holding none.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SpaceTabs } from "./panels";
import type { SpaceTab } from "./panels";

function fakeTab(key: string, title: string): SpaceTab & { disposedFlag: boolean } {
  let disposed = false;
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
      disposed = true;
      for (const cb of disposedCbs) cb();
    },
    get disposedFlag() {
      return disposed;
    },
  };
}

// INVARIANT: disposing the registry tears down every tab it holds — what
// used to hold one panel now holds many, and shutdown must reach all of
// them, not just the foreground one.
test("disposing the tab registry disposes every tab and leaves none held", () => {
  const built: (SpaceTab & { disposedFlag: boolean })[] = [];
  const tabs = new SpaceTabs((key, title) => {
    const t = fakeTab(key, title);
    built.push(t);
    return t;
  });
  tabs.open("repo/main", "Main");
  tabs.open("repo/other", "Other");
  tabs.open("wp:proj-1/rebrand", "Rebrand");

  assert.equal(built.length, 3);
  assert.ok(built.every((t) => !t.disposedFlag), "expected no tab disposed before shutdown");

  tabs.dispose();

  assert.ok(built.every((t) => t.disposedFlag), "expected every tab disposed after registry dispose");
  assert.deepEqual(tabs.keys(), [], "expected the registry to hold no keys after dispose");
});
