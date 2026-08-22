/**
 * The TEP body every worker reads as its brief: it says when documentation
 * was excused, carrying the recorded reason, and says nothing of the kind
 * for a cut that carries no exemption.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptySpace, Space } from "../core/schema";
import { renderTepBody } from "./briefs";

function makeSpace(ask: string, sentence: string): { space: Space; changeId: string } {
  const s: Space = {
    ...emptySpace(),
    asks: [{ id: "ask-1", text: ask, at: "t" }],
    nodes: [
      {
        id: "node-1",
        sentence,
        serves: ["ask-1"],
        needs: [],
        acceptance: [{ id: "c1", text: "it works" }],
        grounding: { touchpoints: [{ path: "src/thing.ts" }], stamp: [] },
      },
    ],
  };
  return { space: s, changeId: "node-1" };
}

test("renderTepBody says documentation is not needed and carries the recorded reason for an excused cut", () => {
  const { space, changeId } = makeSpace("ship a change with no documentation", "a change that lands only in code");
  const reason = "config-only change; nothing to document, verbatim reason here";
  const cut = { id: "cut-1", tepId: "TEP-user-1", changeIds: [changeId], exemption: { reason } };
  const body = renderTepBody(space, cut);
  assert.match(body, /documentation is not needed/i, "the body says documentation is excused");
  assert.ok(body.includes(reason), "and carries the recorded reason");
});

test("renderTepBody prints no exemption line for a cut with no exemption", () => {
  const { space, changeId } = makeSpace("ship a documented change", "a change that lands in code and docs");
  const cut = { id: "cut-1", tepId: "TEP-user-1", changeIds: [changeId] };
  const body = renderTepBody(space, cut);
  assert.doesNotMatch(body, /documentation is not needed/i, "no exemption, no such line");
});
