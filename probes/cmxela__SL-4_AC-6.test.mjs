// WHY (TRANSITION): the run dispatcher used to hand the same rendered TEP
// text to buildWorkerPrompt twice (as specBody AND as tepBody) — this proves
// that is fixed: in a real dispatched run, observed through an injected
// worker fake, the coder's brief contains the rendered TEP body exactly
// once, not twice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatchTep } from "../out-test/run/dispatch.js";
import { RunState } from "../out-test/run/state.js";
import { tepSlices } from "../out-test/dispatch/adapter.js";
import { emptySpace } from "../out-test/core/schema.js";
import { addAsk, addNode } from "../out-test/core/intent.js";
import { renderTepBody } from "../out-test/run/briefs.js";
import { SHAPES, repoInShape, scriptedWorker } from "../out-test/run/shapes.js";

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

test("in a dispatched run observed through an injected worker fake, the coder's brief contains the rendered TEP body exactly once", async () => {
  const shape = SHAPES[0];
  const repo = repoInShape(shape);
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-doubling6" };
  const tepBody = renderTepBody(space, cut);
  const state = new RunState(() => {});
  const scripted = scriptedWorker(shape, "honest");
  await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "doubling6",
      worker: scripted.worker,
    },
    space,
    cut,
    tepSlices({ space, cut, spaceName: "doubling6" }),
  );

  const coderBriefs = scripted.briefs.filter((b) => !/probes\//.test(b.unit));
  assert.ok(coderBriefs.length > 0, "at least one coder unit ran");
  for (const b of coderBriefs) {
    const occurrences = b.brief.split(tepBody).length - 1;
    assert.equal(occurrences, 1, `coder brief for ${b.unit} must contain the rendered TEP body exactly once, found ${occurrences}`);
  }
});
