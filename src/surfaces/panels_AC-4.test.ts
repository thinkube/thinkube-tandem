/**
 * Closing one space's tab (e.g. deleting that thinking space) must not
 * reach into any other space's tab — close() is scoped to the one key it
 * names.
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

// INVARIANT: close(key) disposes exactly the named tab; every other open
// key survives untouched and is still returned by get().
test("SpaceTabs.close disposes only the named key and leaves every other key open", () => {
  const tabs = new SpaceTabs((key, title) => fakeTab(key, title));
  const main = tabs.open("repo/main", "Main") as SpaceTab & { disposedFlag: boolean };
  const other = tabs.open("repo/other", "Other") as SpaceTab & { disposedFlag: boolean };

  tabs.close("repo/main");

  assert.equal(main.disposedFlag, true, "expected the named key's tab to be disposed");
  assert.equal(tabs.get("repo/main"), undefined, "expected the named key to be gone from the registry");
  assert.equal(other.disposedFlag, false, "expected the other key's tab to stay untouched");
  assert.equal(tabs.get("repo/other"), other, "expected the other key to still be open");
});
