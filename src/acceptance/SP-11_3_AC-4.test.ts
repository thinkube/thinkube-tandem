/**
 * SP-11/3 (TEP-11) AC4 — "Discoveries surfaced".
 *
 * Two halves of one criterion, both on the SPEC CONTRACT's public surface:
 *
 *   1. `extractDiscoveries(finalOutput)` — the pure extractor. Items under a TRAILING
 *      `## Discoveries` heading of a unit's final output, list markers stripped and trimmed:
 *      "…\n\n## Discoveries\n- a\n- b" → ["a","b"]; the heading absent → [] (deep-equal).
 *
 *   2. `buildDeliveryReport` renders a `## Discoveries & recommendations` section: each
 *      `{ unit, text }` discovery entry renders BOTH its originating unit AND its text; an
 *      empty (or omitted) `discoveries` list renders the literal "none reported".
 *
 * This exercises ONLY the public interface pinned in the SPEC CONTRACT (`extractDiscoveries` +
 * `buildDeliveryReport`/`DeliveryReportInput.discoveries`) — it makes no assumption about the
 * internal implementation, only about the extractor's return value and the section's content.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildDeliveryReport,
  extractDiscoveries,
  type DeliveryReportInput,
} from "../services/orchestratorCore";

// The exact heading the SPEC CONTRACT places the discovery entries under.
const DISCOVERIES_HEADING = "## Discoveries & recommendations";

// ── fixtures ────────────────────────────────────────────────────────────────

/** A complete, valid report input; per-test overrides flip `discoveries` / outcome. */
function makeInput(
  overrides: Partial<DeliveryReportInput> = {},
): DeliveryReportInput {
  return {
    specNumber: "11/3",
    sha: "abc1234",
    files: ["src/services/orchestratorCore.ts"],
    units: [{ id: "SP-11_3_SL-1#eu-0", outcome: "success" }],
    declared: [{ ac: 1, run: "node --test out-test/x.js", env: "local" }],
    acResults: [{ ac: 1, pass: true, evidence: "$ node --test → exit 0\nok" }],
    advanced: ["SP-11_3_SL-1"],
    committed: true,
    ...overrides,
  };
}

/**
 * The body of the `## Discoveries & recommendations` section — from its heading line up to (but
 * excluding) the next `## ` heading. Exact-line match on the heading distinguishes it from any
 * other section.
 */
function discoveriesSection(report: string): string {
  const lines = report.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === DISCOVERIES_HEADING);
  assert.notEqual(
    start,
    -1,
    `the report must contain an exact \`${DISCOVERIES_HEADING}\` section heading`,
  );
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l.trim()));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
}

// ── extractDiscoveries: the trailing `## Discoveries` block → list items ───────

test("AC4: extractDiscoveries pulls a trailing `## Discoveries` block's items, markers stripped — deep-equal [a, b]", () => {
  const finalOutput =
    "Delivered the widget and wired the seam.\n\n## Discoveries\n- a\n- b";
  assert.deepEqual(extractDiscoveries(finalOutput), ["a", "b"]);
});

test("AC4: extractDiscoveries returns [] when the `## Discoveries` heading is absent (deep-equal)", () => {
  const finalOutput =
    "Delivered the widget and wired the seam. No out-of-scope findings to report.";
  assert.deepEqual(extractDiscoveries(finalOutput), []);
});

test("AC4: extractDiscoveries trims each item and strips its list marker", () => {
  // Real-world final output: prose, blank line, the trailing block. Each item carries a `-`
  // marker and surrounding whitespace the extractor must strip; the returned strings are the
  // clean findings, in order.
  const finalOutput = [
    "Implemented the parser and its error path.",
    "",
    "## Discoveries",
    "-   settings.json merge drops a nested key on rewrite",
    "- the wrapper's cwd handoff races on `--resume`",
  ].join("\n");
  assert.deepEqual(extractDiscoveries(finalOutput), [
    "settings.json merge drops a nested key on rewrite",
    "the wrapper's cwd handoff races on `--resume`",
  ]);
});

// ── buildDeliveryReport: each entry renders BOTH its unit and its text ─────────

