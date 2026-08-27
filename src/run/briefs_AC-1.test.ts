/**
 * TRANSITION — proves the change landed: renderTepBody now carries the
 * documentation decision for an exempt cut, so a worker's brief states the
 * reason documentation was not needed instead of staying silent about it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTepBody } from "./briefs";
import { emptySpace } from "../core/schema";
import type { Space, Cut } from "../core/schema";

test("renderTepBody carries a documentation section whose text contains the exemption reason verbatim, for an exempt cut", () => {
  const space: Space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "tighten the retry backoff",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "retry() waits twice as long each attempt" }],
        grounding: { touchpoints: [{ path: "src/retry.ts", planned: true }], stamp: [] },
      },
    ],
  };
  const cut: Cut = {
    id: "cut-1",
    changeIds: ["n1"],
    docsExemption: {
      reason: "internal timing tweak, no user-facing behaviour to document",
      at: "2026-08-27T00:00:00Z",
    },
  };
  const body = renderTepBody(space, cut);
  assert.ok(
    body.includes("internal timing tweak, no user-facing behaviour to document"),
    "the exemption reason must appear verbatim in the rendered TEP body",
  );
});
