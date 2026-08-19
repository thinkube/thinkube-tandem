import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPreparePrompt, deriveSetup, parseSetup, NO_SETUP } from "./prepare";

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
    runOne: "",
  });
  assert.deepEqual(parseSetup("PROVISION: NONE\nPREPARE: `make build-tests`"), {
    provision: "",
    prepare: "make build-tests",
    runOne: "",
  });
  assert.deepEqual(
    parseSetup("Looking at the manifests...\nPROVISION: pip install -e .[test]\nPREPARE: none."),
    { provision: "pip install -e .[test]", prepare: "", runOne: "" },
    "preamble tolerated, the labeled lines are the answer",
  );
  assert.equal(parseSetup(null), undefined, "no text is no answer — the caller keeps what it had");
  assert.equal(parseSetup("npx tsc -p tsconfig.test.json"), undefined, "an unlabeled line is not an answer");
  assert.deepEqual(parseSetup("PREPARE: " + "x".repeat(300)), NO_SETUP, "an essay is not a command");
});

test("a derivation holds to the earlier answer, and a failed answer is corrected from the failure's words", async () => {
  const anchored = buildPreparePrompt("/repo", "", "", {
    previous: { provision: "npm ci && npm ci --prefix webview/map", prepare: "npx tsc -p tsconfig.test.json", runOne: "" },
  });
  assert.ok(anchored.includes("EARLIER READING") && anchored.includes("npm ci --prefix webview/map"), "the earlier answer anchors");
  assert.ok(/nested/i.test(anchored), "nested manifests are asked about, not assumed away");
  const prompts: string[] = [];
  const again = await deriveSetup(
    { repoRoot: "/repo", model: "m" } as never,
    async (_d, prompt) => {
      prompts.push(prompt);
      return "PROVISION: npm ci && npm ci --prefix webview/map\nPREPARE: npx tsc -p tsconfig.test.json";
    },
    "",
    "",
    { failed: { setup: { provision: "npm ci", prepare: "npx tsc -p tsconfig.test.json", runOne: "" }, evidence: "error TS2503: Cannot find namespace 'React'" } },
  );
  assert.ok(prompts[0].includes("TRIED ON A FRESH CHECKOUT AND FAILED") && prompts[0].includes("Cannot find namespace 'React'"), "the failure is the evidence");
  assert.equal(again?.provision, "npm ci && npm ci --prefix webview/map");
});

test("the third setup fact: how ONE of the repository's own tests runs — with its placeholder, or nothing", () => {
  const s = parseSetup("PROVISION: npm ci\nPREPARE: npx tsc -p tsconfig.test.json\nRUNONE: node --test $(echo <file> | sed 's#^src/#out-test/#; s#\\.ts$#.js#')");
  assert.ok(s?.runOne.includes("<file>") && s.runOne.startsWith("node --test"));
  assert.equal(parseSetup("PROVISION: NONE\nPREPARE: NONE\nRUNONE: NONE")?.runOne, "");
  assert.equal(parseSetup("RUNONE: npm test")?.runOne, "", "a command that cannot name the file runs nothing in particular");
  assert.ok(/RUNONE/.test(buildPreparePrompt("/repo", "", "", {})), "the question is asked");
});
