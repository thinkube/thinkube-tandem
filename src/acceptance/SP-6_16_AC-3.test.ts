/**
 * SP-6/16 (TEP-6) AC3 — a `role: test` worker's prompt with NO example declared omits the example
 * block entirely (its marker — the exact token `EXAMPLE TEST` — is absent), while the existing
 * test-framework hint (`Test convention:`) and the rest of the prompt render unchanged.
 *
 * Why this matters (the defect this closes): held-out `role: test` workers independently rediscover
 * the repo's test idiom every run — burning tokens and hitting Read caps. SP-6/16 lets a repo
 * declare a canonical example test once (in `.tandem/conventions.json`) and injects it into every
 * test-worker prompt. But the injection must be strictly BACKWARD-COMPATIBLE: a repo that declares
 * NO example (no `exampleTest` in `context`) must get an UNCHANGED test-worker prompt — the example
 * block, marker included, is omitted cleanly, and the pre-existing `testConvention` framework-hint
 * path keeps working exactly as before. This AC pins that clean-omission boundary.
 *
 * Verified PURELY against the SP-6/16 SPEC CONTRACT — the exported, vscode-free
 * `buildWorkerPrompt(unit, specNumber, context?)` in `src/services/orchestratorCore.ts`. The
 * contract's render rules exercised here:
 *   • "When exampleTest is absent/blank, OR the unit is a code unit, the token `EXAMPLE TEST` does
 *      NOT appear anywhere in the prompt (block + marker omitted cleanly)."
 *   • "The existing `Test convention:` block (from context.testConvention on a test unit) is
 *      UNAFFECTED."
 *
 * The distinctive observable tokens are the exact strings `EXAMPLE TEST` (whose ABSENCE this asserts)
 * and `Test convention:` (whose PRESENCE this asserts). The test exercises ONLY the public
 * `buildWorkerPrompt` interface — it makes no assumption about the internal wording of the prompt
 * beyond those two pinned tokens, nor about how the example is sourced (that seam is the resolver's
 * own coverage, AC4).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildWorkerPrompt,
  type SchedUnit,
} from "../services/orchestratorCore";

// A minimal TEST execution unit — `role: "test"` makes it the held-out verifier, the ONLY role for
// which the example block (and the `Test convention:` hint) render at all. This is the subject under
// test for AC3's "no example declared" path.
const testUnit = (over: Partial<SchedUnit> = {}): SchedUnit => ({
  id: "SP-6_SL-1#eu-6",
  slice: "SP-6_SL-1",
  footprint: ["src/acceptance/SP-6_16_AC-3.test.ts"],
  requires: [],
  shape: "serial",
  role: "test",
  note: "assert the example block is omitted cleanly when no example is declared",
  ...over,
});

// The framework + run hint the repo declares for its test workers (the pre-existing `testConvention`
// path this AC must leave UNAFFECTED). Its own text is unrelated to the `EXAMPLE TEST` marker, so a
// spurious `EXAMPLE TEST` match could never come from this string.
const TEST_CONVENTION =
  "node --test out-test/acceptance/SP-{spec}_AC-{ac}.test.js (node:test)";

// ── AC3 core: no exampleTest ⇒ `EXAMPLE TEST` absent, `Test convention:` still present ──

test("AC3: a test unit with NO exampleTest omits the `EXAMPLE TEST` token while still rendering the `Test convention:` block", () => {
  const p = buildWorkerPrompt(testUnit(), "6", {
    testConvention: TEST_CONVENTION,
  });

  // The example block is omitted cleanly — its marker (the exact token `EXAMPLE TEST`) is absent.
  assert.ok(
    !p.includes("EXAMPLE TEST"),
    "with no exampleTest in context, the `EXAMPLE TEST` marker must not appear anywhere in the prompt",
  );

  // The pre-existing framework hint is UNAFFECTED — the `Test convention:` block still renders...
  assert.ok(
    p.includes("Test convention:"),
    "the existing `Test convention:` block must still render for a test unit when testConvention is supplied",
  );
  // ...and reproduces the supplied convention verbatim (proving the block is live, not a stray token).
  assert.ok(
    p.includes(TEST_CONVENTION),
    "the `Test convention:` block must carry the supplied testConvention value verbatim",
  );
});

// The `context` field is entirely omitted here (not merely undefined exampleTest): the marker must
// still be absent, and the convention block still renders from the supplied testConvention.
test("AC3: an explicitly absent exampleTest (context has ONLY testConvention) still omits `EXAMPLE TEST`", () => {
  const p = buildWorkerPrompt(testUnit(), "6", {
    specBody:
      "## Design\n\nInject a canonical example test into role:test prompts.",
    sliceBody:
      "Backward-compatible: no example declaration ⇒ unchanged test-worker prompt.",
    testConvention: TEST_CONVENTION,
  });

  assert.ok(
    !p.includes("EXAMPLE TEST"),
    "an absent exampleTest (alongside other populated context fields) must leave no `EXAMPLE TEST` marker",
  );
  assert.ok(
    p.includes("Test convention:"),
    "the `Test convention:` block must render regardless of the absent example declaration",
  );
});

// A BLANK exampleTest is treated the same as absent per the contract ("absent/blank"): the marker is
// still omitted cleanly, and the convention block is unaffected.
test("AC3: a blank/whitespace-only exampleTest is treated as absent — `EXAMPLE TEST` stays omitted, `Test convention:` renders", () => {
  for (const blank of ["", "   ", "\n\t  \n"]) {
    const p = buildWorkerPrompt(testUnit(), "6", {
      testConvention: TEST_CONVENTION,
      exampleTest: blank,
    });
    assert.ok(
      !p.includes("EXAMPLE TEST"),
      "a blank exampleTest (" +
        JSON.stringify(blank) +
        ") must omit the `EXAMPLE TEST` marker cleanly",
    );
    assert.ok(
      p.includes("Test convention:"),
      "the `Test convention:` block must still render alongside a blank exampleTest (" +
        JSON.stringify(blank) +
        ")",
    );
  }
});

// The two paths are INDEPENDENT: dropping testConvention as well must STILL leave no `EXAMPLE TEST`
// marker (the omission of the example block does not depend on the convention block being present).
test("AC3: with neither exampleTest nor testConvention, the `EXAMPLE TEST` token is still absent", () => {
  const p = buildWorkerPrompt(testUnit(), "6");
  assert.ok(
    !p.includes("EXAMPLE TEST"),
    "a test unit with no example and no convention must not render the `EXAMPLE TEST` marker",
  );
  // And with no testConvention supplied, the convention block is (correctly) omitted — proving the
  // convention hint is driven by its OWN field, not incidentally by the example omission.
  assert.ok(
    !p.includes("Test convention:"),
    "the `Test convention:` block is omitted when no testConvention is supplied",
  );
});
