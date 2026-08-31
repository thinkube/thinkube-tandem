/**
 * TRANSITION — proves the new "load" action is a pure re-ask for state: it
 * calls push exactly once and records nothing on the session — no draft
 * written, no space changed — so the surface can ask for the current state
 * after its own bundle finishes loading without side effects.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handleInbound, InboundAction } from "../surfaces/inbound";
import { TandemSession } from "../surfaces/session";
import { emptySpace } from "../core/schema";

function throwawaySession(): TandemSession {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spaceops-ac8-session-"));
  const session = new TandemSession({
    round: { model: "sonnet", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
  } as never);
  session.space = emptySpace();
  return session;
}

test('handleInbound given {action:"load"} calls push once and records nothing on the session', async () => {
  const session = throwawaySession();
  const spaceBefore = session.space;
  let pushCount = 0;

  await handleInbound(session, { action: "load" } as InboundAction, () => {
    pushCount += 1;
  });

  assert.equal(pushCount, 1, "load asks for the state exactly once");
  assert.equal(session.space, spaceBefore, "the space object is untouched — nothing was recorded");
  assert.deepEqual(session.space, emptySpace(), "no draft or change was written to the space");
});
