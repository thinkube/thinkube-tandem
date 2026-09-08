/**
 * A cut's account outlives the next cut.
 *
 * What a cut leaves behind — the report of what was delivered, the run
 * that produced it with each step's log, and the pictures its reviewers
 * took — was reachable only while it was the newest thing that happened.
 * The moment the next cut delivered, the one before it went off screen
 * with its screenshots, which are the evidence a translation check or a
 * page of documentation is built from.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "./session";
import { spacePush } from "./push";
import { handleInbound } from "./inbound";
import { emptySpace } from "../core/schema";
import { saveRun } from "../run/record";
import { RunState } from "../run/state";

function sessionOfTwoCuts(): TandemSession {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-history-"));
  const session = new TandemSession({
    author: "cmxela",
    round: { model: "sonnet", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
  });
  for (const [cutId, tepId, at] of [
    ["cut-1", "TEP-1", "2026-09-07T10:00:00Z"],
    ["cut-2", "TEP-2", "2026-09-08T10:00:00Z"],
  ]) {
    const st = new RunState(() => {});
    st.seed(`u-${cutId}`, "slice", "code", [], "a promise", []);
    st.log(`${cutId}: what it did`, "gate");
    saveRun(dir, { cutId, tepId, at, state: "done" } as never, st);
  }
  session.space = {
    ...emptySpace(),
    cuts: [
      { id: "cut-1", tepId: "TEP-1", changeIds: [] },
      { id: "cut-2", tepId: "TEP-2", changeIds: [] },
    ],
    deliveries: [
      { id: "d-1", cutId: "cut-1", branch: "b1", proofs: [], producedAt: "2026-09-07T10:00:00Z" },
      { id: "d-2", cutId: "cut-2", branch: "b2", proofs: [], producedAt: "2026-09-08T10:00:00Z" },
    ],
  } as never;
  return session;
}

test("every cut this space ran is offered back, newest first, with what it left", () => {
  const push = spacePush(sessionOfTwoCuts()) as {
    history?: { cutId: string; tepId?: string; deliveryId?: string; hasRun: boolean }[];
  };
  assert.deepEqual(
    push.history?.map((h) => [h.tepId, h.deliveryId, h.hasRun]),
    [
      ["TEP-2", "d-2", true],
      ["TEP-1", "d-1", true],
    ],
    "the older cut is still on the list, with its report and its run",
  );
});

test("looking at an earlier cut reads that cut's own run, not the newest", async () => {
  const session = sessionOfTwoCuts();
  await handleInbound(session, { action: "look-at-cut", cutId: "cut-1" } as never, () => {});
  assert.equal(session.lookingAtCut, "cut-1");
  const push = spacePush(session) as { showing?: string };
  assert.equal(push.showing, "cut-1", "the page is told which cut it is showing");

  await handleInbound(session, { action: "look-at-cut" } as never, () => {});
  assert.equal(session.lookingAtCut, undefined, "and there is a way back to the newest");
});

test("a cut this space never ran is refused, rather than showing somebody else's", async () => {
  const session = sessionOfTwoCuts();
  await handleInbound(session, { action: "look-at-cut", cutId: "cut-99" } as never, () => {});
  assert.equal(session.lookingAtCut, undefined);
});

test("the report shows the cut being looked at, and the run page stays reachable", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "webview", "map", "src", "Delivery.tsx"), "utf8");
  assert.match(src, /push\.showing/, "the report reads which cut is being shown");
  const app = fs.readFileSync(path.join(__dirname, "..", "..", "webview", "map", "src", "App.tsx"), "utf8");
  assert.match(app, /CutHistory/, "the strip that gets there is on the page");
  assert.match(
    app,
    /push\.running \? "workers" : \(flowView \?\? flowViewFor\(push\)\)/,
    "and once a run has ended the person chooses the report or the run, rather than only ever the report",
  );
});
