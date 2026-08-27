/**
 * TRANSITION — the host used to keep one panel in total; this proves the
 * change landed: SpacePanels keeps one panel PER thinking space, so opening
 * two different spaces produces two distinct panels that both stay held by
 * the registry at once, instead of the second replacing the first.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SpacePanels } from "./panels";

/** A minimal fake panel: just enough surface for the registry to hold and
 *  dispose it. It never performs any real webview effect. */
function fakePanel() {
  return {
    disposed: false,
    dispose() {
      this.disposed = true;
    },
  };
}

test("open() with two different keys makes two distinct panels, both still held", () => {
  const made: { key: string; title: string; panel: ReturnType<typeof fakePanel> }[] = [];
  const registry = new SpacePanels((key, title) => {
    const panel = fakePanel();
    made.push({ key, title, panel });
    return panel as never;
  });

  const first = registry.open("repo-1/space-a", "space a");
  const second = registry.open("repo-1/space-b", "space b");

  assert.equal(made.length, 2, "the factory was asked for two panels");
  assert.notEqual(first, second, "the two spaces got distinct panel instances");
  assert.equal(registry.open("repo-1/space-a", "space a"), first, "space a's panel is still held");
  assert.equal(registry.open("repo-1/space-b", "space b"), second, "space b's panel is still held");
  assert.equal(made.length, 2, "re-fetching either open space asked the factory for nothing new");
});
