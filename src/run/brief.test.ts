/**
 * The coder's contract text. The gates in `runWorker` deny the tools; these
 * pin that the brief SAYS so — a fence nobody explains reads as a broken
 * environment, and an author that does not know why will work around it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { coderStanza, testerStanza } from "./brief";

test("without an oracle nothing is claimed — an author with no feedback is not told it has some", () => {
  assert.equal(coderStanza(false), "");
});

