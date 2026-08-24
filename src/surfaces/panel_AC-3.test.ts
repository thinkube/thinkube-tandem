/**
 * Every open tab must show the machine activity of the space it belongs
 * to: the payload spacePush builds must be read off the ONE session passed
 * in, never off some shared or "active" state — so two sessions sitting in
 * different states must produce two visibly different payloads.
 *
 * STANDING INVARIANT — spacePush(session) always carries that session's
 * own activity and grounding rows; it never mixes in another session's.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession, SessionDeps } from "./session";
import { spacePush } from "./push";
import { SpacePanel } from "./panel";
import { RunState } from "../run/state";

function fakeDeps(dir: string): SessionDeps {
  return {
    round: { model: "fake-model", repoRoot: dir },
    storeDir: path.join(dir, "store"),
    storageDir: path.join(dir, "storage"),
    now: () => "2026-08-24T00:00:00Z",
    author: "t",
  };
}

test("the push built from a session carries that session's own run activity and grounding rows", () => {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-push-a-"));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-push-b-"));
  const sessionA = new TandemSession(fakeDeps(dirA));
  const sessionB = new TandemSession(fakeDeps(dirB));

  // Session A is mid-way through grounding one ask. Progress is reported
  // through stageOf — the callback grounding actually drives, and the one
  // that puts a subject's own stage on the top line.
  sessionA.stageOf("ask-1")("reading the code", 2, 4);
  // Session B is grounding a different ask, at a different point.
  sessionB.stageOf("ask-2")("reading the code", 1, 3);

  const payloadA = spacePush(sessionA) as {
    activity?: { label: string; current: number; total: number; askId?: string };
    grounding: { askId: string; label: string; current: number; total: number }[];
  };
  const payloadB = spacePush(sessionB) as {
    activity?: { label: string; current: number; total: number; askId?: string };
    grounding: { askId: string; label: string; current: number; total: number }[];
  };

  assert.equal(payloadA.activity?.askId, "ask-1");
  assert.equal(payloadA.activity?.current, 2);
  assert.equal(payloadA.activity?.total, 4);
  assert.deepEqual(
    payloadA.grounding.map((g) => g.askId),
    ["ask-1"],
  );

  assert.equal(payloadB.activity?.askId, "ask-2");
  assert.equal(payloadB.activity?.current, 1);
  assert.equal(payloadB.activity?.total, 3);
  assert.deepEqual(
    payloadB.grounding.map((g) => g.askId),
    ["ask-2"],
  );

  // The two payloads must actually differ — neither reads the other's state.
  assert.notDeepEqual(payloadA.activity, payloadB.activity);
  assert.notDeepEqual(payloadA.grounding, payloadB.grounding);
});

test("the push built from a session carries that session's own run state — a session with a run in flight and a session with none produce different `run` payloads", () => {
  const dirRunning = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-push-run-"));
  const dirIdle = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-push-idle-"));
  const running = new TandemSession(fakeDeps(dirRunning));
  const idle = new TandemSession(fakeDeps(dirIdle));

  running.runState = new RunState(() => {});
  running.runState.seed("u1", "SL-1", "code");
  running.runState.set("u1", "running");

  const payloadRunning = spacePush(running) as { run?: { units: { id: string }[] } };
  const payloadIdle = spacePush(idle) as { run?: { units: { id: string }[] } };

  assert.ok(payloadRunning.run, "a session with a run in flight must carry its own run activity");
  assert.deepEqual(payloadRunning.run!.units.map((u) => u.id), ["u1"]);
  assert.equal(payloadIdle.run, undefined, "a session with no run must carry no run activity — not another session's");
  assert.notDeepEqual(payloadRunning.run, payloadIdle.run);
});

test("each SpacePanel pushes the payload of the ONE session it was built with, never another panel's", () => {
  // The panel is what actually carries a payload to a webview. Two panels
  // built from two sessions in different states must post different things.
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-panel-a-"));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-panel-b-"));
  const sessionA = new TandemSession(fakeDeps(dirA));
  const sessionB = new TandemSession(fakeDeps(dirB));

  sessionA.stageOf("ask-1")("reading the code", 2, 4);
  sessionB.stageOf("ask-2")("reading the code", 1, 3);

  function panelFor(session: TandemSession, sink: unknown[]): SpacePanel {
    const panel = new SpacePanel(session, "Space");
    (panel as unknown as { _panel: unknown })._panel = {
      webview: {
        postMessage(payload: unknown) {
          sink.push(payload);
          return Promise.resolve(true);
        },
      },
    };
    return panel;
  }

  const postedA: unknown[] = [];
  const postedB: unknown[] = [];
  panelFor(sessionA, postedA).pushFrom();
  panelFor(sessionB, postedB).pushFrom();

  const a = postedA[0] as { activity?: { askId?: string } };
  const b = postedB[0] as { activity?: { askId?: string } };
  assert.equal(a.activity?.askId, "ask-1", "panel A must carry session A's own activity");
  assert.equal(b.activity?.askId, "ask-2", "panel B must carry session B's own activity");
  assert.notDeepEqual(a.activity, b.activity, "two panels in different states must post different payloads");
});
