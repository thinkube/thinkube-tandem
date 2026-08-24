/**
 * A tab the person closed by hand (a VS Code tab close) must not linger in
 * the registry as if it were still open — once a tab reports its own
 * disposal, the registry forgets it, and the next open for that key builds
 * a fresh tab rather than handing back the dead one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SpaceTabs } from "./panels";
import type { SpaceTab } from "./panels";

function fakeTab(key: string, title: string): { tab: SpaceTab; disposeFromOutside: () => void } {
  const disposedCbs: (() => void)[] = [];
  const tab: SpaceTab = {
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
  return { tab, disposeFromOutside: () => tab.dispose() };
}

// TRANSITION: proves the registry wires onDisposed to forget the key — this
// is new behaviour SL-6 introduces, so it must hold from the first build.
test("after a tab reports disposal, get returns undefined and a later open builds fresh", () => {
  let calls = 0;
  const built: { tab: SpaceTab; disposeFromOutside: () => void }[] = [];
  const tabs = new SpaceTabs((key, title) => {
    calls++;
    const made = fakeTab(key, title);
    built.push(made);
    return made.tab;
  });
  const opened = tabs.open("repo/main", "Main");
  assert.equal(calls, 1);
  // The tab reports it was closed (e.g. the person closed the VS Code tab).
  built[0].disposeFromOutside();
  assert.equal(tabs.get("repo/main"), undefined, "expected the closed tab to be forgotten");
  const reopened = tabs.open("repo/main", "Main");
  assert.equal(calls, 2, "expected a fresh tab to be built for the same key");
  assert.notEqual(reopened, opened, "expected the reopened tab to be a new instance");
});
