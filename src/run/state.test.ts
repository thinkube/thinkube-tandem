/**
 * The run's live state as the surface reads it: a failed unit carries the
 * reason it failed, so a run that produced nothing can still say why.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { RunState } from "./state";

test("a failed unit carries its reason into the view", () => {
  let changes = 0;
  const st = new RunState(() => {
    changes++;
  });
  st.seed("u1", "slice-1", "code");
  st.seed("u2", "slice-1", "test", ["u1"]);
  st.set("u1", "running");

  st.fail("u1", "worker errored: usage limit reached");
  const view = st.view();
  const u1 = view.units.find((u) => u.id === "u1")!;
  assert.equal(u1.state, "failed", "one call sets the state");
  assert.equal(u1.note, "worker errored: usage limit reached", "and the reason rides with it");
  assert.equal(view.units.find((u) => u.id === "u2")!.note, undefined, "untouched units stay silent");
  assert.ok(changes > 0, "the surface is told");

  st.fail("ghost", "no such unit");
  assert.equal(st.view().units.length, 2, "a reason for a unit that does not exist invents nothing");
});

test("each step keeps its own log, and the surface pages through it", () => {
  const st = new RunState(() => {});
  st.seed("u1", "SL-1", "code");
  st.seed("u2", "SL-1", "test");
  for (let i = 1; i <= 40; i++) st.log(`u1 line ${i}`, "u1");
  st.log("u2 line 1", "u2");
  st.log("something about the whole run");

  const u1 = st.logPage("u1");
  assert.equal(u1.total, 40, "the step holds every one of its lines");
  assert.equal(u1.pages, Math.ceil(40 / u1.pageSize));
  assert.equal(u1.page, u1.pages - 1, "the newest page opens first");
  assert.equal(u1.lines[u1.lines.length - 1], "u1 line 40");

  const older = st.logPage("u1", 0);
  assert.equal(older.lines[0], "u1 line 1", "the oldest line is still reachable");

  assert.equal(st.logPage("u2").total, 1, "a step sees only its own lines");
  assert.equal(st.logPage("run").total, 1, "what belongs to no step lands on the run");
  assert.equal(st.logPage("ghost").total, 0, "a step with no lines pages to nothing");

  const counts = st.view().logCounts;
  assert.deepEqual(counts, { u1: 40, u2: 1, run: 1 }, "the view advertises where the lines are");
});

test("a unit that never ran is blocked, not failed", () => {
  const s = new RunState(() => {});
  s.seed("u1", "SL-1", "code", [], "what it builds");
  s.seed("u2", "SL-2", "code", ["u1"]);
  s.fail("u1", "the checks are not green");
  s.block("u2", "never ran — the run stopped, or something it waits on failed");

  const [a, b] = s.view().units;
  assert.equal(a.state, "failed", "the one that was tried and did badly");
  assert.equal(b.state, "blocked", "and the one that was never dispatched");
  assert.match(b.note!, /never ran/);
  assert.equal(a.what, "what it builds", "what a unit builds survives what happened to it");
});

test("blocking never overwrites a unit that already finished", () => {
  const s = new RunState(() => {});
  s.seed("u1", "SL-1", "code");
  s.set("u1", "done");
  s.block("u1", "never ran");
  assert.equal(s.view().units[0].state, "done", "a finished unit is not un-finished by a halt");
});

test("an edge says WHY a unit waits — a coupling reads differently from the method working", () => {
  const s = new RunState(() => {});
  s.seed("SL-1#eu-0", "SL-1", "code", [], "what it builds");
  s.seed("SL-2#eu-1", "SL-2", "test", []);
  s.seed(
    "SL-2#eu-0",
    "SL-2",
    "code",
    ["SL-1#eu-0", "SL-2#eu-1"],
    "what it builds",
    [
      { on: "SL-1#eu-0", kind: "needs", what: "src/core/spaces.ts" },
      { on: "SL-2#eu-1", kind: "probes" },
    ],
  );

  const u = s.view().units.find((x) => x.id === "SL-2#eu-0")!;
  assert.deepEqual(u.requires, ["SL-1#eu-0", "SL-2#eu-1"], "both are still edges of the graph");
  assert.deepEqual(
    u.waits,
    [
      { on: "SL-1#eu-0", kind: "needs", what: "src/core/spaces.ts" },
      { on: "SL-2#eu-1", kind: "probes" },
    ],
    "and each one carries why, and the file that caused it",
  );
});
