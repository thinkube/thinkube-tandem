/**
 * Board-artifact hygiene (2026-07-11): a slice card states its CURRENT state.
 * Attention diagnoses REPLACE (prior ones collapse to `attention_history`);
 * returning to Ready prunes the resolved block + ⛔ markers automatically —
 * one live card had THREE stacked ⚑ blocks and a human as garbage collector.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  splitAttentionArtifacts,
  attentionHistoryEntry,
} from "./sliceLifecycle";

const BODY_WITH_TWO_BLOCKS = `# powered_by attribution end-to-end

Threads a nullable powered_by field through the stack.

## ⚑ Requires attention

Closing gate: AC #5 (verification red). Judged fault: test — bare tsc exits 127.

Failing evidence:
$ tsc --noEmit → exit 127

## ⚑ Requires attention

Closing gate: AC #2, #5. Judged fault: code — the template was never updated.

⛔ ESCALATED — bounded rework attempts exhausted`;

test("splitAttentionArtifacts extracts every ⚑ block and returns the clean base", () => {
  const { base, blocks } = splitAttentionArtifacts(BODY_WITH_TWO_BLOCKS);
  assert.equal(blocks.length, 2);
  assert.match(blocks[0], /bare tsc exits 127/);
  assert.match(blocks[1], /template was never updated/);
  assert.match(base, /# powered_by attribution/);
  assert.match(base, /Threads a nullable/);
  assert.doesNotMatch(base, /Requires attention/);
  assert.doesNotMatch(base, /⛔/);
});

test("a block ends at the next section heading, which stays in the base", () => {
  const body = `# t\n\n## ⚑ Requires attention\n\ndiag\n\n## Design\n\nkeep me`;
  const { base, blocks } = splitAttentionArtifacts(body);
  assert.deepEqual(blocks, ["diag"]);
  assert.match(base, /## Design/);
  assert.match(base, /keep me/);
});

test("a clean body passes through unchanged with no blocks (idempotent)", () => {
  const body = "# title\n\nplain prose";
  const { base, blocks } = splitAttentionArtifacts(body);
  assert.equal(base, body);
  assert.deepEqual(blocks, []);
  assert.deepEqual(splitAttentionArtifacts(base).blocks, []);
});

test("attentionHistoryEntry is one dated, clipped line from the block's first prose", () => {
  const e = attentionHistoryEntry(
    "Closing gate: AC #5 red. Judged fault: test — bare tsc.\n\nmore detail",
    "2026-07-11",
  );
  assert.equal(e, "2026-07-11: Closing gate: AC #5 red. Judged fault: test — bare tsc.");
  const long = attentionHistoryEntry("x".repeat(200), "2026-07-11");
  assert.ok(long.length <= 12 + 2 + 141);
  assert.match(long, /…$/);
});
