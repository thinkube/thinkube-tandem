/**
 * The run node spec on the shared core: LOD-aware texts (no text below the
 * legibility floor — far zoom drops the badge line), the run-state palette
 * as the one source, and elapsed time rendered humanly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { formatElapsed, runNodeSpec, RUN_STATE_COLOR } from "./runNode";

const CARD = { id: "SL-1:code", slice: "SL-1", role: "code", state: "running", elapsedMs: 192_000 };

test("near representation shows title and role·state·elapsed; far keeps only the title", () => {
  const near = runNodeSpec(CARD, "near");
  assert.equal(near[0].role, "title");
  assert.ok(near.some((t) => t.text.includes("code · running · 3m 12s")));
  const far = runNodeSpec(CARD, "far");
  assert.equal(far.length, 1, "below the floor the badge line disappears instead of shrinking");
});

test("a failed unit's state line carries the failure color from the one palette", () => {
  const spec = runNodeSpec({ ...CARD, state: "failed", elapsedMs: undefined }, "near");
  const badge = spec.find((t) => t.role === "badge")!;
  assert.equal(badge.color, RUN_STATE_COLOR.failed);
});

test("elapsed formats humanly across magnitudes", () => {
  assert.equal(formatElapsed(9_000), "9s");
  assert.equal(formatElapsed(192_000), "3m 12s");
  assert.equal(formatElapsed(4_920_000), "1h 22m");
});
