/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A unit the run never reached names the failure it waits behind, so a
 * person reading a blocked unit finds the real failure from it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { whyNeverRan } from "./pump";

const dag = [
  { id: "SL-1#eu-1", slice: "SL-1", requires: [] },
  { id: "SL-2#eu-1", slice: "SL-2", requires: ["SL-1#eu-1"] },
  { id: "SL-3#eu-1", slice: "SL-3", requires: ["SL-2#eu-1"] },
  { id: "SL-4#eu-1", slice: "SL-4", requires: ["SL-1"] },
  { id: "SL-5#eu-1", slice: "SL-5", requires: [] },
];
const notes: Record<string, string> = {
  "SL-1#eu-1": "it did not write the shared fixture tests/conftest.py that SL-2#eu-1 wait for",
};
const failed = new Set(["SL-1#eu-1"]);

test("a unit waiting on a failed unit names it and its reason", () => {
  assert.equal(
    whyNeverRan("SL-2#eu-1", dag, failed, (id) => notes[id]),
    "never ran — it waits on SL-1#eu-1, which failed: it did not write the shared fixture tests/conftest.py that SL-2#eu-1 wait for",
  );
});

test("a unit waiting through another waiting unit names the failure at the end of the chain", () => {
  assert.match(whyNeverRan("SL-3#eu-1", dag, failed, (id) => notes[id]), /^never ran — it waits on SL-1#eu-1, which failed/);
});

test("a requirement on a slice waits on that slice's units", () => {
  assert.match(whyNeverRan("SL-4#eu-1", dag, failed, (id) => notes[id]), /it waits on SL-1#eu-1/);
});

test("a unit with no failure behind it says the run stopped", () => {
  assert.equal(whyNeverRan("SL-5#eu-1", dag, failed, () => undefined), "never ran — the run stopped before it was reached");
});
