/**
 * SP-6/16 (TEP-6) AC1 — a held-out `role: test` worker's prompt carries the repo-declared
 * canonical example test's CONTENT, so the test-author has the repo's fixture-construction +
 * assertion idiom without reading existing test files.
 *
 * The defect this closes: every held-out test worker independently rediscovers the repo's test
 * idiom each run (reading whole files, hitting the Read cap, reaching for a Grep it lacks). The
 * fix declares a canonical example test once in `.tandem/conventions.json` and injects its content
 * into every `role: test` prompt.
 *
 * This AC pins the observable render contract of `buildWorkerPrompt` (SPEC CONTRACT): for a TEST
 * unit, when `context.exampleTest` holds non-blank content, the rendered prompt contains a block
 * whose HEADER carries the EXACT token `EXAMPLE TEST`, IMMEDIATELY FOLLOWED by that content
 * VERBATIM. The example is passed IN via `context` — the pure path — so this exercises ONLY the
 * public `buildWorkerPrompt` interface and makes NO assumption about how the content is sourced
 * from `conventions.json` (that seam is the resolver's own coverage under AC4).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildWorkerPrompt,
  type SchedUnit,
} from "../services/orchestratorCore";

const SPEC_NUMBER = "6/16";

// The exact token the SPEC CONTRACT pins as the example block's header marker.
const EXAMPLE_MARKER = "EXAMPLE TEST";

/**
 * A minimal HELD-OUT TEST execution unit (`role: "test"`) — the example block renders for test
 * units only, so this is the subject under test. Footprint points at the reserved `acceptance/`
 * probe path, mirroring how test units are dispatched.
 */
function testUnit(overrides: Partial<SchedUnit> = {}): SchedUnit {
  return {
    id: "SP-6_16_SL-1#eu-4",
    slice: "SP-6_16_SL-1",
    footprint: ["src/acceptance/SP-6_16_AC-1.test.ts"],
    requires: [],
    shape: "fan-out",
    note: "assert the example block renders for a test unit",
    role: "test",
    ...overrides,
  };
}

// A realistic canonical example test — multi-line, no surrounding whitespace so a `verbatim`
// render is a byte-for-byte substring regardless of any header/trailing formatting. This is the
// repo's fixture-construction + assertion pattern the test-author is meant to copy.
const EXAMPLE_CONTENT = [
  'import { test } from "node:test";',
  'import assert from "node:assert/strict";',
  "",
  'import { widget } from "../services/widget";',
  "",
  'test("widget doubles its input", () => {',
  "  assert.equal(widget(2), 4);",
  "});",
].join("\n");

// ── AC1 core: the example content renders VERBATIM under an `EXAMPLE TEST` header, for a test unit ──

test("AC1: a test unit's prompt carries the example content VERBATIM under an EXAMPLE TEST header", () => {
  const p = buildWorkerPrompt(testUnit(), SPEC_NUMBER, {
    exampleTest: EXAMPLE_CONTENT,
  });

  // 1) The block's header carries the EXACT token `EXAMPLE TEST`.
  assert.ok(
    p.includes(EXAMPLE_MARKER),
    "the example block header must contain the exact token 'EXAMPLE TEST'",
  );

  // 2) The declared example appears VERBATIM (exact multi-line substring — not re-worded,
  //    re-indented, or re-escaped).
  assert.ok(
    p.includes(EXAMPLE_CONTENT),
    "the prompt must reproduce the example test content verbatim",
  );
});

// ── AC1 shape: the content is IMMEDIATELY preceded by the header line (it is the block's body) ──
//
// "immediately followed" per the contract: the content begins on the line right after the header
// line that carries the `EXAMPLE TEST` token — so the marker introduces the content, not a
// coincidental mention trailing it.
test("AC1: the example content begins immediately after the EXAMPLE TEST header line", () => {
  const p = buildWorkerPrompt(testUnit(), SPEC_NUMBER, {
    exampleTest: EXAMPLE_CONTENT,
  });

  const lines = p.split("\n");
  const headerIdx = lines.findIndex((l) => l.includes(EXAMPLE_MARKER));
  assert.ok(
    headerIdx >= 0,
    "a header line carrying the 'EXAMPLE TEST' token must be present",
  );

  // The content is the block body: it starts on the very next line after the header line.
  const afterHeader = lines.slice(headerIdx + 1).join("\n");
  assert.ok(
    afterHeader.startsWith(EXAMPLE_CONTENT),
    "the example content must immediately follow the EXAMPLE TEST header line, verbatim",
  );
});

// The marker precedes the content — it heads the block, it does not trail the example.
test("AC1: the EXAMPLE TEST marker heads the block that contains the content", () => {
  const p = buildWorkerPrompt(testUnit(), SPEC_NUMBER, {
    exampleTest: EXAMPLE_CONTENT,
  });
  assert.ok(
    p.indexOf(EXAMPLE_MARKER) < p.indexOf(EXAMPLE_CONTENT),
    "the EXAMPLE TEST marker must appear before the content it introduces",
  );
});

// The render ECHOES the supplied content (it is not a hardcoded string): swap the example and the
// new content appears verbatim while the old one does not.
test("AC1: the block echoes the supplied example content, not a hardcoded string", () => {
  const other = [
    "def test_widget_doubles():",
    "    assert widget(2) == 4",
  ].join("\n");

  const p = buildWorkerPrompt(testUnit(), SPEC_NUMBER, { exampleTest: other });

  assert.ok(
    p.includes(EXAMPLE_MARKER),
    "the marker renders for any supplied example",
  );
  assert.ok(
    p.includes(other),
    "the supplied example content is echoed verbatim under the block",
  );
  assert.ok(
    !p.includes(EXAMPLE_CONTENT),
    "an unrelated example is not present — the render is not hardcoded",
  );
});

// An explicit `role: "test"` (rather than a defaulted role) still renders the example block —
// the branch keys on `(unit.role ?? "code") === "test"`, and this unit sets it explicitly.
test("AC1: an explicit role:'test' unit renders the example block + verbatim content", () => {
  const p = buildWorkerPrompt(testUnit({ role: "test" }), SPEC_NUMBER, {
    exampleTest: EXAMPLE_CONTENT,
  });
  assert.ok(
    p.includes(EXAMPLE_MARKER),
    "explicit test role still gets the EXAMPLE TEST block",
  );
  assert.ok(
    p.includes(EXAMPLE_CONTENT),
    "explicit test role still gets the verbatim example content",
  );
});
