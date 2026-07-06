/**
 * SP-6/16 (TEP-6) AC2 — the canonical example test is surfaced ONLY to `role: test` workers; a
 * `role: code` worker's prompt does NOT contain the example block.
 *
 * Why this matters (the defect this closes): held-out `role: test` workers each independently
 * rediscover the repo's test idiom every run — burning tokens and hitting Read caps. SP-6/16
 * injects a repo-declared canonical example test into every test-worker prompt. But the injection
 * must be strictly role-scoped: a CODE unit implements to the Spec's INTENT and must never carry
 * the test-author's example scaffolding. This AC pins that boundary from the code side — the
 * example block's marker (the exact token `EXAMPLE TEST`) must be absent from a code unit's prompt
 * EVEN WHEN `context.exampleTest` is supplied (the render branch keys on the unit's role, not on
 * the mere presence of the field).
 *
 * Verified PURELY against the SP-6/16 SPEC CONTRACT — the exported, vscode-free
 * `buildWorkerPrompt(unit, specNumber, context?)` in `src/services/orchestratorCore.ts`. The
 * contract's render rule: "When exampleTest is absent/blank, OR the unit is a code unit, the token
 * `EXAMPLE TEST` does NOT appear anywhere in the prompt (block + marker omitted cleanly)."
 *
 * The example content is passed IN via `context.exampleTest` — the pure path — so this exercises
 * ONLY the public `buildWorkerPrompt` interface and makes NO assumption about how the example is
 * sourced from `.tandem/conventions.json` (that seam is the resolver's own coverage, AC4). The
 * distinctive observable token is the exact string `EXAMPLE TEST`; the test asserts on its
 * ABSENCE for code units and makes no assumption about the internal wording of the prompt beyond it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildWorkerPrompt,
  type SchedUnit,
} from "../services/orchestratorCore";

// A minimal CODE execution unit (role omitted ⇒ `code` by the contract's default, and also
// spelled explicitly below). Render rule for the example block applies to `test` units only, so a
// code unit is the negative subject under test.
const codeUnit = (over: Partial<SchedUnit> = {}): SchedUnit => ({
  id: "SP-6_SL-1#eu-0",
  slice: "SP-6_SL-1",
  footprint: ["src/services/orchestratorCore.ts"],
  requires: [],
  shape: "serial",
  note: "implement the example-test injection end to end",
  ...over,
});

// A distinctive canonical example-test body — the kind of content a repo declares once in
// `.tandem/conventions.json` and the resolver reads into `context.exampleTest`. Its own text is
// unrelated to the `EXAMPLE TEST` marker we assert on, so a positive match could only come from the
// block header, never from this content leaking through.
const EXAMPLE_TEST_CONTENT = [
  'import { test } from "node:test";',
  'import assert from "node:assert/strict";',
  "",
  'test("adds two numbers", () => {',
  "  assert.equal(add(2, 3), 5);",
  "});",
].join("\n");

// ── AC2 core: a code unit's prompt omits the example block even with exampleTest supplied ──

test("AC2: a role:code unit's prompt does NOT contain the `EXAMPLE TEST` token even when context.exampleTest is set", () => {
  const p = buildWorkerPrompt(codeUnit({ role: "code" }), "6", {
    exampleTest: EXAMPLE_TEST_CONTENT,
  });

  assert.ok(
    !p.includes("EXAMPLE TEST"),
    "a code unit's prompt must never render the example block marker (`EXAMPLE TEST`), even when context.exampleTest is provided",
  );
});

// The default role IS `code` (role omitted) — the contract branches on `(unit.role ?? "code") ===
// "test"`, so an omitted role must behave identically to an explicit `code`: still no marker.
test("AC2: a role-omitted (default code) unit likewise omits the `EXAMPLE TEST` token with exampleTest set", () => {
  const p = buildWorkerPrompt(codeUnit(), "6", {
    exampleTest: EXAMPLE_TEST_CONTENT,
  });

  assert.ok(
    !p.includes("EXAMPLE TEST"),
    "a role-omitted (default `code`) unit must not render the `EXAMPLE TEST` marker when context.exampleTest is provided",
  );
});

// The example content itself must not sneak into a code unit's prompt by some other path: the block
// is omitted whole, so neither the marker NOR the supplied content appears.
test("AC2: neither the `EXAMPLE TEST` marker nor the supplied example content leaks into a code unit's prompt", () => {
  const p = buildWorkerPrompt(codeUnit(), "6", {
    exampleTest: EXAMPLE_TEST_CONTENT,
  });

  assert.ok(
    !p.includes("EXAMPLE TEST"),
    "no example-block marker for a code unit",
  );
  assert.ok(
    !p.includes(EXAMPLE_TEST_CONTENT),
    "the supplied example content must not appear in a code unit's prompt — the whole block is omitted, not just its header",
  );
});

// Robustness: the code-unit omission holds regardless of what other context fields are present
// (a self-verify command, spec/slice bodies) — the `EXAMPLE TEST` token stays absent because the
// branch keys on role, not on the surrounding context.
test("AC2: the `EXAMPLE TEST` token stays absent for a code unit alongside other populated context fields", () => {
  const p = buildWorkerPrompt(codeUnit(), "6", {
    specBody:
      "## Design\n\nInject the canonical example test into role:test prompts.",
    sliceBody:
      "Wire recipe.testExample through to context.exampleTest for test units.",
    testConvention:
      "node --test out-test/acceptance/SP-{spec}_AC-{ac}.test.js (node:test)",
    selfVerifyCommand:
      "npx tsc -p tsconfig.test.json && node --test out-test/services/orchestratorCore.test.js",
    exampleTest: EXAMPLE_TEST_CONTENT,
  });

  assert.ok(
    !p.includes("EXAMPLE TEST"),
    "a code unit's prompt must not carry the `EXAMPLE TEST` marker even with a full context object supplied",
  );
});
