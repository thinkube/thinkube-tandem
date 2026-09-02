/**
 * A worker is told, once, in its brief: its commits stay on the branch and
 * Accept is what pushes. A worker that pushed mid-run put half-built work
 * where a pipeline built and deployed it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTepBody } from "./briefs";
import { emptySpace } from "../core/schema";

test("the brief says the worker never pushes", () => {
  const body = renderTepBody({ ...emptySpace(), asks: [{ id: "ask-1", text: "sort the list" }] } as never, { id: "cut-1", tepId: "TEP-1", changeIds: [], askIds: ["ask-1"] } as never);
  assert.match(body, /You never push\./);
  assert.match(body, /Accept merges and pushes it/);
});
