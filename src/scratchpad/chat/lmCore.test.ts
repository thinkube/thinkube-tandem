/**
 * Tests for the Thinkube LM provider core (2026-07-17): message flattening,
 * model alias mapping, token estimate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  aliasForModelId,
  estimateTokens,
  messagesToPrompt,
  THINKY_LM_MODELS,
} from "./lmCore";

test("model ids map to Claude Code CLI aliases, unknown falls back to sonnet", () => {
  assert.equal(aliasForModelId("thinkube-claude-opus"), "opus");
  assert.equal(aliasForModelId("thinkube-claude-haiku"), "haiku");
  assert.equal(aliasForModelId("something-else"), "sonnet");
  assert.equal(THINKY_LM_MODELS.length, 3);
});

test("messages flatten with role tags, system first, trailing Assistant:", () => {
  const prompt = messagesToPrompt([
    { role: 0, content: "You are terse." },
    { role: 1, content: [{ value: "hello " }, { value: "there" }] },
    { role: 2, content: [{ value: "hi!" }] },
    { role: 1, content: "and now?" },
  ]);
  assert.ok(prompt.startsWith("You are terse.\n\n"));
  assert.ok(prompt.includes("User: hello there"));
  assert.ok(prompt.includes("Assistant: hi!"));
  assert.ok(prompt.includes("User: and now?"));
  assert.ok(prompt.endsWith("\n\nAssistant:"));
});

test("string roles and empty parts are handled", () => {
  const prompt = messagesToPrompt([
    { role: "assistant", content: "earlier answer" },
    { role: "user", content: [{ notValue: true }, { value: "" }] },
    { role: "user", content: "real question" },
  ]);
  assert.ok(prompt.includes("Assistant: earlier answer"));
  // The all-empty message contributes nothing.
  assert.equal(prompt.match(/User:/g)?.length, 1);
});

test("token estimate is chars/4 rounded up", () => {
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
  assert.equal(estimateTokens(""), 0);
});
