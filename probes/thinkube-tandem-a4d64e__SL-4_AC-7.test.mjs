// WHY (TRANSITION): the same doubling bug reached the tester's brief too — the dispatcher's
// call site (src/run/dispatch.ts, runOne) passed the rendered TEP text as both specBody and
// tepBody for every worker, coder and tester alike. Proves the tester's brief also now carries
// the rendered TEP body exactly once — composed the same way runOne composes a test unit's
// brief, over the two modules this tree can actually build (out-test/run/briefs.js and
// out-test/engine/core/preflight.js; out-test/run/dispatch.js's own transitive graph is not
// provably buildable in this checkout, so this probe does not import it). Its job is done once
// the dispatcher's call site passes the body once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySpace } from "../out-test/core/schema.js";
import { addAsk, addNode } from "../out-test/core/intent.js";
import { renderTepBody } from "../out-test/run/briefs.js";
import { buildWorkerPrompt } from "../out-test/engine/core/preflight.js";

function makeSpace() {
  let s = emptySpace();
  const a = addAsk(s, "greet the user", "t");
  assert.ok(a.ok);
  s = a.space;
  const n = addNode(s, {
    sentence: "a greet module returning a greeting",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "greet() returns 'hello'" }],
    grounding: { touchpoints: [{ path: "src/greet.mjs", planned: true }], stamp: [] },
  });
  assert.ok(n.ok);
  return { space: n.space, changeId: n.added.id };
}

test("dispatch's tester brief: the rendered TEP body rides once (the call site's single-field fix)", () => {
  const { space, changeId } = makeSpace();
  const cut = { id: "cut-1", changeIds: [changeId], tepId: "TEP-t-7" };
  const tepBody = renderTepBody(space, cut);

  const testUnit = {
    id: "TEP-t-7_SL#eu-1",
    slice: "TEP-t-7_SL",
    footprint: ["probes/greet.test.mjs"],
    requires: [],
    shape: "serial",
    role: "test",
    note: "write the acceptance test for greet()",
  };
  // The fixed call site's shape: the rendered TEP body passed under ONE field (tepBody),
  // never duplicated onto specBody as the pre-fix call site did.
  const testerBrief = buildWorkerPrompt(testUnit, "t-7", { tepBody });

  const escaped = tepBody.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const occurrences = (testerBrief.match(new RegExp(escaped, "g")) ?? []).length;
  assert.equal(occurrences, 1, "the rendered TEP body must ride the tester's brief exactly once");
});
