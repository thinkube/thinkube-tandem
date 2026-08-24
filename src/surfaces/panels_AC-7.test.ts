/**
 * TRANSITION — proves the change that makes a closed tab actually leave
 * the registry: once the person has closed a space's tab by hand, opening
 * that same key again must ask the factory for a brand-new tab rather
 * than handing back the disposed one. Its work is done once SpaceTabs
 * forgets a host-disposed key and rebuilds on the next open.
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
  onDidDispose(cb: () => void): void;
  disposeFromHost(): void;
}

function fakeFactory(built: FakeTab[]): (key: string, title: string) => FakeTab {
  return (key, title) => {
    let hostCb: (() => void) | undefined;
    const tab: FakeTab = {
      key,
      title,
      reveal() {},
      push() {},
      dispose() {},
      onDidDispose(cb) {
        hostCb = cb;
      },
      disposeFromHost() {
        hostCb?.();
      },
    };
    built.push(tab);
    return tab;
  };
}

test("opening the same key after the person closed its tab asks the factory for a new tab", () => {
  const built: FakeTab[] = [];
  const tabs = new SpaceTabs(fakeFactory(built));

  const first = tabs.open("repo-a/alpha", "Alpha");
  built[0].disposeFromHost();

  const second = tabs.open("repo-a/alpha", "Alpha");

  assert.equal(built.length, 2, "the factory must be asked again once the previous tab was disposed by the host");
  assert.notEqual(second, first, "the reopened tab must be a fresh instance, not the disposed one");
});
