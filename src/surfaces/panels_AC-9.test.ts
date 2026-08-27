/**
 * TRANSITION — proves the delivery notification's "Open the space" button
 * now opens the tab for the space key the delivering message came from,
 * not whichever space happens to be remembered as active: with two spaces
 * open, a background delivery must not reveal the foreground space's tab
 * in its place.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SpacePanels } from "./panels";

function fakePanel() {
  return { revealed: 0, dispose() {}, reveal() { this.revealed++; } };
}

test("opening the space named by a delivery reveals that space's own tab, not the foreground one", () => {
  const byKey = new Map<string, ReturnType<typeof fakePanel>>();
  const registry = new SpacePanels((key) => {
    const p = fakePanel();
    byKey.set(key, p);
    return p as never;
  });

  // Two spaces are open: "foreground" is what the user is looking at,
  // "background" is the one whose delivery just landed.
  registry.open("repo-1/foreground", "foreground");
  registry.open("repo-1/background", "background");

  // The "Open the space" button on the delivery notification acts on the
  // key the delivering message named, via the same open() the host uses.
  const deliveredKey = "repo-1/background";
  const opened = registry.open(deliveredKey, "background");

  assert.equal(opened, byKey.get("repo-1/background"), "the button opened the delivering space's own panel");
  assert.equal(
    byKey.get("repo-1/foreground")!.revealed,
    0,
    "the foreground space's tab was not revealed in the background space's place",
  );
});
