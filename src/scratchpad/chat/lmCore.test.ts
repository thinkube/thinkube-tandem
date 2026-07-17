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

// ── Transcript store (2026-07-17: empty-reopen root cause) ───────────────────

test("transcript parses tolerantly, keeps order, caps at limit", async () => {
  const { parseTranscript } = await import("./transcript");
  const raw = [
    JSON.stringify({ role: "user", text: "first ask", ts: "t1" }),
    "GARBAGE LINE {not json",
    JSON.stringify({ role: "assistant", text: "first reply", ts: "t2" }),
    JSON.stringify({ role: "bogus", text: "dropped" }),
    JSON.stringify({ role: "user", text: "  " }),
  ].join("\n");
  const turns = parseTranscript(raw);
  assert.deepEqual(
    turns.map((t) => [t.role, t.text]),
    [
      ["user", "first ask"],
      ["assistant", "first reply"],
    ],
  );
  const many = Array.from({ length: 300 }, (_, i) =>
    JSON.stringify({ role: "user", text: `t${i}` }),
  ).join("\n");
  assert.equal(parseTranscript(many, 200).length, 200);
});

test("transcript path lives in the space's sidecar", async () => {
  const { transcriptPath } = await import("./transcript");
  assert.equal(
    transcriptPath("/root", "Platform/projects/x", "tt2"),
    "/root/Platform/projects/x/thinking/.chat/tt2.jsonl",
  );
});
