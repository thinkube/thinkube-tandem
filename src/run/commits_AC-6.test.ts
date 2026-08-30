/**
 * TRANSITION — proofOfPass is a new function the surface draws a pass from:
 * given a positive log-line count it must report proven true and put the
 * count into words, so a passed card always advertises the log that backs
 * it instead of a bare "passed".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { proofOfPass } from "../surfaces/surfaceContract";

test("proofOfPass with a positive line count reports proven true and names the count", () => {
  const p = proofOfPass(7);

  assert.equal(p.proven, true, "a positive line count is proof the pass is backed by a log");
  assert.match(p.text, /7/, "the text names how many log lines stand behind the pass");
});
