// WHY (TRANSITION): proves the TEP body now states a waived cut's
// documentation decision as not needed and carries the human's reason
// verbatim, alongside the asks and decisions it already carried — done
// once renderTepBody grows the docs line for the waived case.
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

test("TEP body of a waived cut states documentation is not needed and contains the human's reason verbatim", () => {
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
  const reason = "this change has no user-facing surface to document";
  // A recorded waiver with a non-empty reason -> the obligation helper
  // (src/core/schema.ts -> docsObligation) reports the cut as waived and
  // hands the reason back verbatim.
  const cut = {
    id: "cut-1",
    changeIds: ["change-1"],
    tepId: "TEP-t-1",
    docsWaiver: { reason },
  };

  const body = renderTepBody(space, cut);

  assert.match(
    body,
    /documentation[^\n]*not needed/i,
    "expected the TEP body to state that documentation is not needed for a waived cut",
  );
  assert.ok(
    body.includes(reason),
    "expected the TEP body to contain the human's waiver reason verbatim",
  );
});
