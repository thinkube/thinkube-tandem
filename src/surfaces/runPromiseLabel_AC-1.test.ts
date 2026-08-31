/**
 * TRANSITION: promiseLabelOf is a new seam — before it existed, a run
 * card's title had no way to show the promise it keeps in the space's own
 * words. This pins that `full` carries that sentence unaltered, so the
 * hover text a person reads is the ask's own wording, not a paraphrase.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { promiseLabelOf } from "./runPromiseLabel";
import type { Change, Unit } from "../core/schema";

function change(id: string, sentence: string): Change {
  return { id, sentence, serves: [], needs: [], acceptance: [] };
}

function unit(id: string, changeIds: string[]): Unit {
  return { id, changeIds };
}

test("promiseLabelOf returns the change's own promise sentence, unaltered, as full", () => {
  const nodes = [change("chg-1", "The status bar becomes the one place that says whether the machine is busy.")];
  const units = [unit("SL-1#eu-1", ["chg-1"])];

  const out = promiseLabelOf({ nodes, units, slice: "SL-1" });

  assert.ok(out, "a unit holding one change of the named slice produces a label");
  assert.equal(
    out!.full,
    "The status bar becomes the one place that says whether the machine is busy.",
    "full is the space's own sentence, byte for byte — no rewriting, no trimming, no added punctuation",
  );
});
