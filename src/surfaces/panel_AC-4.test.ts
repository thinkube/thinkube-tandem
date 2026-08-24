/**
 * A delivery-ready notice must name the space it came from and its open
 * gesture must reveal that space's own tab — never whichever space happens
 * to be active — because a build can finish in a background space while a
 * different one is in front. The registry is what "reveal this space's
 * tab" means: opening a key must always resolve to the tab registered
 * under that same key, and spaceLabel is what "name that space" reads
 * from — the name the person actually gave it, not a directory spelling.
 *
 * STANDING INVARIANT — the key a delivery-ready notice targets must always
 * resolve, through SpaceTabs, to the tab of the space that produced it,
 * and the label a notice would show for that key must always be the name
 * recorded for that specific space, whichever space is active.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SpaceTabs } from "./panels";
import { spaceLabel } from "../core/spaces";

interface FakeTab {
  key: string;
  title: string;
  revealed: number;
  reveal(): void;
  push(payload: unknown): void;
  dispose(): void;
}

function fakeFactory(made: FakeTab[]): (key: string, title: string) => FakeTab {
  return (key, title) => {
    const tab: FakeTab = {
      key,
      title,
      revealed: 0,
      reveal() {
        tab.revealed += 1;
      },
      push() {},
      dispose() {},
    };
    made.push(tab);
    return tab;
  };
}

test("a change pushed for a space other than the active one names that space and its open gesture targets that space's key, not the active one", () => {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-notice-"));
  const activeDir = path.join(storeRoot, "spaces", "repo-a", "active-space");
  const backgroundDir = path.join(storeRoot, "spaces", "repo-a", "background-space");
  fs.mkdirSync(activeDir, { recursive: true });
  fs.mkdirSync(backgroundDir, { recursive: true });
  fs.writeFileSync(path.join(activeDir, "name.txt"), "Active Space\n");
  fs.writeFileSync(path.join(backgroundDir, "name.txt"), "Background Space\n");

  const made: FakeTab[] = [];
  const tabs = new SpaceTabs(fakeFactory(made));
  tabs.open("repo-a/active-space", "Active Space");
  tabs.open("repo-a/background-space", "Background Space");

  // The delivery finished in the BACKGROUND space while the ACTIVE space
  // is the one in front — the notice must still name and target the
  // background space, not whichever one is active.
  const sourceKey = "repo-a/background-space";
  const noticeLabel = spaceLabel(storeRoot, "repo-a", "background-space");
  assert.equal(noticeLabel, "Background Space", "the notice must name the space it actually came from");
  assert.notEqual(noticeLabel, "Active Space");

  const targeted = tabs.open(sourceKey, noticeLabel);
  const backgroundTab = made.find((t) => t.key === "repo-a/background-space")!;
  const activeTab = made.find((t) => t.key === "repo-a/active-space")!;
  assert.equal(targeted, backgroundTab, "the open gesture must resolve to the source space's own tab");
  assert.equal(backgroundTab.revealed >= 1, true);
  assert.equal(activeTab.revealed, 0, "the active space's tab must not be revealed by a notice from another space");
});
