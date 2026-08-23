// WHY (TRANSITION): the run dispatcher used to hand the same rendered TEP
// text to buildWorkerPrompt twice (as specBody AND as tepBody) — this proves
// that is fixed: in a real dispatched run, observed through an injected
// worker fake, the tester's brief contains the rendered TEP body exactly
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

test("in a dispatched run observed through an injected worker fake, the tester's brief contains the rendered TEP body exactly once", async () => {
  const shape = SHAPES[0];
  const repo = repoInShape(shape);
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-doubling7" };
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
      spaceName: "doubling7",
      worker: scripted.worker,
    },
    space,
    cut,
    tepSlices({ space, cut, spaceName: "doubling7" }),
  );

  // The tester units, by the test-shaped path they were dispatched for. A
  // tester is identified by what its footprint IS — a test file — not by the
  // directory it happens to land in: the dispatcher derives a check's home
  // from its subject's path, so a probe home is `probes/…` for some cuts and
  // beside the source for others, and a filter naming one directory silently
  // matches nothing on the other shape. The closer's brief is a different
  // artifact with its own shape — it is not a tester brief, and this promise
  // is about what a tester is handed.
  const testerBriefs = scripted.briefs.filter(
    (b) => /\.test\.[cm]?[jt]sx?$/.test(b.unit) && !/You are the CLOSER/.test(b.brief),
  );
  assert.ok(
    testerBriefs.length > 0,
    `at least one tester unit must have run; units dispatched were: ${
      scripted.briefs
        .map(
          (b) =>
            `${b.unit}[closer=${/You are the CLOSER/.test(b.brief)},body×${
              b.brief.split(tepBody).length - 1
            }]`,
        )
        .join(", ") || "(none)"
    }`,
  );
  assert.ok(
    tepBody.trim(),
    "the rendered TEP body must be non-empty for this fixture, or 'appears once' is vacuous",
  );
  for (const b of testerBriefs) {
    const occurrences = b.brief.split(tepBody).length - 1;
    assert.equal(
      occurrences,
      1,
      `tester brief for ${b.unit} must contain the rendered TEP body exactly once, found ${occurrences}`,
    );
  }
});
