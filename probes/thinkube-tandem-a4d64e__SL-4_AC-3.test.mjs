// WHY (INVARIANT): a specBody and a DIFFERENT tepBody are two genuinely distinct artifacts —
// the de-duplication must never collapse them. Both blocks must always render, each exactly
// once, whenever the two texts actually differ. This must hold forever, not just once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkerPrompt } from "../out-test/engine/core/preflight.js";

test("buildWorkerPrompt: distinct specBody and tepBody both render, each exactly once", () => {
  const unit = {
    id: "SP-4_SL-3#eu-0",
    slice: "SP-4_SL-3",
    footprint: ["src/c.ts"],
    requires: [],
    shape: "serial",
    role: "code",
  };
  const specBody = "## Design\n\nBuild the docs exemption gate in the sign path.";
  const tepBody = "## Goal\n\nA person can excuse documentation with a written reason.";
  const p = buildWorkerPrompt(unit, "4", { specBody, tepBody });

  const countOf = (needle) =>
    (p.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;

  assert.equal(countOf("Build the docs exemption gate in the sign path."), 1);
  assert.equal(countOf("A person can excuse documentation with a written reason."), 1);
  assert.match(p, /THE INTENT — the north star/);
  assert.match(p, /PARENT SPEC/);
});
