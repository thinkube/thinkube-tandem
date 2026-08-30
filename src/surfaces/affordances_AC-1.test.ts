/**
 * TRANSITION — handleInbound's answer-worker action now delivers straight
 * to the parked worker instead of vanishing into a second answer box.
 *
 * Before this change the rail's answer box was the only place that could
 * send this action, but nothing proved the host actually reaches the
 * parked worker and leaves its unit running rather than re-parking it or
 * marking it done. This pins that the delivery lands and the run keeps
 * going. Its job is done once the implementation exists — the behaviour
 * itself is not expected to change again after that.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handleInbound, InboundAction } from "./inbound";
import { TandemSession } from "./session";
import { RunState } from "../run/state";

function throwawaySession(): TandemSession {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-affordances-ac1-"));
  return new TandemSession({
    round: { model: "sonnet", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
  });
}

test("answer-worker delivers the text to the parked worker and leaves the unit running", async () => {
  const session = throwawaySession();
  session.runState = new RunState(() => {});
  session.runState.seed("u1", "SL-14", "code");

  let delivered: string | undefined;
  session.runState.park("u1", "which store root?", (a) => {
    delivered = a;
  });
  assert.equal(session.runState.units.get("u1")?.state, "parked", "set up: the unit starts parked");

  const notes: (string | undefined)[] = [];
  await handleInbound(
    session,
    { action: "answer-worker", unitId: "u1", text: "use the default store" } as InboundAction,
    (m) => notes.push(m),
  );

  assert.equal(delivered, "use the default store", "the worker's own answer callback received the text");
  assert.equal(
    session.runState.units.get("u1")?.state,
    "running",
    "the unit is left running, not parked and not vanished into some other state",
  );
});
