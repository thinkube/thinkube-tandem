/**
 * Rule scope: the prompt asks a plain question per (rule, subject) pair and
 * the parse keeps only real answers — a broken reply governs nothing rather
 * than governing everything.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildScopePrompt, parseScope } from "./scope";

const PAIRS = [
  { ruleId: "r1", ruleText: "labels are in my words", scope: "every page you read", subjectId: "s1", subjectName: "the delivery page" },
  { ruleId: "r1", ruleText: "labels are in my words", scope: "every page you read", subjectId: "s2", subjectName: "the worker brief" },
];

test("the prompt asks one plain question per pair, naming the scope", () => {
  const p = buildScopePrompt(PAIRS);
  assert.ok(p.includes('"labels are in my words"'), "the rule rides verbatim");
  assert.ok(p.includes("every page you read"), "so does its scope");
  assert.ok(p.includes('"the delivery page"') && p.includes('"the worker brief"'), "every subject is asked about");
  assert.ok(p.includes("do not stretch a scope"), "the round is told not to over-reach");
});

test("parse: only real numbers count; junk governs nothing", () => {
  assert.deepEqual([...parseScope('{"governs":[1]}', 2)], [1]);
  assert.deepEqual([...parseScope('{"governs":[1,2,9,"x"]}', 2)], [1, 2], "out-of-range and non-numbers drop");
  assert.deepEqual([...parseScope("not json", 2)], [], "a broken reply governs nothing");
  assert.deepEqual([...parseScope(null, 2)], [], "no reply governs nothing");
});
