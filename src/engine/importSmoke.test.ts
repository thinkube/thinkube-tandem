/**
 * Import smoke test for the engine modules `ENGINE-WIRING.md` lists as
 * having no product caller today. Nothing in `src/extension.ts`'s reach
 * imports these, so the whole-project build alone would not notice a
 * module that no longer even parses or resolves its own imports.
 *
 * This file does not claim on its own whether or when a caller is coming
 * for any of them — that verdict (`wire`, `retire` or `fold`) and the
 * reasoning behind it live in `ENGINE-WIRING.md`, kept complete against
 * the real tree by `src/gates/engineWiring.test.ts`. This test only proves
 * each listed module still imports cleanly, so an unwired module can go
 * stale in its own file without going stale in its imports too.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

test("every module ENGINE-WIRING.md lists still imports cleanly", async () => {
  const modules = [
    () => import("./acSignature"),
    () => import("./concurrencyLock"),
    () => import("./auditorRunner"),
    () => import("./dispatchGuard"),
    () => import("./openingGate"),
    () => import("./methodology/specChange"),
    () => import("./provisioningLeak"),
    () => import("./retiredSymbolFootprint"),
    () => import("./verificationRunnable"),
    () => import("./specApprovalHash"),
    () => import("./shipFresh"),
    () => import("./testImpactFootprint"),
  ];
  for (const load of modules) {
    await assert.doesNotReject(load, "an unwired engine module must still import without error");
  }
});
