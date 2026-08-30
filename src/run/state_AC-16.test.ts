/**
 * TRANSITION — one rule stated once: the closing gate files its own lines
 * under step "gate" and the closer keeps its own sub-step name
 * "gate#closer". Driven with a run state that records line and step
 * (RunState.sink), both must be present after a run that reaches the
 * closer, and neither is flattened into the other.
 *
 * closeGate has exactly one caller in this codebase, dispatchTep, so
 * driving dispatchTep to a delivery IS driving closeGate end to end —
 * the same vehicle src/run/delivers.test.ts and src/run/gateStopped.test.ts
 * use to reach it.
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

test('the gate\'s opening line is under "gate" and the closer\'s under "gate#closer" — both present, neither flattened', async () => {
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape);
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-gate-split" };
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
      spaceName: "gate-split",
      // "unchanging" fails the check. closerFixes: false stops the UNIT-level
      // closer from repairing the tree first — otherwise the gate has no
      // unkept promise left and its own closer never runs. The repository's
      // standing tests reach the gate the same way.
      worker: scriptedWorker(shape, "unchanging", false).worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "gate-split" }),
  );

  assert.ok(outcome.delivery, "the run reached a delivery, and the gate closer ran");

  assert.ok(
    seen.some((s) => s.step === "gate" && /closing gate/.test(s.line)),
    "the gate's own opening line is recorded under step \"gate\"",
  );
  assert.ok(
    seen.some((s) => s.step === "gate#closer"),
    "the closer's lines are recorded under its own sub-step \"gate#closer\"",
  );

  const gateLines = new Set(seen.filter((s) => s.step === "gate").map((s) => s.line));
  const closerLines = new Set(seen.filter((s) => s.step === "gate#closer").map((s) => s.line));
  for (const line of closerLines)
    assert.ok(!gateLines.has(line), `"${line}" was recorded under "gate#closer" and must not also appear under "gate"`);
});
