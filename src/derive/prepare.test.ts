import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPreparePrompt, parseSetup, NO_SETUP } from "./prepare";

test("the check-setup questions are asked of the repository, never of a technology list", () => {
  const prompt = buildPreparePrompt("/repo", "NODE a [src=src/a.py loc=L1]", "reading");
  assert.ok(prompt.includes("/repo"));
  assert.ok(prompt.includes("NODE a"), "the map grounds the answer");
  assert.ok(prompt.includes("reading"), "so does the established reading");
  assert.ok(prompt.includes("PROVISION") && prompt.includes("PREPARE"), "both facts are asked");
  assert.ok(
    !/typescript|tsc|npm|maven|cargo|pytest/i.test(prompt),
    "no technology is named — the repository answers, not a preset list",
  );
});

test("the parser accepts one command per fact or nothing — it never invents a step", () => {
  assert.deepEqual(parseSetup("PROVISION: npm ci\nPREPARE: npx tsc -p tsconfig.test.json"), {
    provision: "npm ci",
    prepare: "npx tsc -p tsconfig.test.json",
  });
  assert.deepEqual(parseSetup("PROVISION: NONE\nPREPARE: `make build-tests`"), {
    provision: "",
    prepare: "make build-tests",
  });
  assert.deepEqual(
    parseSetup("Looking at the manifests...\nPROVISION: pip install -e .[test]\nPREPARE: none."),
    { provision: "pip install -e .[test]", prepare: "" },
    "preamble tolerated, the labeled lines are the answer",
  );
  assert.deepEqual(parseSetup(null), NO_SETUP);
  assert.deepEqual(parseSetup("npx tsc -p tsconfig.test.json"), NO_SETUP, "an unlabeled line is not an answer");
  assert.deepEqual(parseSetup("PREPARE: " + "x".repeat(300)), NO_SETUP, "an essay is not a command");
});
