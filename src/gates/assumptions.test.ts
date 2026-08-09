import { test } from "node:test";
import assert from "node:assert/strict";
import { foreignWords, judgeRaised } from "./assumptions";

const human = {
  asks: [
    "The brief a worker receives embeds the same TEP text twice under two headings; it must appear exactly once.",
    "Documentation must be required by default for every cut. When it is truly not needed I want to say so explicitly, with a reason, on the cut review page.",
  ],
  claims: ["the TEP text appears exactly once in the brief"],
  rules: [],
};

test("a question written in the machine's own nouns is refused, and they are named", () => {
  const judged = judgeRaised(
    [
      {
        text: "Does dropping specBody flip the engine's hasCtx branch in src/engine/core/preflight.ts?",
        recommendation: "Restore the embedded-context orientation from the dispatch side.",
      },
    ],
    human,
  );
  assert.equal(judged[0].refused, "foreign");
  assert.ok(
    judged[0].foreign!.some((w) => w.includes("preflight")),
    `expected the path to be caught, got ${judged[0].foreign!.join(", ")}`,
  );
  assert.ok(judged[0].foreign!.includes("specBody"), "camelCase is machine vocabulary on sight");
  assert.equal(
    judged[0].recommendation,
    "Restore the embedded-context orientation from the dispatch side.",
    "refusing to ask does not discard what it decided — that becomes the assumption",
  );
});

test("criterion numbers and change ordinals never reach the human", () => {
  const judged = judgeRaised(
    [{ text: "Change 8.0 offers two implementations while criterion 6.0 governs neither." }],
    human,
  );
  assert.equal(judged[0].refused, "foreign");
});

test("a question in the human's own words survives", () => {
  const judged = judgeRaised(
    [
      {
        text: "Does a cut that touches no documentation at all count as saying it is not needed?",
        recommendation: "Yes — it needs a recorded reason like any other.",
      },
    ],
    human,
  );
  assert.equal(judged[0].refused, undefined);
});

test("what a rule already settles is not asked again", () => {
  const judged = judgeRaised(
    [{ text: "Is documentation required by default for every cut?" }],
    { ...human, rules: ["documentation is required by default for every cut"] },
  );
  assert.equal(judged[0].refused, "answered");
});

test("plain English is never refused — only the machine's own language is", () => {
  const theirs = ["the delivery page shows how to see it"];
  assert.deepEqual(
    foreignWords("Does a cut that touches no documentation count as saying it is not needed?", theirs),
    [],
    "ordinary words a person writes must pass, whether or not they appear in the asks",
  );
  assert.deepEqual(
    foreignWords("Should the grounding re-read every touchpoint?", theirs),
    ["grounding", "touchpoint"],
  );
});

test("a word the human writes themselves becomes theirs, and stops being foreign", () => {
  assert.deepEqual(foreignWords("re-read the digest", ["never re-read the repository — keep a digest"]), []);
});
