/**
 * The push the panel sends is the only thing that survives a reload — a
 * reason held only in the session's in-memory field is lost the moment
 * the webview redraws from a fresh push. The push must carry the reason
 * when the session was told one, and carry none when it was not.
 *
 * STANDING INVARIANT — spacePush carries the session's docsNotNeeded
 * reason exactly when sayDocsNotNeeded was called, and carries none
 * otherwise.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession, SessionDeps } from "../surfaces/session";
import { spacePush } from "../surfaces/push";

function fakeDeps(dir: string): SessionDeps {
  return {
    round: { model: "fake-model", repoRoot: dir },
    storeDir: path.join(dir, "store"),
    storageDir: path.join(dir, "storage"),
    now: () => "2026-08-24T00:00:00Z",
    author: "t",
  };
}

test("a push built from a session that was told documentation is not needed carries that reason; a push from a session that was not carries none", () => {
  const toldDir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-push-told-"));
  const told = new TandemSession(fakeDeps(toldDir));
  const reason = "internal rename, nothing a reader of the docs would ever see";
  told.sayDocsNotNeeded(reason);
  const toldPush = spacePush(told) as { docsNotNeeded?: string };
  assert.equal(toldPush.docsNotNeeded, reason, "the push carries the reason the session was told");

  const untoldDir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-push-untold-"));
  const untold = new TandemSession(fakeDeps(untoldDir));
  const untoldPush = spacePush(untold) as { docsNotNeeded?: string };
  assert.equal(
    untoldPush.docsNotNeeded,
    undefined,
    "a session never told a reason produces a push carrying none",
  );
});
