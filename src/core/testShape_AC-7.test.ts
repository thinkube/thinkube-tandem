/**
 * INVARIANT — blinding is about held-out evidence only: refusedToolUse
 * allows a blinded coder's Read of a production path, since a coder that
 * cannot see its own tests must still be able to read the code it is
 * building.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { refusedToolUse } from "../run/worker";

test("refusedToolUse allows a blinded coder's Read of a production path", () => {
  const reason = refusedToolUse(
    { role: "code", blind: true },
    "Read",
    "src/services/foo.ts",
  );

  assert.equal(reason, undefined, "a production path is not held-out evidence, so the read is allowed");
});
