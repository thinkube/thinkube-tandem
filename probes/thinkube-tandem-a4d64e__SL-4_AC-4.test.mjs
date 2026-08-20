// WHY (INVARIANT): the parent TEP body alone (no specBody, no sliceBody) is embedded context —
// the worker must be told plainly that its intent is already IN the brief, and must never be
// pointed at a parent spec to go read (there is none to read in this run path). This must hold
// forever: whenever only a TEP body is supplied, the "embedded" framing appears and the
// read-the-parent-spec instruction never does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkerPrompt } from "../out-test/engine/core/preflight.js";

test("buildWorkerPrompt: tepBody alone says the intent is embedded, never 'read the parent spec'", () => {
  const unit = {
    id: "SP-4_SL-4#eu-0",
    slice: "SP-4_SL-4",
    footprint: ["src/d.ts"],
    requires: [],
    shape: "serial",
    role: "code",
  };
  const p = buildWorkerPrompt(unit, "4", {
    tepBody: "## Goal\n\nA person can excuse documentation with a written reason.",
  });
  assert.match(p, /embedded/i);
  assert.doesNotMatch(p, /read the parent spec/i);
});
