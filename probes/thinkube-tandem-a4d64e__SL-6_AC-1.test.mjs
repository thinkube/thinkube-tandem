// INVARIANT — opening two different thinking spaces must leave two editor
// tabs open at once, each titled with its own space's name; opening the
// second space must never dispose or replace the first space's tab. This
// behaviour must hold forever: it is the core promise of per-space tabs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadExtensionWithFakeVscode } from "./_harness.mjs";

test("opening space A then space B leaves both tabs open, titled correctly, neither replacing the other", async () => {
  const { vscode, extension, context } = loadExtensionWithFakeVscode({
    spaces: {
      "repo-1": [
        { slug: "plugin-delivery", label: "plugin delivery" },
        { slug: "rebrand", label: "rebrand" },
      ],
    },
  });

  extension.activate(context);
  const openSpace = context.commands["thinkube-tandem.activateProject"];
  assert.ok(openSpace, "thinkube-tandem.activateProject must be registered");

  // Space "plugin delivery" is the sole space bound to repo-1's context by
  // the fake chooseThinkingSpace stub keyed on workspaceState; simulate the
  // sidebar picking each space explicitly before opening.
  context.workspaceState.set("tandem.space.repo-1", "plugin-delivery");
  await openSpace("repo-1");

  context.workspaceState.set("tandem.space.repo-1", "rebrand");
  await openSpace("repo-1");

  const panels = vscode.createdWebviewPanels;
  assert.equal(panels.length, 2, "two distinct webview panels must have been created");
  assert.equal(panels.filter((p) => !p.disposed).length, 2, "neither tab may be disposed by opening the other");

  const titles = panels.map((p) => p.title).sort();
  assert.deepEqual(titles, ["plugin delivery", "rebrand"]);
});
