// WHY (TRANSITION): the dispatcher's call site (src/run/dispatch.ts, runOne) used to hand
// buildWorkerPrompt the SAME rendered TEP text under BOTH the specBody and tepBody fields, so
// the coder's brief carried the whole rendered TEP body twice over. It must now ride under a
// single field (tepBody), which THE INTENT block alone renders. This proves the coder's brief
// carries the rendered TEP body exactly once — composed the same way runOne composes a code
// unit's brief, over the two modules this tree can actually build (out-test/run/briefs.js and
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

test("dispatch's coder brief: the rendered TEP body rides once (the call site's single-field fix)", () => {
  const { space, changeId } = makeSpace();
  const cut = { id: "cut-1", changeIds: [changeId], tepId: "TEP-t-6" };
  const tepBody = renderTepBody(space, cut);

  const codeUnit = {
    id: "TEP-t-6_SL#eu-0",
    slice: "TEP-t-6_SL",
    footprint: ["src/greet.mjs"],
    requires: [],
    shape: "serial",
    role: "code",
    note: "implement greet()",
  };
  // The fixed call site's shape: the rendered TEP body passed under ONE field (tepBody),
  // never duplicated onto specBody as the pre-fix call site did.
  const coderBrief = buildWorkerPrompt(codeUnit, "t-6", { tepBody });

  const escaped = tepBody.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const occurrences = (coderBrief.match(new RegExp(escaped, "g")) ?? []).length;
  assert.equal(occurrences, 1, "the rendered TEP body must ride the coder's brief exactly once");
});
