/**
 * INVARIANT — the projects tree marks a space's row as open by asking the
 * tab registry which keys have an open tab; with several tabs open for the
 * same owner, every one of those spaces must show up, not only the most
 * recently opened. This must always hold as more spaces open tabs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SpaceTabs } from "./panels";

interface FakeTab {
  key: string;
  title: string;
  reveal(): void;
  push(payload: unknown): void;
  dispose(): void;
}

function fakeFactory(): (key: string, title: string) => FakeTab {
  return (key, title) => ({
    key,
    title,
    reveal() {},
    push() {},
    dispose() {},
  });
}

test("with tabs open for two spaces of the same owner, the tree marks both rows as open, not only the last one chosen", () => {
  const tabs = new SpaceTabs(fakeFactory());

  tabs.open("repo-a/alpha", "Alpha");
  tabs.open("repo-a/beta", "Beta");

  const open = new Set(tabs.keys());

  assert.equal(open.has("repo-a/alpha"), true, "the earlier-opened space must still be marked open");
  assert.equal(open.has("repo-a/beta"), true, "the most recently opened space must be marked open");
  assert.equal(open.size, 2);
});
