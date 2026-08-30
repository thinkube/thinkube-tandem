/**
 * INVARIANT — the "load" action is never refused: handleInbound given
 * {action:"load"} must not be blocked in any phase, including while a run
 * is in flight, so the surface can always re-ask for state after its
 * bundle finishes loading, no matter what the space is doing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handleInbound, InboundAction } from "../surfaces/inbound";
import { TandemSession } from "../surfaces/session";
import { emptySpace } from "../core/schema";
import { refusedNow } from "../surfaces/phase";

function throwawaySession(): TandemSession {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spaceops-ac9-session-"));
  const session = new TandemSession({
    round: { model: "sonnet", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
  } as never);
  session.space = emptySpace();
  return session;
}

test('refusedNow never refuses "load" in any phase', () => {
  const phases = ["drafting", "read", "understood", "signed", "running", "delivered"] as const;
  for (const phase of phases) {
    assert.equal(refusedNow("load", phase), undefined, `load must not be refused in phase "${phase}"`);
  }
});

test('handleInbound given {action:"load"} is not refused while a run is in flight', async () => {
  const session = throwawaySession();
  session.running = true;
  let pushed: string | undefined;
  let pushCount = 0;

  await handleInbound(session, { action: "load" } as InboundAction, (m) => {
    pushCount += 1;
    pushed = m;
  });

  assert.equal(pushCount, 1, "load still runs and pushes once while a run is in flight");
  assert.equal(pushed, undefined, "no refusal message is pushed for load");
});
