/**
 * SP-6/12 (TEP-6) AC2 — a code-author worker's prompt forbids editing any file OUTSIDE its
 * declared footprint, and names shared build/config (e.g. `tsconfig*.json`) as off-limits.
 *
 * Why this matters (the defect this closes): a code-author worker self-verifies by running
 * tests, but in this repo test files compile via `tsconfig.test.json` → `out-test/` first — a
 * command the worker was never told. So eu-0 IMPROVISED: it tried to overwrite the shared
 * `tsconfig.test.json` (outside its footprint), the footprint guard hard-aborted and reverted
 * the unit, and the whole run halted at `requires-attention`. The guard is right to be strict;
 * the fix is to state the prohibition UP FRONT in the one artifact the worker reads — its
 * prompt — so it never reaches for a shared build/config file to make tests run.
 *
 * Verified PURELY against the SP-6/12 SPEC CONTRACT — the exported, vscode-free
 * `buildWorkerPrompt(unit, specNumber, context?)` in `src/services/orchestratorCore.ts`, the
 * established substring-assertion pattern for this seam. Render rule (2) of the contract:
 *
 *   FOOTPRINT PROHIBITION — UNCONDITIONAL (for CODE units). Contains the exact tokens
 *   "footprint" AND "tsconfig".
 *
 * The distinctive, new observable token is **`tsconfig`** — the shared build/config file the
 * prohibition must name (the bare word "footprint" already appears in the prompt for scoping,
 * so this test leans on `tsconfig` as the load-bearing signal that the prohibition is present).
 * Because the rule is UNCONDITIONAL, these tests prove the token renders regardless of whether
 * a self-verify command is supplied in `context` — and that a TEST unit renders NONE of it
 * (the contract's "test units render NONE of these").
 *
 * The test CONSUMES the `buildWorkerPrompt` contract only (public interface) — it makes no
 * assumption about the internal wording of the prohibition beyond the pinned observable tokens.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildWorkerPrompt,
  type SchedUnit,
} from "../services/orchestratorCore";

// A plain CODE execution unit (role absent ⇒ `code`, backward-compatible). Its footprint is a
// single source file it OWNS — everything else, shared build/config included, is off-limits.
function codeUnit(overrides: Partial<SchedUnit> = {}): SchedUnit {
  return {
    id: "SP-6_SL-1#eu-0",
    slice: "SP-6_SL-1",
    footprint: ["src/services/orchestratorCore.ts"],
    requires: [],
    shape: "serial",
    note: "wire the self-verify command into the worker prompt",
    ...overrides,
  };
}

test("AC2: a code unit's prompt names the footprint and forbids editing shared build/config (the `tsconfig` token appears)", () => {
  const p = buildWorkerPrompt(codeUnit(), "6");

  // The prohibition speaks of the unit's FOOTPRINT as the write boundary...
  assert.ok(
    p.includes("footprint"),
    "the prompt must speak in terms of the unit's declared footprint",
  );
  // ...and NAMES a shared build/config file as off-limits — the load-bearing new token that
  // proves the prohibition renders (a shared `tsconfig*.json` is exactly what eu-0 improvised on).
  assert.ok(
    p.includes("tsconfig"),
    "the footprint prohibition must name shared build/config (the `tsconfig` token) as off-limits",
  );
});

test("AC2: the footprint prohibition is UNCONDITIONAL — the `tsconfig` token renders whether or not a self-verify command is supplied", () => {
  // Absent selfVerifyCommand (the omit-cleanly path): the VERIFICATION BLOCK is gone, but the
  // footprint prohibition still stands.
  const withoutVerify = buildWorkerPrompt(codeUnit(), "6", {
    specBody:
      "## Design\n\nRender the self-verify block and standing prohibitions.",
    sliceBody: "Wire the declared verify command through to the worker prompt.",
  });
  assert.ok(
    withoutVerify.includes("tsconfig"),
    "footprint prohibition (tsconfig) must render even when no self-verify command is present",
  );
  assert.ok(withoutVerify.includes("footprint"));

  // Present selfVerifyCommand: the prohibition still renders alongside the verification block.
  const withVerify = buildWorkerPrompt(codeUnit(), "6", {
    selfVerifyCommand:
      "npx tsc -p tsconfig.test.json && node --test out-test/**/*.test.js",
  });
  assert.ok(
    withVerify.includes("tsconfig"),
    "footprint prohibition (tsconfig) must render alongside the verification block",
  );
  assert.ok(withVerify.includes("footprint"));
});

test("AC2: the prohibition targets an out-of-footprint SHARED file (tsconfig is not merely the unit's own footprint echo)", () => {
  // Prove `tsconfig` is a genuine prohibition token, not an artifact of a tsconfig-shaped
  // footprint: this unit's footprint contains NO tsconfig path, yet the token still appears —
  // it can only come from the standing prohibition naming shared build/config.
  const unit = codeUnit({ footprint: ["src/services/OrchestratorService.ts"] });
  const p = buildWorkerPrompt(unit, "6");
  assert.ok(
    !unit.footprint.some((f) => f.includes("tsconfig")),
    "precondition: the unit's own footprint contains no tsconfig file",
  );
  assert.ok(
    p.includes("tsconfig"),
    "the `tsconfig` token must originate from the shared-build/config prohibition, not the footprint list",
  );
});

test("AC2: a TEST unit renders NONE of the code-unit prohibitions (no `tsconfig` token)", () => {
  // The contract: for a `test` unit ((unit.role ?? 'code') === 'test') the verification block
  // AND both standing prohibitions are omitted entirely — the held-out verifier's prompt must
  // not carry the code-author's footprint/build guidance.
  const testUnit = codeUnit({
    id: "SP-6_SL-1#eu-1",
    footprint: ["src/acceptance/SP-6_12_AC-2.test.ts"],
    role: "test",
    note: "assert the standing prohibition names shared build config",
  });
  const p = buildWorkerPrompt(testUnit, "6", {
    selfVerifyCommand:
      "npx tsc -p tsconfig.test.json && node --test out-test/**/*.test.js",
  });
  assert.ok(
    !p.includes("tsconfig"),
    "a test unit's prompt must not render the code-unit shared-build/config prohibition (no `tsconfig`)",
  );
});
