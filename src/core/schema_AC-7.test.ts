/**
 * TRANSITION — the dispatch deps built for each scope by dispatchScopePlan
 * do not yet carry the session's clock. This proves a session whose `now`
 * is scripted, dispatching through dispatchScopePlan with a fake dispatch,
 * hands the run a clock that reads that scripted moment — so a delivery's
 * produced-at and the session's own stamps (acceptedAt, etc.) read from one
 * source.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatchScopePlan } from "../dispatch/scopeRun";
import { RunState } from "../run/state";
import { emptySpace } from "../core/schema";
import { addAsk, addNode } from "../core/intent";
import type { DispatchDeps } from "../run/deps";

function oneAsk() {
  let s = emptySpace();
  const a = addAsk(s, "greet the user", "t");
  assert.ok(a.ok);
  s = a.space;
  const n = addNode(s, {
    sentence: "a greet module",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "greet() returns 'hello'" }],
    grounding: { touchpoints: [{ path: "src/greet.mjs", planned: true }], stamp: [] },
  });
  assert.ok(n.ok);
  return { space: n.space, ids: [n.added.id] };
}

test("dispatchScopePlan hands the run's dispatch deps a clock reading the session's own scripted now", async () => {
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-scope-clock" };
  const SCRIPTED_ISO = "2026-08-24T09:30:00.000Z";
  const seenClocks: (() => number)[] = [];
  const fakeDispatch = async (deps: DispatchDeps) => {
    if (typeof (deps as unknown as { now?: () => number }).now === "function")
      seenClocks.push((deps as unknown as { now: () => number }).now);
    return {
      refusals: [],
      undelivered: [],
      delivery: { id: "delivery-1", cutId: cut.id, branch: "tandem/TEP-scope-clock", proofs: [] },
    };
  };

  await dispatchScopePlan({
    plan: { ok: true, groups: new Map([["", ids]]), order: [""] },
    cut,
    space: () => space,
    deps: {
      round: { model: "sonnet", volumeModel: "sonnet", repoRoot: "/tmp/does-not-matter" },
      storeDir: "/tmp/does-not-matter-store",
      storageDir: "/tmp/does-not-matter-storage",
      now: () => SCRIPTED_ISO,
      dispatch: fakeDispatch,
    } as never,
    runState: new RunState(() => {}),
    spaceName: "scope-clock",
    onDelivery: () => {},
    changed: () => {},
  });

  assert.equal(seenClocks.length, 1, "the run was handed a clock");
  const readMoment = seenClocks[0]();
  assert.equal(
    new Date(readMoment).toISOString(),
    SCRIPTED_ISO,
    "the clock handed to the run reads the session's own scripted moment",
  );
});
