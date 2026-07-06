/**
 * SP-11/3 (TEP-11) AC1 — "What happened" first, with the judge's diagnosis UNCLIPPED.
 *
 * DELIVERY.md becomes the operator's document: the FIRST `## ` section after the `# Delivery`
 * title line is `## What happened`. On a FAILED run (committed:false OR any AC pass:false) that
 * section renders each judge `diagnosis` text as prose, VERBATIM — never subjected to the
 * 160-character clip the machine trace table uses — so a long diagnosis's distinctive tail
 * survives into the human document. On a SUCCESSFUL run the same section carries a non-empty
 * plain summary of what was delivered.
 *
 * This exercises ONLY the public interface in the SPEC CONTRACT (`buildDeliveryReport` +
 * `DeliveryReportInput`) — it makes no assumption about the internal implementation, only about
 * the section order and the verbatim-diagnosis guarantee the contract pins.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildDeliveryReport,
  type DeliveryReportInput,
} from "../services/orchestratorCore";

// ── fixtures ────────────────────────────────────────────────────────────────

/** A complete, valid report input; per-test overrides flip it to a pass or a fail. */
function makeInput(
  overrides: Partial<DeliveryReportInput> = {},
): DeliveryReportInput {
  return {
    specNumber: "11/3",
    sha: "abc1234",
    files: ["src/services/orchestratorCore.ts"],
    units: [{ id: "SP-11_3_SL-1#eu-0", outcome: "success" }],
    declared: [{ ac: 1, run: "node --test out-test/x.js", env: "local" }],
    acResults: [
      {
        ac: 1,
        pass: true,
        evidence: "$ node --test out-test/x.js → exit 0\nok",
      },
    ],
    advanced: ["SP-11_3_SL-1"],
    committed: true,
    ...overrides,
  };
}

