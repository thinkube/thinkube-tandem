/**
 * TRANSITION — handleInbound's answer-worker action now tells the person
 * their answer was not delivered instead of letting it vanish.
 *
 * When the named unit is not parked — never parked, already answered, or
 * moved on by the time the press arrives — the one answer box must say so
 * rather than silently dropping the text. This pins that a note naming the
 * worker as no longer waiting is pushed, and that nothing is delivered.
 * Its job is done once the implementation exists.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-affordances-ac2-"));
  return new TandemSession({
    round: { model: "sonnet", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
  });
}

test("answer-worker for a unit that is not parked pushes a note and delivers nothing", async () => {
  const session = throwawaySession();
  session.runState = new RunState(() => {});
  session.runState.seed("u1", "SL-14", "code");
  session.runState.set("u1", "running");
  assert.equal(session.runState.units.get("u1")?.state, "running", "set up: the unit is not parked");

  const notes: (string | undefined)[] = [];
  await handleInbound(
    session,
    { action: "answer-worker", unitId: "u1", text: "an answer arriving too late" } as InboundAction,
    (m) => notes.push(m),
  );

  const note = notes.find((m) => typeof m === "string" && m.length > 0);
  assert.ok(note, "a note was pushed rather than the answer vanishing in silence");
  assert.match(
    (note ?? "").toLowerCase(),
    /no longer waiting|not (waiting|parked)/,
    "the note says the worker is no longer waiting, not a generic failure",
  );

  assert.equal(
    session.runState.units.get("u1")?.state,
    "running",
    "the unit's state is untouched — nothing was delivered to it",
  );
});
