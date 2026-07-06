/**
 * SP-6/12 (TEP-6) AC3 — a code-author worker's prompt states plainly that the held-out
 * `acceptance/` probes are the CLOSING GATE's job, and the worker must NOT build or run them.
 *
 * The defect this closes: a code-author, trying to self-verify, has no sanctioned account of
 * what the reserved `acceptance/` tree is or who owns it — so it may try to compile/run those
 * held-out probes itself (or improvise a build to reach them), colliding with the gate's job.
 * The fix surfaces a STANDING, UNCONDITIONAL prohibition in every code unit's prompt: the
 * `acceptance/` probes are graded by the closing gate; do not build or run them.
 *
 * Exercises ONLY the public interface in the SPEC CONTRACT — the pure, exported
 * `buildWorkerPrompt(unit, specNumber, context?)` in `src/services/orchestratorCore.ts` — by
 * substring assertion (the established `orchestratorCore.test.ts` pattern). Per the render rules
 * this prohibition is UNCONDITIONAL for CODE units ((unit.role ?? "code") !== "test") and must
 * carry ALL of the exact tokens: "acceptance/", "closing gate", and "do not build or run". It
 * renders whether or not a self-verify command is supplied, and it does NOT render for a `test`
 * unit (which renders NONE of these prohibitions). Makes no assumption about internal wording
 * beyond those pinned observable tokens.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildWorkerPrompt,
  type SchedUnit,
} from "../services/orchestratorCore";

const SPEC_NUMBER = "6/12";

// The three exact tokens the SPEC CONTRACT pins for the held-out prohibition (render rule 3):
// the `acceptance/` probes are graded by the closing gate; the worker must not build or run them.
const HELD_OUT_TOKENS = [
  "acceptance/",
  "closing gate",
  "do not build or run",
] as const;

/** A minimal CODE execution unit (role omitted ⇒ `code`, the intent-only implementer). */
function codeUnit(overrides: Partial<SchedUnit> = {}): SchedUnit {
  return {
    id: "SP-6_12_SL-1#eu-0",
    slice: "SP-6_12_SL-1",
    footprint: ["src/services/orchestratorCore.ts"],
    requires: [],
    shape: "serial",
    note: "add the self-verify field + render its block",
    ...overrides,
  };
}

// ── AC3 core: the held-out prohibition renders (all three tokens) for a code unit ──

test("AC3: a code unit's prompt names the acceptance/ probes as the closing gate's job and forbids building or running them", () => {
  const prompt = buildWorkerPrompt(codeUnit(), SPEC_NUMBER);

  for (const token of HELD_OUT_TOKENS) {
    assert.ok(
      prompt.includes(token),
      `the held-out prohibition must contain the exact token ${JSON.stringify(
        token,
      )} — got a prompt missing it`,
    );
  }
});

// The prohibition is UNCONDITIONAL — it does not depend on the self-verify command. It renders
// both when the repo declares a self-verify command AND when it declares none. (AC4 keeps the two
// prohibitions rendering even when the verify-command guidance is omitted.)

test("AC3: the held-out prohibition renders whether or not a self-verify command is supplied", () => {
  const withCmd = buildWorkerPrompt(codeUnit(), SPEC_NUMBER, {
    selfVerifyCommand:
      "npx tsc -p tsconfig.test.json && node --test out-test/...",
  });
  const withoutCmd = buildWorkerPrompt(codeUnit(), SPEC_NUMBER, {
    selfVerifyCommand: "   ", // blank ⇒ verification block omitted; prohibitions still render
  });
  const noContext = buildWorkerPrompt(codeUnit(), SPEC_NUMBER);

  for (const [label, prompt] of [
    ["with a declared self-verify command", withCmd],
    ["with a blank self-verify command", withoutCmd],
    ["with no context at all", noContext],
  ] as const)
    for (const token of HELD_OUT_TOKENS)
      assert.ok(
        prompt.includes(token),
        `the held-out prohibition token ${JSON.stringify(
          token,
        )} must render ${label}`,
      );
});

// ── AC3 boundary: a `test` unit renders NONE of these prohibitions ──
//
// The render rules apply to CODE units only; a held-out test unit (role: "test") renders none of
// the verify/prohibition guidance. Asserting the "closing gate" / "do not build or run" tokens are
// ABSENT there isolates AC3 as code-unit-specific (the test-author IS the acceptance/ probe).

test("AC3: a test unit's prompt renders NONE of the held-out prohibition tokens", () => {
  const testPrompt = buildWorkerPrompt(
    codeUnit({
      role: "test",
      footprint: ["src/acceptance/SP-6_12_AC-3.test.ts"],
    }),
    SPEC_NUMBER,
  );

  assert.ok(
    !testPrompt.includes("closing gate"),
    'a test unit must NOT carry the "closing gate" prohibition token (code units only)',
  );
  assert.ok(
    !testPrompt.includes("do not build or run"),
    'a test unit must NOT carry the "do not build or run" prohibition token (code units only)',
  );
});
