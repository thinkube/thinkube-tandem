/**
 * INVARIANT — pushTo() must always route a space's state to that space's
 * own tab and to no other: posting for one key must never leak into a
 * panel registered under a different key.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SpacePanels } from "./panels";
import { TandemSession } from "./session";

function fakePanel() {
  const pushes: { message?: string }[] = [];
  return {
    pushes,
    dispose() {},
    pushFrom(_session: TandemSession, message?: string) {
      pushes.push({ message });
    },
  };
}

function throwawaySession(): TandemSession {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-panels-ac5-"));
  return new TandemSession({
    round: { model: "sonnet", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
  });
}

test("pushTo() posts only to the panel registered for that key", () => {
  const byKey = new Map<string, ReturnType<typeof fakePanel>>();
  const registry = new SpacePanels((key) => {
    const p = fakePanel();
    byKey.set(key, p);
    return p as never;
  });

  registry.open("repo-1/space-a", "space a");
  registry.open("repo-1/space-b", "space b");

  const session = throwawaySession();
  registry.pushTo("repo-1/space-a", session, "hello a");

  assert.deepEqual(
    byKey.get("repo-1/space-a")!.pushes,
    [{ message: "hello a" }],
    "space a's panel received the push",
  );
  assert.deepEqual(
    byKey.get("repo-1/space-b")!.pushes,
    [],
    "space b's panel received nothing",
  );
});
