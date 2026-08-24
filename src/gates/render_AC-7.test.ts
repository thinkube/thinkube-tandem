/**
 * INVARIANT — the missing-documentation report holds for a whole cut, not
 * per member: as long as no member across the cut grounds a docs/ path and
 * no waiver is recorded, the cut is reported missing even when it has
 * several members with several src/ touchpoints between them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCutScreen } from "./render";
import { emptySpace } from "../core/schema";

test("renderCutScreen reports documentation missing for a multi-member cut with no docs/ path anywhere and no waiver", () => {
  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "a change grounded in one source file",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "c1 holds" }],
        grounding: { touchpoints: [{ path: "src/a.ts", planned: true }], stamp: [] },
      },
      {
        id: "n2",
        sentence: "a second change grounded in another source file",
        serves: [],
        needs: [],
        acceptance: [{ id: "c2", text: "c2 holds" }],
        grounding: { touchpoints: [{ path: "src/b.ts", planned: true }], stamp: [] },
      },
    ],
  };
  const screen = renderCutScreen(space as never, { id: "cut-1", changeIds: ["n1", "n2"] } as never);
  assert.match(screen, /Documentation/);
  assert.match(screen, /missing/i, "the cut as a whole is reported missing documentation");
});
