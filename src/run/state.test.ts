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
