/**
 * The reviews are asked together, and answer in the order they were asked.
 *
 * Every assessment criterion gets its own reviewer, reading the delivered
 * tree and answering GREEN, RED or OBSERVE. Asked one at a time, sixty-one
 * of them were the closing gate's whole cost — an hour of a person's morning
 * spent watching a machine wait on a network it was not using.
 *
 * They share nothing: no cache, no tree state, no order between them. What
 * must not change when they run together is what a reader sees — a review's
 * number, and the order the verdicts arrive in — because both are read off
 * the cut, never off whichever reviewer happened to finish first.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeAssessments } from "./assess";

const HOW_MANY = 12;

const SPACE = {
  asks: [{ id: "ask-1", text: "the pages behave" }],
  nodes: [
    {
      id: "n-1",
      serves: ["ask-1"],
      sentence: "the surface behaves",
      acceptance: Array.from({ length: HOW_MANY }, (_, i) => ({
        id: `ac-${i + 1}`,
        kind: "assessment",
        // Deliberately not observation-shaped: these must reach a reviewer.
        text: `the module exports handle number ${i + 1} and nothing else`,
      })),
    },
  ],
} as never;

const CUT = { id: "cut-1", changeIds: ["n-1"] } as never;

/**
 * A reviewer that answers late in reverse: the last review asked answers
 * first. Any code that files verdicts as they arrive reorders them here.
 */
function reviewers(): { round: unknown; peak: () => number } {
  let running = 0;
  let peak = 0;
  const round = async (_deps: unknown, prompt: string): Promise<string> => {
    running++;
    peak = Math.max(peak, running);
    const which = Number(/handle number (\d+)/.exec(prompt)?.[1] ?? 0);
    await new Promise((r) => setTimeout(r, (HOW_MANY - which) * 6));
    running--;
    return `I read it.\nGREEN handle ${which} is the only one exported`;
  };
  return { round, peak: () => peak };
}

test("reviews are asked together, not one after another", async () => {
  const { round, peak } = reviewers();
  await gradeAssessments({ space: SPACE, cut: CUT, testerWt: "/wt", model: "sonnet", round } as never);
  assert.ok(peak() > 1, `the reviews were still asked one at a time (peak ${peak()})`);
  assert.ok(peak() <= 5, `too many reviewers at once (peak ${peak()}) — the bound is not holding`);
});

test("a verdict is filed where the cut declared it, not where it finished", async () => {
  const { round } = reviewers();
  const { proofs } = await gradeAssessments({
    space: SPACE, cut: CUT, testerWt: "/wt", model: "sonnet", round,
  } as never);

  assert.equal(proofs.length, HOW_MANY);
  assert.deepEqual(
    proofs.map((p) => p.criterionId),
    Array.from({ length: HOW_MANY }, (_, i) => `ac-${i + 1}`),
    "answers arrive in reverse here; the delivery must still read in the cut's order",
  );
  assert.deepEqual(
    proofs.map((p) => p.label.split(":")[0]),
    Array.from({ length: HOW_MANY }, (_, i) => `review-${i + 1}`),
    "and a review keeps the number the cut gave it, whoever answered first",
  );
});

test("asking again for one red asks for that one only", async () => {
  const { round } = reviewers();
  const { proofs } = await gradeAssessments({
    space: SPACE, cut: CUT, testerWt: "/wt", model: "sonnet", round,
    only: (label: string) => label.startsWith("review-7:"),
  } as never);

  assert.equal(proofs.length, 1, "a repair loop re-grades its reds, never the whole panel");
  assert.equal(proofs[0].criterionId, "ac-7", "and the one it asked for keeps its own number");
});
