// WHY (INVARIANT): deleting a thinking space must close that space's own
// tab and no other — the delete command is keyed to one space's identity,
// and its cleanup must reach the matching panel in the registry and stop
// there. This must hold forever: it is what keeps deletion a targeted act
// instead of a blunt one that could take a sibling space's tab with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function installFakeVscode() {
  const registeredCommands = new Map();
  const fakeVscode = {
    window: {
      showWarningMessage: async (_msg, opts) => (opts && opts.modal ? "Delete" : undefined),
    },
    commands: {
      registerCommand: (id, handler) => {
        registeredCommands.set(id, handler);
        return { dispose: () => registeredCommands.delete(id) };
      },
    },
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "vscode") return fakeVscode;
    return originalLoad.call(this, request, parent, isMain);
  };
  return { registeredCommands, restore: () => { Module._load = originalLoad; } };
}

test("deleting a thinking space closes that space's tab and no other", async () => {
  const fake = installFakeVscode();
  try {
    const { registerSpaceCommands } = await import(path.join(repoRoot, "out", "hostui", "spaceOps.js"));

    const closedKeys = [];
    const workspaceState = new Map();
    const fakeContext = {
      workspaceState: {
        get: (k) => workspaceState.get(k),
        update: async (k, v) => {
          if (v === undefined) workspaceState.delete(k);
          else workspaceState.set(k, v);
        },
      },
    };

    registerSpaceCommands(fakeContext, {
      openSpaceFor: async () => {},
      refreshTree: () => {},
      dropSession: () => {},
      deleteSpace: () => ({ ok: true }),
      costOfDeleting: () => ({ exists: true, asks: 0, teps: [], branches: [], merged: [] }),
      sweepResidue: async () => [],
      // The panel-closing hook this slice must add: deleting a space
      // closes exactly the tab keyed to that owner/slug.
      closePanel: (ownerKey, slug) => {
        closedKeys.push(`${ownerKey}/${slug}`);
      },
    });

    const deleteHandler = fake.registeredCommands.get("thinkube-tandem.deleteThinkingSpace");
    assert.ok(deleteHandler, "thinkube-tandem.deleteThinkingSpace must be registered");

    await deleteHandler({ id: "acme/widgets/rebrand" });

    assert.deepEqual(
      closedKeys,
      ["acme/widgets/rebrand"],
      "deleting a space must close exactly that space's tab and no other",
    );
  } finally {
    fake.restore();
  }
});
