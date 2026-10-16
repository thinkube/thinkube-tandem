/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A code unit that follows another code unit continues that coder's
 * session in its first round, with its own footprint and its own blinding;
 * when the session cannot be continued it starts cold, and the log says why.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { firstRoundOf, runFirstRound } from "./continuation";
import type { RunWorkerDeps, WorkerOutcome } from "./worker";

const coders = new Set(["SL-1#eu-0", "SL-2#eu-0", "SL-3#eu-0"]);
const chained = { id: "SL-2#eu-0", requires: ["SL-1#eu-0", "SL-2#eu-1"] };
const known = (over: Partial<Parameters<typeof firstRoundOf>[1]> = {}): Parameters<typeof firstRoundOf>[1] => ({
  coder: true,
  blind: true,
  isCoder: (id) => coders.has(id),
  sessions: new Map([["SL-1#eu-0", "sess-1"]]),
  blindSessions: new Set(["SL-1#eu-0"]),
  failed: new Set(),
  ...over,
});

function deps(): RunWorkerDeps {
  return {
    model: "sonnet",
    worktree: "/tree",
    role: "code",
    blind: true,
    footprint: ["app/b.py"],
    baseline: new Set(),
    abort: new AbortController(),
    onPark: () => {},
    log: () => {},
  };
}

test("a chained unit's first round continues the predecessor's session, forked, with its own footprint and blinding", async () => {
  const start = firstRoundOf(chained, known());
  assert.deepEqual(start, { kind: "continue", from: "SL-1#eu-0", session: "sess-1" });

  const calls: { deps: RunWorkerDeps; brief: string }[] = [];
  const said: string[] = [];
  const { outcome, began } = await runFirstRound({
    start,
    unit: chained.id,
    worker: async (d, brief) => {
      calls.push({ deps: d, brief });
      return { ok: true, finalText: "UNDELIVERED: none", sessionId: "sess-2" };
    },
    deps: deps(),
    brief: "THE BRIEF OF SL-2",
    log: (l) => said.push(l),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].deps.resume, "sess-1", "the predecessor's session is resumed");
  assert.equal(calls[0].deps.fork, true, "as a copy, so the predecessor keeps its own");
  assert.deepEqual(calls[0].deps.footprint, ["app/b.py"], "the guard holds the new unit's footprint");
  assert.equal(calls[0].deps.blind, true, "and the coder stays blinded");
  assert.match(calls[0].brief, /^THE NEXT UNIT CONTINUES IN THIS SESSION\. You finished SL-1#eu-0/);
  assert.match(calls[0].brief, /THE BRIEF OF SL-2$/, "the new unit's brief is the next message");
  assert.equal(outcome.sessionId, "sess-2");
  assert.equal(began, "continued SL-1#eu-0's session");
  assert.ok(said.some((l) => /continues SL-1#eu-0's session sess-1/.test(l)));
});

test("a session the SDK will not continue: the round starts cold, and the log says why in the SDK's words", async () => {
  const calls: RunWorkerDeps[] = [];
  const said: string[] = [];
  const { outcome, began } = await runFirstRound({
    start: { kind: "continue", from: "SL-1#eu-0", session: "sess-1" },
    unit: chained.id,
    worker: async (d): Promise<WorkerOutcome> => {
      calls.push(d);
      return d.resume
        ? { ok: false, finalText: "", undelivered: ["worker errored: No conversation found with session ID: sess-1"] }
        : { ok: true, finalText: "", sessionId: "sess-cold" };
    },
    deps: deps(),
    brief: "THE BRIEF OF SL-2",
    log: (l) => said.push(l),
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].resume, undefined, "the second round is cold");
  assert.equal(outcome.sessionId, "sess-cold");
  assert.match(began, /started cold: SL-1#eu-0's session could not be continued/);
  assert.ok(
    said.some((l) => /sess-1 could not be continued — worker errored: No conversation found with session ID: sess-1; it starts cold/.test(l)),
    said.join("\n"),
  );
});

test("each reason a chained unit cannot continue is named, and an unchained unit simply starts", async () => {
  const why = (over: Partial<Parameters<typeof firstRoundOf>[1]>, unit = chained): string => {
    const s = firstRoundOf(unit, known(over));
    return s.kind === "cold" ? s.why : s.kind;
  };
  assert.match(why({ failed: new Set(["SL-1#eu-0"]) }), /SL-1#eu-0 failed/);
  assert.match(why({ sessions: new Map() }), /left no session/);
  assert.match(why({ blindSessions: new Set() }), /not worked blinded/);
  assert.equal(why({ blindSessions: new Set(), blind: false }), "continue", "an unblinded coder may continue an unblinded session");
  assert.match(why({}, { id: "SL-3#eu-0", requires: ["SL-1#eu-0", "SL-2#eu-0"] }), /follows 2 code units/);
  assert.equal(why({}, { id: "SL-1#eu-0", requires: ["SL-1#eu-1"] }), "first", "a unit after testers alone");
  assert.equal(why({ coder: false }), "first", "a tester never continues a coder");

  const said: string[] = [];
  let resumed: string | undefined = "unset";
  await runFirstRound({
    start: { kind: "cold", why: "SL-1#eu-0 left no session this run can continue" },
    unit: chained.id,
    worker: async (d) => {
      resumed = d.resume;
      return { ok: true, finalText: "" };
    },
    deps: deps(),
    brief: "b",
    log: (l) => said.push(l),
  });
  assert.equal(resumed, undefined);
  assert.ok(said.some((l) => /starts cold — SL-1#eu-0 left no session/.test(l)));
});
