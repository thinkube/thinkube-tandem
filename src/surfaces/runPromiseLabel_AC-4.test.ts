/**
 * TRANSITION: before stateFace existed, a card's live state had only its
 * chip text to tell it apart from another state — nothing survived
 * zooming out. This pins that every one of the six unit states gets its
 * own tone, so no two states share a tone and collapse into one another
 * once the words are gone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { stateFace } from "./runCardFace";

test("every unit state gets a tone distinct from every other unit state", () => {
  const states = ["ready", "running", "parked", "done", "failed", "blocked"];
  const tones = states.map((s) => stateFace(s).tone);

  assert.equal(
    new Set(tones).size,
    states.length,
    "no two of ready/running/parked/done/failed/blocked share a tone — words alone never had to carry the difference",
  );
});
