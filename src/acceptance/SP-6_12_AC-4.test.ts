/**
 * SP-6/12 (TEP-6) AC4 — when the repo declares NO self-verify command, a code-author worker's
 * prompt omits the verify-command guidance CLEANLY (no empty or dangling instruction), while the
 * footprint prohibition and the held-out `acceptance/` prohibition still render.
 *
 * Why this matters (the defect this closes): the verify-command block is rendered ONLY when a
 * command is supplied in `context` (a repo may declare none — the backward-compatible path). The
 * risk of a conditional block is a DANGLING label: the "SELF-VERIFY" marker rendering with no
 * command under it. AC4 pins the clean-omission behaviour: when no command is present, the whole
 * block AND its "SELF-VERIFY" marker vanish (a grep for the marker fails), yet the two STANDING
 * prohibitions — which are UNCONDITIONAL — keep rendering.
 *
 * Verified PURELY against the SP-6/12 SPEC CONTRACT — the exported, vscode-free
 * `buildWorkerPrompt(unit, specNumber, context?)` in `src/services/orchestratorCore.ts`, the
 * established substring-assertion pattern for this seam. The relevant render rules (CODE units):
 *
 *   1. VERIFICATION BLOCK — ONLY when context.selfVerifyCommand?.trim() is truthy; its header line
 *      contains the exact token "SELF-VERIFY".
 *   2. FOOTPRINT PROHIBITION — UNCONDITIONAL. Contains the exact tokens "footprint" AND "tsconfig".
 *   3. HELD-OUT PROHIBITION — UNCONDITIONAL. Contains ALL of "acceptance/", "closing gate", and
 *      "do not build or run".
 *   4. When context.selfVerifyCommand is absent/blank: the VERIFICATION BLOCK and the "SELF-VERIFY"
 *      token are omitted ENTIRELY; prohibitions (2) and (3) still render.
 *
 * The test CONSUMES the `buildWorkerPrompt` contract only (public interface) — it makes no
 * assumption about the internal wording beyond the pinned observable tokens.
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
    id: "SP-6_SL-1#eu-4",
    slice: "SP-6_SL-1",
    footprint: ["src/services/orchestratorCore.ts"],
    requires: [],
    shape: "serial",
    note: "wire the self-verify command into the worker prompt",
    ...overrides,
  };
}

test("AC4: with NO selfVerifyCommand, the SELF-VERIFY block and its marker are omitted entirely (a grep for the marker fails)", () => {
  // No `context` at all — the absent path.
  const p = buildWorkerPrompt(codeUnit(), "6");
  assert.ok(
    !p.includes("SELF-VERIFY"),
    "with no self-verify command the SELF-VERIFY marker must not render (no dangling label)",
  );

  // `context` present but WITHOUT selfVerifyCommand — same omission.
  const p2 = buildWorkerPrompt(codeUnit(), "6", {
    specBody:
      "## Design\n\nRender the self-verify block and standing prohibitions.",
    sliceBody: "Wire the declared verify command through to the worker prompt.",
  });
  assert.ok(
    !p2.includes("SELF-VERIFY"),
    "an omitted selfVerifyCommand must leave no SELF-VERIFY marker even when other context is present",
  );
});

test("AC4: a blank/whitespace selfVerifyCommand is treated as absent — the SELF-VERIFY block is still omitted", () => {
  // The contract omits the block unless context.selfVerifyCommand?.trim() is truthy.
  for (const blank of ["", "   ", "\n\t "]) {
    const p = buildWorkerPrompt(codeUnit(), "6", { selfVerifyCommand: blank });
    assert.ok(
      !p.includes("SELF-VERIFY"),
      `a blank/whitespace self-verify command (${JSON.stringify(blank)}) must render no SELF-VERIFY block`,
    );
  }
});

test("AC4: with NO selfVerifyCommand, the footprint prohibition still renders (footprint + tsconfig)", () => {
  const p = buildWorkerPrompt(codeUnit(), "6");
  assert.ok(
    p.includes("footprint"),
    "footprint prohibition must render regardless of the self-verify command",
  );
  assert.ok(
    p.includes("tsconfig"),
    "footprint prohibition must name shared build/config (`tsconfig`) even with no self-verify command",
  );
});

test("AC4: with NO selfVerifyCommand, the held-out acceptance/ prohibition still renders (acceptance/ + closing gate + do not build or run)", () => {
  const p = buildWorkerPrompt(codeUnit(), "6");
  assert.ok(
    p.includes("acceptance/"),
    "held-out prohibition must name the reserved `acceptance/` probe path",
  );
  assert.ok(
    p.includes("closing gate"),
    "held-out prohibition must name the closing gate as the grader",
  );
  assert.ok(
    p.includes("do not build or run"),
    "held-out prohibition must direct the worker not to build or run the acceptance/ probes",
  );
});

test("AC4: the omission is MEANINGFUL — supplying a selfVerifyCommand DOES render the SELF-VERIFY block verbatim", () => {
  // Control: prove the absence asserted above is caused by the missing command, not by the token
  // never rendering. With a command present, the SELF-VERIFY marker appears and the command is
  // rendered verbatim — and the two standing prohibitions still render alongside it.
  const cmd =
    "npx tsc -p tsconfig.test.json && node --test out-test/**/*.test.js";
  const p = buildWorkerPrompt(codeUnit(), "6", { selfVerifyCommand: cmd });
  assert.ok(
    p.includes("SELF-VERIFY"),
    "a supplied self-verify command must render the SELF-VERIFY block marker",
  );
  assert.ok(
    p.includes(cmd),
    "the SELF-VERIFY block must contain the supplied command verbatim",
  );
  // Prohibitions remain unconditional alongside the rendered block.
  assert.ok(p.includes("footprint") && p.includes("tsconfig"));
  assert.ok(
    p.includes("acceptance/") &&
      p.includes("closing gate") &&
      p.includes("do not build or run"),
  );
});

test("AC4: a TEST unit renders NONE of these — no SELF-VERIFY block and no code-unit prohibitions", () => {
  // The contract: for a `test` unit ((unit.role ?? 'code') === 'test') the verification block AND
  // both standing prohibitions are omitted entirely — even the absent-command clean-omission logic
  // is a CODE-unit concern; a test unit simply renders none of it.
  const testUnit = codeUnit({
    id: "SP-6_SL-1#eu-5",
    footprint: ["src/acceptance/SP-6_12_AC-4.test.ts"],
    role: "test",
    note: "assert clean omission of the self-verify block",
  });
  const p = buildWorkerPrompt(testUnit, "6");
  assert.ok(
    !p.includes("SELF-VERIFY"),
    "a test unit's prompt must not render the SELF-VERIFY block",
  );
  assert.ok(
    !p.includes("tsconfig"),
    "a test unit's prompt must not render the code-unit footprint/build prohibition",
  );
});
