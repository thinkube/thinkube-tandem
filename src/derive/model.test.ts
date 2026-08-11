/**
 * The model round's pure parts: the prompt carries every sentence numbered
 * and demands the writer's own nouns; the parse is strict — a claim without
 * a sentence number drops, a subject without claims drops, junk yields
 * nothing; and any sentence the round failed to place is reported rather
 * than silently lost.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildModelPrompt, parseModel, unaccountedFor } from "./model";

const SENTENCES = [
  "the delivery page must show me how to experience it",
  "documentation must be required for every cut",
  "proof labels must name the check in my own words",
];

test("the prompt numbers every sentence and asks for the writer's own nouns", () => {
  const p = buildModelPrompt(SENTENCES);
  SENTENCES.forEach((s, i) => assert.ok(p.includes(`${i + 1}. ${s}`), `sentence ${i + 1} rides the prompt`));
  for (const demand of [
    "SUBJECT",
    "CLAIM",
    "writer's own words",
    "Never drop a sentence",
    "OF WHAT?",
    "never the place a gesture lives",
    // A fault reported is not a claim: read as one it would order the
    // machine to build the bug, and it could never come true.
    "WHAT MUST BECOME TRUE — never what is wrong today",
    "the fault being reported",
    // Two claims that cannot both hold are settled by which was written
    // later — no supersession to record, only the order already there.
    "a later one wins",
    // The words each claim was read from, so the sentence can be shown
    // back with the reading drawn on it.
    "copied EXACTLY",
  ])
    assert.ok(p.includes(demand), `the prompt demands: ${demand}`);
});

test("parse: valid subjects land; junk and out-of-range numbers drop", () => {
  const raw =
    'here you go:\n{"subjects":[' +
    '{"name":"the delivery page","from":[1],"claims":[{"text":"shows how to experience it","why":"so I accept by experiencing","from":1}]},' +
    '{"name":"a ghost","from":[9],"claims":[{"text":"nothing","from":9}]},' +
    '{"name":"no claims","from":[2],"claims":[]}]}';
  const m = parseModel(raw, SENTENCES.length)!;
  assert.equal(m.subjects.length, 1, "the ghost (sentence 9 of 3) and the claimless subject drop");
  assert.equal(m.subjects[0].claims[0].why, "so I accept by experiencing", "the purpose survives");
});

test("parse: nothing usable yields undefined rather than an empty model", () => {
  assert.equal(parseModel(null, 3), undefined);
  assert.equal(parseModel("no json here", 3), undefined);
  assert.equal(parseModel('{"subjects":[]}', 3), undefined);
});

test("a sentence the round placed nowhere is reported, never lost", () => {
  const m = parseModel(
    '{"subjects":[{"name":"the delivery page","from":[1,3],"claims":[' +
      '{"text":"x","from":1},{"text":"y","from":3}]}]}',
    3,
  )!;
  assert.deepEqual(unaccountedFor(m, 3), [2], "sentence 2 became no claim of any subject");
  assert.deepEqual(unaccountedFor(m, 1), [], "nothing missing when every sentence landed");
});
