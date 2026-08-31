/**
 * TRANSITION: subjectKey is a new seam — before it existed, a subject read
 * from the asks had no label of its own that a test could check. This pins
 * that the label is the subject's position, counted from one: the first
 * subject reads S1, the second reads S2.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { subjectKey } from "./marks";

test("subjectKey returns S1 for the first subject and S2 for the second", () => {
  assert.equal(subjectKey(0), "S1", "the first subject, counted from one, is S1");
  assert.equal(subjectKey(1), "S2", "the second subject, counted from one, is S2");
});
