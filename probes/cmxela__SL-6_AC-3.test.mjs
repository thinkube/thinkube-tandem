// WHY (INVARIANT): a tab the editor has closed must not linger in the
// register as if it were still open — otherwise "open" would silently
// reveal a dead tab instead of making a fresh one. This must hold for as
// long as SpaceTabs exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SpaceTabs } from "../out-test/surfaces/spaceTabs.js";

function fakeTabFactory() {
  const created = [];
  const factory = (key) => {
    const tab = {
      key,
      closed: false,
      isClosed: () => tab.closed,
      reveal: () => {},
      dispose: () => {
        tab.closed = true;
      },
    };
    created.push(tab);
    return tab;
  };
  factory.created = created;
  return factory;
}

test("a tab that reports itself closed is dropped, so reopening that key creates a fresh tab", () => {
  const factory = fakeTabFactory();
  const tabs = new SpaceTabs(factory);

  const first = tabs.open("owner-a/space-1");
  // The editor closed this tab out from under the register — the tab now
  // reports itself closed, but nothing told the register directly.
  first.closed = true;

  const second = tabs.open("owner-a/space-1");

  assert.notEqual(second, first, "a closed tab must not be revealed as if still live");
  assert.equal(factory.created.length, 2, "a fresh tab must be created once the old one reports closed");
});
