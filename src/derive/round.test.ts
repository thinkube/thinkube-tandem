/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A round's listener hears every event its stream yields — partial
 * messages included — and hears it end, whether it ends well or not.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { collectText } from "./round";

function listener(): { heard: number; ended: number; pulse: () => { heard: () => void; ended: () => void } } {
  const l = {
    heard: 0,
    ended: 0,
    pulse: () => ({ heard: () => void l.heard++, ended: () => void l.ended++ }),
  };
  return l;
}

test("every event of a round's stream is heard, and its end", async () => {
  const l = listener();
  const text = await collectText(
    async function* () {
      yield { type: "stream_event", event: { type: "content_block_delta" } };
      yield { type: "stream_event", event: { type: "content_block_delta" } };
      yield { type: "assistant", message: { content: [{ type: "text", text: "done" }] } };
      yield { type: "result", result: "done" };
    },
    undefined,
    l.pulse,
  );
  assert.equal(text, "done");
  assert.equal(l.heard, 4, "partial messages count as movement");
  assert.equal(l.ended, 1);
});

test("a round that fails is still heard to end", async () => {
  const l = listener();
  const said: string[] = [];
  const text = await collectText(
    async function* () {
      yield { type: "stream_event", event: { type: "content_block_delta" } };
      throw new Error("connection reset");
    },
    (line) => said.push(line),
    l.pulse,
  );
  assert.equal(text, null);
  assert.equal(l.heard, 1);
  assert.equal(l.ended, 1);
  assert.ok(said.includes("round errored: connection reset"));
});
