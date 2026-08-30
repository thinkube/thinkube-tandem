/**
 * INVARIANT — a coder must never write a test: refusedToolUse refuses a
 * coder's Write to a path under a `__tests__/` directory, and says so in
 * words naming tests as the tester's, whichever tool named the write.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { refusedToolUse } from "../run/worker";

test("refusedToolUse refuses a coder's Write under a __tests__ directory", () => {
  const reason = refusedToolUse(
    { role: "code" },
    "Write",
    "src/services/__tests__/foo.test.ts",
  );

  assert.ok(reason, "the write is refused");
  assert.match(reason ?? "", /tester/i, "the reason says tests are the tester's");
});
