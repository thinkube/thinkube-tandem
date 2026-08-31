/**
 * A promise the machine wrote for itself informs; it never vetoes.
 *
 * Grounding adds obligations of its own — bring the new modules under the
 * reachability gate, split the files this work pushed past the reading
 * limit. They are reasonable housekeeping, and they are nobody's ask: they
 * serve no subject the person named, and they exist only because the work
 * happened to touch something.
 *
 * They carried the standing of a signed promise. A delivery of a hundred
 * and ninety proofs was withheld on three, and one traced to `gap-2`,
 * whose own ask was about the closing gate's log being unreachable —
 * nothing to do with file length. Every criterion the person had actually
 * asked for was green.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { machineMinted, unkeptProof } from "./schema";

const red = (criterionId: string) =>
  ({ kind: "probe", label: "…", verdict: "red", criterionId }) as never;

test("a red on a machine-minted promise does not withhold the delivery", () => {
  assert.equal(machineMinted({ criterionId: "node-cmxela-gap-2-check-1" }), true);
  assert.equal(
    unkeptProof(red("node-cmxela-gap-2-check-1")),
    false,
    "housekeeping the machine invented cannot hold back work the person asked for",
  );
});

test("a red on the person's own promise still withholds it", () => {
  assert.equal(machineMinted({ criterionId: "node-cmxela-15-2-check-1" }), false);
  assert.equal(
    unkeptProof(red("node-cmxela-15-2-check-1")),
    true,
    "the two vetoes are unchanged for anything traceable to an ask",
  );
});

test("a proof with no criterion behind it is nobody's gap", () => {
  assert.equal(machineMinted({}), false);
  assert.equal(unkeptProof(red("")), true, "the repository's own suite line still vetoes");
});

test("a promise merely numbered like one is not mistaken for a gap", () => {
  assert.equal(machineMinted({ criterionId: "node-cmxela-4-3-check-2" }), false);
  assert.equal(machineMinted({ criterionId: "node-gapless-1-check-1" }), false);
});