test("AC4: a report built with `{unit, text}` discoveries renders BOTH the unit and the text under `## Discoveries & recommendations`", () => {
  const UNIT_A = "SP-11_3_SL-1#eu-3";
  const TEXT_A =
    "the settings.json rewrite drops an unknown nested key «find-A-Ω»";
  const UNIT_B = "SP-11_3_SL-2#eu-1";
  const TEXT_B = "the wrapper races on `--resume` cwd resolution «find-B-Δ»";

  const report = buildDeliveryReport(
    makeInput({
      discoveries: [
        { unit: UNIT_A, text: TEXT_A },
        { unit: UNIT_B, text: TEXT_B },
      ],
    }),
  );

  const section = discoveriesSection(report);
  // Both entries: each renders its ORIGINATING UNIT and its finding TEXT.
  assert.ok(
    section.includes(UNIT_A),
    `the section must name the originating unit \`${UNIT_A}\` — got: ${JSON.stringify(section)}`,
  );
  assert.ok(
    section.includes(TEXT_A),
    `the section must carry the finding text for ${UNIT_A}`,
  );
  assert.ok(
    section.includes(UNIT_B),
    `the section must name the originating unit \`${UNIT_B}\` — got: ${JSON.stringify(section)}`,
  );
  assert.ok(
    section.includes(TEXT_B),
    `the section must carry the finding text for ${UNIT_B}`,
  );
  // It is NOT the empty-state literal when discoveries are present.
  assert.ok(
    !section.includes("none reported"),
    "a populated discoveries section must not render the empty-state literal",
  );
});

test("AC4: each discovery's unit and text land TOGETHER — the unit is not paired with a foreign finding", () => {
  // The two findings are mutually distinct, so a unit rendered next to the WRONG text (a
  // shift/duplication) would put a foreign string on that unit's line-group.
  const UNIT_A = "SP-11_3_SL-1#eu-3";
  const TEXT_A = "finding-alpha «A-77b1a0»";
  const UNIT_B = "SP-11_3_SL-2#eu-1";
  const TEXT_B = "finding-beta «B-9f3c42»";

  const report = buildDeliveryReport(
    makeInput({
      discoveries: [
        { unit: UNIT_A, text: TEXT_A },
        { unit: UNIT_B, text: TEXT_B },
      ],
    }),
  );
  const section = discoveriesSection(report);

  // The line(s) that mention UNIT_A must carry TEXT_A and not TEXT_B, and vice-versa. Guard by
  // locating each unit's rendered line and checking the pairing on it.
  const lineWith = (needle: string): string => {
    const line = section.split(/\r?\n/).find((l) => l.includes(needle));
    assert.ok(line, `the section must contain a line mentioning ${needle}`);
    return line!;
  };
  const rowA = lineWith(UNIT_A);
  const rowB = lineWith(UNIT_B);
  assert.ok(
    rowA.includes(TEXT_A),
    `${UNIT_A}'s line must carry its own finding`,
  );
  assert.ok(
    !rowA.includes(TEXT_B),
    `${UNIT_A}'s line must not carry ${UNIT_B}'s finding`,
  );
  assert.ok(
    rowB.includes(TEXT_B),
    `${UNIT_B}'s line must carry its own finding`,
  );
  assert.ok(
    !rowB.includes(TEXT_A),
    `${UNIT_B}'s line must not carry ${UNIT_A}'s finding`,
  );
});

// ── buildDeliveryReport: empty / omitted → the literal "none reported" ─────────

test('AC4: an EMPTY discoveries list renders the section with the literal "none reported"', () => {
  const report = buildDeliveryReport(makeInput({ discoveries: [] }));
  const section = discoveriesSection(report);
  assert.ok(
    section.includes("none reported"),
    `an empty discoveries list must render "none reported" — got: ${JSON.stringify(section)}`,
  );
});

test('AC4: an OMITTED discoveries field renders the section with the literal "none reported"', () => {
  // No `discoveries` key at all — the section is still present (always rendered) with the empty
  // literal, so the operator's document never silently drops the section.
  const report = buildDeliveryReport(makeInput());
  const section = discoveriesSection(report);
  assert.ok(
    section.includes("none reported"),
    `an omitted discoveries field must render "none reported" — got: ${JSON.stringify(section)}`,
  );
});
