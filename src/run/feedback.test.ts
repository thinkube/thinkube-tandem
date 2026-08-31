/**
 * A finding lands where a new ask is written, already written.
 *
 * The cost that made errors expensive was never the fixing. It was that
 * seeing the delivered thing and wanting it changed meant the whole way
 * round again — writing every sentence a second time, from memory, hours
 * after noticing. These rules exist so that carrying a finding forward
 * costs one press, and disagreeing with one costs deleting a line.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { draftWithFindings } from "./feedback";

const F = (said: string, ask: string) => ({ said, where: `https://todo.example · ${ask}` });

test("a finding arrives as a sentence carrying the ask it came from", () => {
  const draft = draftWithFindings("", [F("the asks section is one centimetre high", "the asks section is readable")]);
  assert.equal(
    draft,
    "the asks section is one centimetre high (seen after asking: the asks section is readable)",
  );
});

test("what someone was writing is never lost to a deploy that settled mid-sentence", () => {
  const draft = draftWithFindings("I want the tab row to stay put", [F("cards have no words on them", "cards are labelled")]);
  assert.equal(
    draft,
    "I want the tab row to stay put\ncards have no words on them (seen after asking: cards are labelled)",
  );
});

test("a second look does not write the same complaint twice", () => {
  const once = draftWithFindings("", [F("still one centimetre high", "the asks section is readable")]);
  assert.equal(draftWithFindings(once, [F("still one centimetre high", "the asks section is readable")]), once,
    "a deploy that did not fix it repeats itself; the page must not grow instead of the truth");
});

test("two workers finding the same thing write it once", () => {
  const draft = draftWithFindings("", [
    F("nothing can be pressed", "one place to answer a worker"),
    F("nothing can be pressed", "one place to answer a worker"),
  ]);
  assert.equal(draft.split("\n").length, 1);
});

test("nothing found leaves the page exactly as it was", () => {
  assert.equal(draftWithFindings("half a sentence", []), "half a sentence");
  assert.equal(draftWithFindings("", []), "");
});

test("a finding with no ask behind it is still a sentence, not a fragment", () => {
  assert.equal(
    draftWithFindings("", [{ said: "it could not be opened at all", where: "https://todo.example" }]),
    "it could not be opened at all",
  );
});
