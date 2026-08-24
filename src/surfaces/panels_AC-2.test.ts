/**
 * Opening a second, different space must never disturb the first space's
 * tab — a new key builds a tab beside the existing one, not instead of it.
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

// INVARIANT: a second key builds its own tab, and the first key's tab is
// untouched — still retrievable through get() — proving open never takes
// over another space's slot.
test("SpaceTabs.open with a second key builds a second tab and leaves the first alive", () => {
  const tabs = new SpaceTabs((key, title) => fakeTab(key, title));
  const first = tabs.open("repo/main", "Main");
  const second = tabs.open("repo/other", "Other");
  assert.notEqual(second, first, "expected a distinct tab for the second key");
  assert.equal(tabs.get("repo/main"), first, "expected the first key's tab to still be retrievable");
  assert.equal(tabs.get("repo/other"), second);
});
