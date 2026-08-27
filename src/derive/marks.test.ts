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
