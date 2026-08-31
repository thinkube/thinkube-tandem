/**
 * INVARIANT: subjectKey must keep telling subjects apart past the sixth,
 * where the six hues start over — a label that repeated there would leave
 * two different subjects sharing one word once their colour repeats.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { subjectKey } from "./marks";

test("subjectKey gives a different label to each of the first twelve subjects", () => {
  const labels = Array.from({ length: 12 }, (_, i) => subjectKey(i));

  assert.equal(new Set(labels).size, 12, "all twelve labels must be distinct, including past the sixth");
});
