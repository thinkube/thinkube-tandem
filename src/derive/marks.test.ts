import { test } from "node:test";
import assert from "node:assert/strict";
import { markSentence, ReadSubject } from "./marks";

/** The marked sentence as text, so a wrong mark is readable in a failure:
 *  «subject named»  [claim]^n  {subject written in}. */
function shown(text: string, subjects: ReadSubject[], n: number): string {
  const m = markSentence(text, subjects, n);
  return m.parts
    .map((p) => {
      const body = p.pieces
        .map((x) => (x.subject !== undefined ? `«${x.text}»` : x.text))
        .join("");
      return p.kind === "claim"
        ? `[${body}${p.writeIn ? ` {${subjects[p.subject].name}}` : ""}]^${p.subject + 1}`
        : body;
    })
    .join("");
}

// The reading this product produced from the round-1 asks, verbatim.
const DOCS = "Documentation must be required by default for every cut. When it is truly not needed I want to say so explicitly, with a reason, on the cut review page — and that reason must be recorded inside the TEP.";
const docs: ReadSubject[] = [
  {
    name: "documentation",
    claims: [
      { text: "must be required by default for every cut", from: 1, quote: "Documentation must be required by default for every cut." },
      { text: "when truly not needed, must be said so explicitly", from: 1, quote: "When it is truly not needed I want to say so explicitly, with a reason, on the cut review page", mention: "it" },
      { text: "that reason must be recorded inside the TEP", from: 1, quote: "that reason must be recorded inside the TEP" },
    ],
  },
];

test("every claim is its own run, and the words between them stay plain", () => {
  assert.equal(
    shown(DOCS, docs, 1),
    "[«Documentation» must be required by default for every cut.]^1 " +
      "[When it is truly not needed I want to say so explicitly, with a reason, on the cut review page]^1" +
      " — and [that reason must be recorded inside the TEP]^1.",
  );
});

test("a subject named inside a claim is marked inside it, not instead of it", () => {
  const m = markSentence(DOCS, docs, 1);
  const first = m.parts[0];
  assert.equal(first.kind, "claim", "the claim is the outer range");
  assert.deepEqual(
    first.pieces.map((p) => [p.text, p.subject]),
    [
      ["Documentation", 0],
      [" must be required by default for every cut.", undefined],
    ],
    "and the subject's own name is a piece within it",
  );
});

test("a sentence that names its subject never has it written in — whatever the round says", () => {
  // The round returned mention:"it" for the second claim. It is right that
  // "it" refers to documentation, and wrong to write the subject in over a
  // sentence whose FIRST WORD is that subject.
  const m = markSentence(DOCS, docs, 1);
  assert.ok(
    m.parts.every((p) => p.kind !== "claim" || !p.writeIn),
    "the words decide, not the reading's opinion of them",
  );
});

test("a sentence that never names its subject has it written in once", () => {
  const subjects: ReadSubject[] = [
    {
      name: "the worker brief",
      claims: [
        { text: "embeds the TEP text twice", from: 1, quote: "embeds the same TEP text twice under two headings" },
        { text: "it must appear exactly once", from: 1, quote: "it must appear exactly once", mention: "it" },
      ],
    },
  ];
  const text = "The brief a worker receives embeds the same TEP text twice under two headings; it must appear exactly once.";
  const out = shown(text, subjects, 1);
  assert.match(out, /\{the worker brief\}/, "the subject is written in");
  assert.equal(out.match(/\{the worker brief\}/g)!.length, 1, "once, not once per claim");
});

test("a quote that is not in the sentence is not placed at all", () => {
  const subjects: ReadSubject[] = [
    { name: "the report", claims: [{ text: "reads as sections", from: 1, quote: "reads in sections" }] },
  ];
  assert.equal(shown("The report reads as sections.", subjects, 1), "«The report» reads as sections.");
});

test("two claims over the same words keep the first and drop the second", () => {
  const subjects: ReadSubject[] = [
    {
      name: "the page",
      claims: [
        { text: "a", from: 1, quote: "shows how to see it" },
        { text: "b", from: 1, quote: "how to see" },
      ],
    },
  ];
  assert.equal(shown("The page shows how to see it.", subjects, 1), "«The page» [shows how to see it]^1.");
});

test("claims of another sentence are not drawn on this one", () => {
  const subjects: ReadSubject[] = [
    { name: "the page", claims: [{ text: "x", from: 2, quote: "The page" }] },
  ];
  assert.equal(shown("The page shows it.", subjects, 1), "«The page» shows it.");
});
