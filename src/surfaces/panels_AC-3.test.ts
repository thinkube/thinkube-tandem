/**
 * INVARIANT — once a panel reports it was disposed (its tab was closed),
 * the registry must always drop that key, so a later open() for the same
 * space asks the factory for a fresh panel instead of handing back a dead
 * one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SpacePanels } from "./panels";

/** A fake panel that lets the test trigger its disposal callback, the way
 *  a real SpacePanel would when its tab closes. */
function fakePanel() {
  let onDispose: (() => void) | undefined;
  return {
    disposed: false,
    onDidDispose(cb: () => void) {
      onDispose = cb;
    },
    dispose() {
      this.disposed = true;
      onDispose?.();
    },
  };
}

test("a disposed panel's key is dropped, so opening that space again makes a fresh panel", () => {
  const made: unknown[] = [];
  const panels: ReturnType<typeof fakePanel>[] = [];
  const registry = new SpacePanels(() => {
    const p = fakePanel();
    panels.push(p);
    made.push(p);
    return p as never;
  });

  const first = registry.open("repo-1/space-a", "space a");
  assert.equal(made.length, 1);

  // The tab closes: the panel itself reports disposal.
  panels[0].dispose();

  const second = registry.open("repo-1/space-a", "space a");

  assert.equal(made.length, 2, "the factory was asked for a fresh panel after disposal");
  assert.notEqual(second, first, "the registry did not hand back the dead panel");
});
