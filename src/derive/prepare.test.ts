import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPreparePrompt, parsePrepare } from "./prepare";

test("the check-setup question is asked of the repository, never of a technology list", () => {
  const prompt = buildPreparePrompt("/repo", "NODE a [src=src/a.py loc=L1]", "reading");
  assert.ok(prompt.includes("/repo"));
  assert.ok(prompt.includes("NODE a"), "the map grounds the answer");
  assert.ok(prompt.includes("reading"), "so does the established reading");
  assert.ok(
    !/typescript|tsc|npm|maven|cargo|pytest/i.test(prompt),
    "no technology is named — the repository answers, not a preset list",
  );
});

test("the parser accepts one command or nothing — it never invents a build step", () => {
  assert.equal(parsePrepare("npx tsc -p tsconfig.test.json"), "npx tsc -p tsconfig.test.json");
  assert.equal(parsePrepare("`make build-tests`"), "make build-tests");
  assert.equal(
    parsePrepare("Looking at the manifests...\nnpx tsc -p tsconfig.test.json"),
    "npx tsc -p tsconfig.test.json",
    "preamble tolerated, the command is the last line",
  );
  assert.equal(parsePrepare("NONE"), "");
  assert.equal(parsePrepare("none."), "");
  assert.equal(parsePrepare(null), "");
  assert.equal(parsePrepare("x".repeat(300)), "", "an essay is not a command");
});
