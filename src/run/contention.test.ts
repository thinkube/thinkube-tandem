/**
 * A plan that can only run one unit at a time says so before it runs.
 *
 * Two units never write the same file at once, so every unit carrying a
 * given file waits for the others that carry it. A run of forty-one units
 * spent three hours and fifty-five minutes and was killed by its own
 * three-hour bound with eight units never started. Not one unit ever
 * waited for a free worker, and no unit was slow: twenty-eight of the
 * forty-one carried `src/surfaces/surfaceContract.ts`, so twenty-eight ran
 * strictly one after another. The plan was a queue, and that was readable
 * from the plan itself before the first worker started.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { contentionNote, contentionOf } from "./contention";

/** The plan that cost the night, in the shape the door holds it. */
const crowded = [
  ...Array.from({ length: 28 }, (_, i) => ({
    id: `SL-${i}#eu-0`,
    footprint: ["src/surfaces/surfaceContract.ts", `src/surfaces/part${i}.ts`],
  })),
  ...Array.from({ length: 13 }, (_, i) => ({ id: `SL-x${i}#eu-0`, footprint: [`src/other${i}.ts`] })),
];

test("a plan queued behind one file is measured, and the wait is stated in hours", () => {
  const c = contentionOf(crowded);
  assert.equal(c.hottest?.path, "src/surfaces/surfaceContract.ts");
  assert.equal(c.serialised, 28, "every unit carrying that file waits for the others");
  assert.equal(c.total, 41);

  const said = contentionNote(c);
  assert.match(said ?? "", /28 of 41 units change src\/surfaces\/surfaceContract\.ts/);
  assert.match(said ?? "", /2\.3 hours/, "what the plan alone costs, before any work");
  assert.match(said ?? "", /queue behind one file/, "and what to do about it, since most of the plan is that queue");
});

test("a plan whose units keep out of each other's way says nothing", () => {
  const spread = Array.from({ length: 12 }, (_, i) => ({ id: `u${i}`, footprint: [`src/a${i}.ts`] }));
  assert.equal(contentionOf(spread).hottest, undefined, "no file is carried twice");
  assert.equal(contentionNote(contentionOf(spread)), undefined, "nothing worth a person's attention");
});

test("a pair of units sharing a file is normal, and is not reported as a queue", () => {
  const pair = [
    { id: "a", footprint: ["src/shared.ts"] },
    { id: "b", footprint: ["src/shared.ts"] },
  ];
  assert.equal(contentionOf(pair).serialised, 2);
  assert.equal(contentionNote(contentionOf(pair)), undefined, "two taking turns is how the run works");
});
