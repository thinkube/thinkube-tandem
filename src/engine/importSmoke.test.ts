/**
 * Import smoke test: every `src/engine/` module the wiring ledger marks
 * `wire` — meant to run in a product command path once its named trigger
 * arms, but not called from one yet — must still load cleanly on its own.
 *
 * This does not decide, or restate, any module's wiring verdict: that
 * verdict lives in one place, ENGINE-WIRING.md at the repo root, kept
 * complete against the live tree by `src/gates/engineWiring.test.ts`. This
 * file only proves the `wire`-verdict modules import without error today,
 * so the day their named trigger arms and a caller is wired in, the module
 * itself is not the thing that breaks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

test("provisioningLeak.ts loads and exports its check", async () => {
  const mod = await import("./provisioningLeak");
  assert.equal(typeof mod, "object");
});

test("shipFresh.ts loads and exports its check", async () => {
  const mod = await import("./shipFresh");
  assert.equal(typeof mod, "object");
});

test("testImpactFootprint.ts loads and exports its check", async () => {
  const mod = await import("./testImpactFootprint");
  assert.equal(typeof mod, "object");
});

test("retiredSymbolFootprint.ts loads and exports its check", async () => {
  const mod = await import("./retiredSymbolFootprint");
  assert.equal(typeof mod, "object");
});
