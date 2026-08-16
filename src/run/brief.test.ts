/**
 * The coder's contract text. The gates in `runWorker` deny the tools; these
 * pin that the brief SAYS so — a fence nobody explains reads as a broken
 * environment, and an author that does not know why will work around it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { coderStanza, testerStanza } from "./brief";

test("with the oracle, the brief names verify as the only feedback and forbids the rest", () => {
  const s = coderStanza(true);
  assert.match(s, /`verify` tool is available/);
  assert.match(s, /ONLY feedback channel/);
  for (const forbidden of [/never run a build/i, /test command/i, /package\s*manager/i, /no shell/i])
    assert.match(s, forbidden, `the brief must forbid: ${forbidden}`);
  assert.match(s, /Never open, edit or create a test or probe file/);
});

test("without an oracle nothing is claimed — an author with no feedback is not told it has some", () => {
  assert.equal(coderStanza(false), "");
});

test("every tester is told: observe at a seam, stop what you start, never act on the world", () => {
  const t = testerStanza();
  assert.ok(/OBSERVES the code at a seam/.test(t));
  assert.ok(/stops it before it ends/.test(t) && /does not exit is a defective check/.test(t));
  assert.ok(/NEVER performs the effect/.test(t) && /judged once by the person/.test(t));
});