/** The heading text of the FIRST `## ` section that appears AFTER the `# Delivery` title line. */
function firstSectionAfterTitle(report: string): string | undefined {
  const lines = report.split(/\r?\n/);
  const titleIdx = lines.findIndex((l) => /^#\s+Delivery\b/.test(l));
  assert.notEqual(
    titleIdx,
    -1,
    "the report must open with a `# Delivery` title line",
  );
  for (let i = titleIdx + 1; i < lines.length; i++) {
    if (/^##\s+\S/.test(lines[i])) return lines[i].trim();
  }
  return undefined;
}

/** The body of the `## What happened` section: everything up to the next `## ` heading, trimmed. */
function whatHappenedBody(report: string): string {
  const lines = report.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+What happened\s*$/.test(l));
  assert.notEqual(
    start,
    -1,
    "the report must contain a `## What happened` heading",
  );
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+\S/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join("\n").trim();
}

// A diagnosis text deliberately LONGER than 160 characters, whose distinctive token sits well
// past position 160 — so a 160-char clip (the trace table's `clip(…, 160)`) would drop the tail,
// and its verbatim survival is proof the human document is never clipped.
const TAIL = "«verbatim-tail-Ω-9f3c42»";
const LONG_DIAGNOSIS =
  "The held-out acceptance probe pinned an internal ordinal token the new report layout intentionally " +
  "demoted into the evidence appendix, so its assertion diverged from the delivered behaviour rather " +
  "than catching a real regression — the check itself needs rewording, not the code. " +
  TAIL;

// ── AC1: `## What happened` is the FIRST section after the title (both outcomes) ──

test("AC1: the first `## ` section after the `# Delivery` title is `## What happened` — on a failed run", () => {
  const report = buildDeliveryReport(
    makeInput({
      committed: false,
      acResults: [
        {
          ac: 1,
          pass: false,
          evidence: "$ node --test out-test/x.js → exit 1\nnot ok",
        },
      ],
      diagnosis: [{ ac: 1, text: LONG_DIAGNOSIS }],
    }),
  );
  assert.equal(firstSectionAfterTitle(report), "## What happened");
});

test("AC1: the first `## ` section after the `# Delivery` title is `## What happened` — on a successful run", () => {
  const report = buildDeliveryReport(makeInput({ committed: true }));
  assert.equal(firstSectionAfterTitle(report), "## What happened");
});

// ── AC1: failed run ⇒ each diagnosis text VERBATIM, including a >160-char tail ──

test("AC1: on a failed run the diagnosis text (>160 chars) appears VERBATIM in `## What happened`, tail included (no 160-char clip)", () => {
  // Fixture sanity: the diagnosis really is longer than 160 chars and the distinctive tail sits
  // past position 160 — otherwise the "unclipped" assertion would be vacuous.
  assert.ok(
    LONG_DIAGNOSIS.length > 160,
    "the diagnosis fixture must exceed 160 characters",
  );
  assert.ok(
    LONG_DIAGNOSIS.indexOf(TAIL) > 160,
    "the distinctive tail token must sit past character 160 (a 160-clip would drop it)",
  );

  const report = buildDeliveryReport(
    makeInput({
      committed: false,
      acResults: [
        {
          ac: 1,
          pass: false,
          evidence: "$ node --test out-test/x.js → exit 1\nnot ok",
        },
      ],
      diagnosis: [{ ac: 1, text: LONG_DIAGNOSIS }],
    }),
  );

  const body = whatHappenedBody(report);
  // The full text, verbatim, tail and all — not a `slice(0,159) + "…"` truncation.
  assert.ok(
    body.includes(LONG_DIAGNOSIS),
    "the What happened section must carry the diagnosis text in full and verbatim",
  );
  assert.ok(
    body.includes(TAIL),
    "the distinctive >160-char tail token must survive into the What happened section",
  );
});

test("AC1: a failed run triggered by pass:false alone (committed anyway) still renders the diagnosis verbatim", () => {
  // "Failed" is committed:false OR any acResults pass:false — assert the pass:false arm too, so a
  // report that committed but has a red AC is still treated as a failure by What happened.
  const report = buildDeliveryReport(
    makeInput({
      committed: true,
      acResults: [
        {
          ac: 1,
          pass: false,
          evidence: "$ node --test out-test/x.js → exit 1\nnot ok",
        },
      ],
      diagnosis: [{ ac: 1, text: LONG_DIAGNOSIS }],
    }),
  );
  assert.equal(firstSectionAfterTitle(report), "## What happened");
  const body = whatHappenedBody(report);
  assert.ok(
    body.includes(LONG_DIAGNOSIS),
    "failure via pass:false must still render the diagnosis verbatim",
  );
  assert.ok(body.includes(TAIL));
});

test("AC1: multiple diagnosis texts are each rendered verbatim (joined as prose) in What happened", () => {
  const first = LONG_DIAGNOSIS;
  const SECOND_TAIL = "«second-tail-Δ-77b1a0»";
  const second =
    "A second criterion's independent judge found the delivered summary omitted the migration step the " +
    "operator must run before the change takes effect, so the report under-describes the delivery scope — " +
    SECOND_TAIL;

  const report = buildDeliveryReport(
    makeInput({
      committed: false,
      declared: [
        { ac: 1, run: "node --test out-test/x.js", env: "local" },
        { ac: 2, run: "node --test out-test/y.js", env: "local" },
      ],
      acResults: [
        { ac: 1, pass: false, evidence: "$ node --test → exit 1\nnot ok" },
        { ac: 2, pass: false, evidence: "$ node --test → exit 1\nnot ok" },
      ],
      diagnosis: [
        { ac: 1, text: first },
        { ac: 2, text: second },
      ],
    }),
  );

  const body = whatHappenedBody(report);
  assert.ok(body.includes(first), "the first diagnosis must appear verbatim");
  assert.ok(body.includes(second), "the second diagnosis must appear verbatim");
  assert.ok(
    body.includes(TAIL) && body.includes(SECOND_TAIL),
    "both distinctive tails must survive",
  );
});

// ── AC1: successful run ⇒ the section carries non-empty prose ──────────────────

test("AC1: on a successful run `## What happened` contains a non-empty plain summary", () => {
  const report = buildDeliveryReport(makeInput({ committed: true }));
  const body = whatHappenedBody(report);
  assert.ok(
    body.length > 0,
    "the What happened section must not be empty on success",
  );
  // "prose" — real word content, not just punctuation / a bare heading echo.
  assert.match(
    body,
    /[A-Za-z]{3,}/,
    "the success summary must read as prose (contains words)",
  );
});
