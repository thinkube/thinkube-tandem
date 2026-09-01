/**
 * A subject the reader saw must be a subject the page can point at.
 *
 * The reader named the subject of one sentence "the worker brief"; the
 * sentence says "The brief a worker receives". No mark was drawn, and the
 * page read as "no subject found" — false, and the reading was right.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { markSentence } from "./marks";

const SENTENCE =
  "The brief a worker receives embeds the same TEP text twice under two headings; it must appear exactly once.";

test("a subject the sentence phrases differently is still marked in the sentence", () => {
  const marked = markSentence(
    SENTENCE,
    [
      {
        name: "the worker brief",
        claims: [{ text: "the TEP text must appear exactly once", from: 2, quote: "it must appear exactly once", mention: "it" }],
      },
    ],
    2,
  );
  const subjectPieces = marked.parts.flatMap((p) => p.pieces).filter((p) => p.subject !== undefined);
  assert.equal(subjectPieces.length, 1, JSON.stringify(marked.parts));
  assert.equal(subjectPieces[0].text, "brief a worker", "the sentence's own words for the subject");
  const claim = marked.parts.find((p) => p.kind === "claim");
  assert.ok(claim && claim.kind === "claim");
  assert.equal(claim.writeIn, false, "a subject the sentence names needs no write-in");
});

test("a subject the sentence never names is written in once, never invented in the words", () => {
  const marked = markSentence(
    "It must appear exactly once.",
    [{ name: "the delivery page", claims: [{ text: "appears once", from: 1, quote: "It must appear exactly once.", mention: "It" }] }],
    1,
  );
  assert.equal(marked.parts.flatMap((p) => p.pieces).filter((p) => p.subject !== undefined).length, 0);
  const claim = marked.parts.find((p) => p.kind === "claim");
  assert.ok(claim && claim.kind === "claim" && claim.writeIn, "the subject is written in");
});

/**
 * A merged subject is still pointable-at in every sentence it came from.
 *
 * One subject is often written differently in every sentence — "Finished
 * tasks", "the high priority ones", "A task that is past its due date" are
 * one list under three descriptions — and its name can only be one of them.
 * Searching the sentence for the name finds it in one sentence and nowhere
 * else, and a page that cannot point at a subject the reader found says no
 * subject was found, which is false.
 *
 * The reading already records what each sentence called it. This is that
 * record being used.
 */
const LIST = [
  "My tasks come back in a sensible order — what is due soonest first.",
  "A task that is past its due date is obvious at a glance.",
  "Finished tasks stop crowding the ones I still have to do.",
  "I can look at just the high priority ones when I want to.",
];
const MERGED = [
  {
    name: "my tasks",
    claims: [
      { text: "ordered", from: 1, quote: LIST[0], mention: "My tasks" },
      { text: "late ones obvious", from: 2, quote: LIST[1], mention: "A task that is past its due date" },
      { text: "finished out of the way", from: 3, quote: LIST[2], mention: "Finished tasks" },
      { text: "narrowed to important", from: 4, quote: LIST[3], mention: "the high priority ones" },
    ],
  },
];

test("each sentence marks the subject in the words that sentence used for it", () => {
  const said = LIST.map((t, i) =>
    markSentence(t, MERGED, i + 1)
      .parts.flatMap((p) => p.pieces)
      .filter((p) => p.subject !== undefined)
      .map((p) => p.text),
  );
  assert.deepEqual(said, [
    ["My tasks"],
    ["A task that is past its due date"],
    ["Finished tasks"],
    ["the high priority ones"],
  ]);
});

test("without what the sentence called it, three of the four cannot be pointed at", () => {
  // The behaviour before: the name is searched for and found only where the
  // name happens to be the wording. This is why merging could not ship alone.
  const nameOnly = [{ ...MERGED[0], claims: MERGED[0].claims.map(({ mention: _m, ...c }) => c) }];
  const found = LIST.map(
    (t, i) => markSentence(t, nameOnly, i + 1).parts.flatMap((p) => p.pieces).filter((p) => p.subject !== undefined).length,
  );
  assert.deepEqual(found, [1, 0, 0, 0]);
});

test("a pronoun is never drawn as the subject — it names nothing", () => {
  const marked = markSentence("If I try to save it, it tells me.", [
    { name: "the new-task box", claims: [{ text: "says so", from: 1, quote: "If I try to save it, it tells me.", mention: "it" }] },
  ], 1);
  assert.equal(marked.parts.flatMap((p) => p.pieces).filter((p) => p.subject !== undefined).length, 0);
  assert.ok(marked.parts.some((p) => p.kind === "claim" && p.writeIn), "the subject is written in instead");
});
