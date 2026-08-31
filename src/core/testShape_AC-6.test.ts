/**
 * INVARIANT — a blinded coder must never read held-out evidence:
 * refusedToolUse refuses a Read of a test-shaped path when the worker is
 * blind, whatever role the target's directory shape falls under.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { refusedToolUse } from "../run/worker";

test("refusedToolUse refuses a blinded coder's Read of a test-shaped path", () => {
  const reason = refusedToolUse(
    { role: "code", blind: true },
    "Read",
    "src/services/__tests__/foo.test.ts",
  );

  assert.ok(reason, "the read is refused for a blinded coder against a test-shaped path");
});
