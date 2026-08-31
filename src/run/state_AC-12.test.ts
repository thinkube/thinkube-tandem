/**
 * TRANSITION — the closing gate must file the lines it writes itself under
 * the step named "gate", the same name its card carries, instead of the
 * run's catch-all "run" step: its own opening line ("closing gate") must
 * land in stepLogs under "gate" — seen through a RunState whose sink
 * records line and step — not be lost in the run-wide default.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatchTep } from "./dispatch";
import { RunState } from "./state";
import { tepSlices } from "../dispatch/adapter";
import { emptySpace } from "../core/schema";
import { addAsk, addNode } from "../core/intent";
import { SHAPES, repoInShape, scriptedWorker } from "./shapes";
import type { RepoShape } from "./shapes";

function oneAsk(): { space: ReturnType<typeof emptySpace>; ids: string[] } {
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

test('closeGate records its own opening line under step "gate"', async () => {
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape);
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-gate-step" };
  const state = new RunState(() => {});
  const seen: { line: string; step: string }[] = [];
  state.sink = (line, step) => seen.push({ line, step });

  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      told: { suite: "true", ...(shape.runOne ? { runOne: shape.runOne } : {}) },
      state,
      supervisorRound: async () => null,
      spaceName: "gate-step",
      worker: scriptedWorker(shape, "honest").worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "gate-step" }),
  );

  assert.ok(outcome.delivery, "the run reached a delivery");
  assert.ok(
    state.stepLogs.get("gate")?.some((l) => /closing gate/.test(l)),
    `the gate's own opening line must be under "gate": ${JSON.stringify(state.stepLogs.get("gate"))}`,
  );
  assert.ok(
    seen.some((s) => s.step === "gate" && /closing gate/.test(s.line)),
    "the sink itself observed the line filed under step \"gate\"",
  );
});
