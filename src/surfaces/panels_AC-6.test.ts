/**
 * TRANSITION — proves the change that makes a closed tab actually leave
 * the registry: when the host (the editor) disposes a tab out from under
 * it — the person closed it by hand — SpaceTabs must drop that key so its
 * open-tab list stays true. Its work is done once SpaceTabs listens for
 * host disposal and forgets the key.
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

function fakeFactory(): (key: string, title: string) => FakeTab {
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
    return tab;
  };
}

test("when a tab reports that the host disposed it, the registry no longer lists that key", () => {
  const built: FakeTab[] = [];
  const tabs = new SpaceTabs((key, title) => {
    const tab = fakeFactory()(key, title);
    built.push(tab);
    return tab;
  });

  tabs.open("repo-a/alpha", "Alpha");
  assert.deepEqual(tabs.keys(), ["repo-a/alpha"]);

  built[0].disposeFromHost();

  assert.deepEqual(tabs.keys(), [], "a key whose tab was disposed by the host must no longer be listed");
});
