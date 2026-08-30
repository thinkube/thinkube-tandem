/**
 * What the person asked for reaches the door, or it never happened.
 *
 * `full_rerun` sets one flag: discard the branch an earlier run left, so
 * every unit is proved again on today's base. It travels from the tool to
 * the session, from the session to the scope plan, and from there into the
 * deps the door reads. The deps are assembled FIELD BY FIELD — repoRoot,
 * projectId, model, concurrency — so a field nobody copies at that seam is
 * silently dropped however faithfully it was set upstream.
 *
 * Which is what happened. `full_rerun` answered "run started from nothing
 * — the earlier branch is discarded and tagged", and the door instead
 * said "resuming the existing branch" and marked ten slices standing from
 * the dead run. Twenty of forty-one units were reported done without a
 * worker touching them, keeping verdicts from the very machinery that day
 * had been spent correcting. Nothing failed; the request simply evaporated
 * one hop before it was read.
 *
 * The discard itself was covered by its own checks and they all passed.
 * This one follows the flag to where it is consumed, which is the only
 * place its absence shows.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatchScopePlan } from "./scopeRun";
import { RunState } from "../run/state";
import { emptySpace } from "../core/schema";

/** Drive one scope with a dispatch that records the deps it was handed. */
async function doorSaw(
  sessionDeps: Record<string, unknown>,
): Promise<{ seen: Record<string, unknown>; called: boolean; said: string[] }> {
  let seen: Record<string, unknown> = {};
  let called = false;
  const said: string[] = [];
  await dispatchScopePlan({
    plan: { ok: true, order: [""], groups: new Map([["", ["n1"]]]) },
    cut: { id: "cut-1", tepId: "TEP-1", changeIds: ["n1"] },
    space: () => ({
      ...emptySpace(),
      nodes: [{ id: "n1", sentence: "a promise", serves: [], needs: [], acceptance: [{ id: "c1", text: "it holds" }], grounding: { touchpoints: [{ path: "src/a.ts" }], stamp: [] } }],
    }),
    deps: {
      round: { model: "sonnet", repoRoot: "/repo" },
      storeDir: "/store",
      now: () => new Date().toISOString(),
      dispatch: async (d: Record<string, unknown>) => ((seen = d), (called = true), { refusals: [], undelivered: [] }),
      ...sessionDeps,
    },
    runState: new RunState(() => {}),
    spaceName: "a-space",
    changed: (m: string) => said.push(m),
    onDelivery: () => {},
  } as never);
  return { seen, called, said };
}

test("a fresh start asked for on the session is what the door is told", async () => {
  const { seen, called, said } = await doorSaw({ freshStart: true });
  assert.ok(called, `the door was never reached: ${said.join(" | ")}`);
  assert.equal(
    seen.freshStart,
    true,
    "the door discards the branch on this flag alone — dropped here, full_rerun quietly becomes a resume",
  );
});

test("an ordinary run says nothing about it, and no branch is discarded", async () => {
  const { seen, called } = await doorSaw({});
  assert.ok(called, "the door was reached");
  assert.equal("freshStart" in seen, false, "a rerun resumes, and resuming must never be a decision made by omission");
});
