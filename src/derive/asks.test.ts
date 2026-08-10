import { test } from "node:test";
import assert from "node:assert/strict";
import { askOfLine, asksOfText } from "./asks";

const words = (t: string): string[] => asksOfText(t).map((a) => a.text);

test("one line is one ask", () => {
  assert.deepEqual(words("make the report legible"), ["make the report legible"]);
  assert.deepEqual(words("first thing\nsecond thing\nthird thing"), [
    "first thing",
    "second thing",
    "third thing",
  ]);
});

test("blank lines separate nothing and become nothing", () => {
  assert.deepEqual(words("\n\nfirst\n\n\nsecond\n\n"), ["first", "second"]);
  assert.deepEqual(words("   \n\t\n"), [], "whitespace alone is not an ask");
});

test("markers are stripped, whatever they are", () => {
  assert.deepEqual(words("- one\n* two\n• three\n4. four\n5) five"), [
    "one",
    "two",
    "three",
    "four",
    "five",
  ]);
});

test("a wrapped bullet is not a new ask", () => {
  // Copied out of a document: item two arrives across two lines.
  const pasted = "- keep the report legible\n- the brief must not embed\n  the same text twice\n- open each space in its own tab";
  assert.deepEqual(words(pasted), [
    "keep the report legible",
    "the brief must not embed the same text twice",
    "open each space in its own tab",
  ]);
});

test("without markers, every line stands alone — people also write lists without bullets", () => {
  assert.deepEqual(words("keep it legible\nand fast"), ["keep it legible", "and fast"]);
});

test("a single marked line is a line, not a list — nothing folds into it", () => {
  assert.deepEqual(words("- just one thing\nand a second"), ["just one thing", "and a second"]);
});

test("the map says which ask owns each line, and 0 where none does", () => {
  //          0            1           2                 3
  const text = "- first\n- second\n  wrapped\n\n- third";
  assert.deepEqual(askOfLine(text), [1, 2, 2, 0, 3]);
});
