/**
 * INVARIANT — pushTo() for a space with no open panel must always be a
 * quiet no-op: nothing to post to, and nothing thrown.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SpacePanels } from "./panels";
import { TandemSession } from "./session";

function throwawaySession(): TandemSession {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-panels-ac6-"));
  return new TandemSession({
    round: { model: "sonnet", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
  });
}

test("pushTo() for a key with no open panel does nothing and raises nothing", () => {
  let madeCount = 0;
  const registry = new SpacePanels(() => {
    madeCount++;
    return { dispose() {}, pushFrom() {} } as never;
  });

  const session = throwawaySession();

  assert.doesNotThrow(() => registry.pushTo("repo-1/never-opened", session, "hello"));
  assert.equal(madeCount, 0, "pushTo() did not open a panel as a side effect");
});
