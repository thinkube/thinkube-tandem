/**
 * The headless entry makes two decisions of its own; both are here, and
 * both would break a run silently if they were wrong: which arguments the
 * run was given, and which cut it is about to build.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseCut, parseArgs } from "./headless";
import { emptySpace } from "../core/schema";
import type { Space } from "../core/schema";

test("the arguments a run is given: the two that are required, and the defaults for the rest", () => {
  const bad = parseArgs(["--repo", "/r"]);
  assert.equal(typeof bad, "string", "without a space it says what it needs");
  const a = parseArgs(["--space", "/s", "--repo", "/r"]);
  assert.notEqual(typeof a, "string");
  if (typeof a === "string") return;
  assert.deepEqual(a.suite, ["npm", "test"], "the suite command defaults to the repository's own");
  assert.equal(a.model, "sonnet");
  assert.equal(a.digest, true, "the repository reading is on unless refused");
  assert.equal(a.prepare, undefined);

  const b = parseArgs(["--space", "/s", "--repo", "/r", "--suite", "pnpm run check", "--prepare", "npx tsc -p .", "--model", "opus", "--no-digest"]);
  if (typeof b === "string") return assert.fail(b);
  assert.deepEqual(b.suite, ["pnpm", "run", "check"], "a multi-word suite command survives");
  assert.equal(b.prepare, "npx tsc -p .");
  assert.equal(b.model, "opus");
  assert.equal(b.digest, false);
});

test("which cut it builds: the newest signed one, or the one named — never an unsigned draft", () => {
  const s: Space = {
    ...emptySpace(),
    cuts: [
      { id: "cut-1", changeIds: [], tepId: "TEP-a-1", signature: { at: "t", renderHash: "r", groundingHash: "g" } },
      { id: "cut-2", changeIds: [] },
      { id: "cut-3", changeIds: [], tepId: "TEP-a-3", signature: { at: "t", renderHash: "r", groundingHash: "g" } },
    ],
  };
  const newest = chooseCut(s);
  assert.notEqual(typeof newest, "string");
  assert.equal(typeof newest === "string" ? "" : newest.id, "cut-3", "the newest SIGNED cut, skipping the unsigned one");
  const byTep = chooseCut(s, "TEP-a-1");
  assert.equal(typeof byTep === "string" ? "" : byTep.id, "cut-1", "named by its TEP");
  assert.match(String(chooseCut(s, "cut-2")), /no signed cut named cut-2/, "an unsigned cut is refused by name, and the signed ones are listed");
  assert.match(String(chooseCut(emptySpace())), /no signed cut/);
});
