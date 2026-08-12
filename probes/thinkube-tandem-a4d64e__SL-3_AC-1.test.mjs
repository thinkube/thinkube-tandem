// WHY (TRANSITION): proves the TEP body now states a non-waived cut's
// documentation obligation as required, alongside the asks and decisions
// it already carried — done once renderTepBody grows the docs line.
//
// Public interface under test: src/run/briefs.ts -> renderTepBody(space, cut).
// Compiled by the shared `npm test` step (tsc -p tsconfig.test.json) into
// out-test/, then required here through Node's CJS/ESM bridge so this probe
// can run standalone with `node --test <file>`, no build step of its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { renderTepBody } = require("../out-test/run/briefs.js");

test("TEP body of a non-waived cut states that documentation is required", () => {
  const space = {
    asks: [{ id: "ask-1", text: "greet the user", at: "t" }],
    nodes: [
      {
        id: "change-1",
        sentence: "a greet module returning a greeting",
        serves: ["ask-1"],
        needs: [],
        acceptance: [{ id: "c1", text: "greet() returns 'hello'" }],
      },
    ],
    units: [],
    cuts: [],
    deliveries: [],
    questions: [],
  };
  // No docsWaiver recorded -> the cut's documentation decision is undecided,
  // which the obligation helper (src/core/schema.ts -> docsObligation) reports
  // as required by default.
  const cut = { id: "cut-1", changeIds: ["change-1"], tepId: "TEP-t-1" };

  const body = renderTepBody(space, cut);

  assert.match(
    body,
    /documentation[^\n]*required/i,
    "expected the TEP body to state that documentation is required for a non-waived cut",
  );
});
