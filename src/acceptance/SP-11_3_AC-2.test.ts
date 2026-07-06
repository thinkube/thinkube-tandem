/**
 * SP-11/3 (TEP-11) AC2 — "Criteria by name": every AC row in the delivery report carries the
 * criterion's TEXT from the Spec's `## Acceptance Criteria` alongside its ordinal and verdict;
 * no row is a bare `#N`.
 *
 * The report becomes the operator's document, so the AC table stops speaking in bare ordinals a
 * reader has to cross-reference against the Spec. `buildDeliveryReport` gains `acTexts?: string[]`
 * (the Spec's criterion lines, index k-1 ↔ AC k). SPEC CONTRACT pins the render exactly:
 *
 *   Acceptance rows (acTexts provided): one line per declared AC keeping today's ordinal token:
 *     "#k — <acTexts[k-1]> — <verdict>" with verdict ∈ { "✓ pass", "✗ fail", "· not run" }.
 *
 * This exercises ONLY the public `buildDeliveryReport` interface via its `DeliveryReportInput`
 * shape (the pure path — `acTexts` passed IN), making NO assumption about how the gate sources the
 * criterion lines from the spec body. Each of the three verdicts is exercised at once: one AC that
 * passed (`✓ pass`), one that failed (`✗ fail`), and one with no result (`· not run`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildDeliveryReport,
  type DeliveryReportInput,
  type AcVerification,
  type AcResult,
} from "../services/orchestratorCore";

// The exact section heading the SPEC CONTRACT places the criterion rows under.
const AC_HEADING = "## Acceptance criteria";

// The exact verdict tokens the contract permits — nothing else may render as a row's verdict.
const VERDICTS = ["✓ pass", "✗ fail", "· not run"] as const;

/**
 * The Spec's criterion lines (index k-1 ↔ AC k). Distinct, prose strings with NO `#` and NO
 * verdict glyph, so a token search inside a row is unambiguous. These are the exact texts each
 * row must carry alongside its ordinal.
 */
const AC_TEXTS = [
  "What happened is the first section after the Delivery title line, verbatim.",
  "Every AC row carries the criterion text alongside its ordinal and verdict.",
  "Raw verification output appears only under the Evidence appendix heading.",
];

// Three declared ACs — the run commands live in the demoted evidence appendix, never the AC rows,
// so they carry no `#` token that could confuse the ordinal scan.
const DECLARED: AcVerification[] = [
  {
    ac: 1,
    run: "node --test out-test/acceptance/SP-11_3_AC-1.test.js",
    env: "local",
  },
  {
    ac: 2,
    run: "node --test out-test/acceptance/SP-11_3_AC-2.test.js",
    env: "local",
  },
  {
    ac: 3,
    run: "node --test out-test/acceptance/SP-11_3_AC-3.test.js",
    env: "local",
  },
];

// AC1 passed, AC2 failed, AC3 has no result (→ "· not run"): all three verdict kinds in one report.
const AC_RESULTS: AcResult[] = [
  { ac: 1, pass: true, evidence: "$ run 1 → exit 0\nall good" },
  { ac: 2, pass: false, evidence: "$ run 2 → exit 1\nassertion failed" },
];

// AC ordinal → the verdict its row must carry, per the acResults above.
const EXPECTED_VERDICT = new Map<number, (typeof VERDICTS)[number]>([
  [1, "✓ pass"],
  [2, "✗ fail"],
  [3, "· not run"],
]);

function buildInput(
  overrides: Partial<DeliveryReportInput> = {},
): DeliveryReportInput {
  return {
    specNumber: "11/3",
    sha: "abc1234",
    files: ["src/services/orchestratorCore.ts"],
    units: [{ id: "SP-11_3_SL-1#eu-1", outcome: "success" }],
    declared: DECLARED,
    acResults: AC_RESULTS,
    advanced: [],
    committed: false,
    // AC2's fail makes this a failed run — What happened renders the diagnosis; irrelevant to the
    // AC-rows assertions here, but supplied so the report is a realistic failure report.
    diagnosis: [
      { ac: 2, text: "AC2 failed: the criterion rows dropped their text." },
    ],
    acTexts: AC_TEXTS,
    ...overrides,
  };
}

/**
 * The body of the `## Acceptance criteria` section — from its heading line up to (but excluding)
 * the next `## ` heading. Exact-line match on the heading distinguishes it from any other section.
 */
function acSection(report: string): string {
  const lines = report.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === AC_HEADING);
  assert.notEqual(
    start,
    -1,
    `the report must contain an exact \`${AC_HEADING}\` section heading`,
  );
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l.trim()));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/** The row (line) carrying AC #k's ordinal token — `#k` not followed by another digit. */
function rowForAc(section: string, k: number): string | undefined {
  const ord = new RegExp(`#${k}(?!\\d)`);
  return section
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .find((l) => ord.test(l));
}

// ── AC2 core: each declared AC's row carries ordinal + criterion text + verdict ─────
//
// The heart of "criteria by name": for every declared AC there is exactly one row under
// `## Acceptance criteria` that carries — ON THE SAME LINE — its `#k` ordinal token, its
// `acTexts[k-1]` criterion text, and one of the three permitted verdicts. All three verdict
// kinds (pass / fail / not run) are present, so the row shape is proven across the whole space.

test("AC2: every declared AC row carries its #k ordinal, its acTexts[k-1] text, and a valid verdict", () => {
  const report = buildDeliveryReport(buildInput());
  const section = acSection(report);

  for (const v of DECLARED) {
    const k = v.ac;
    const row = rowForAc(section, k);
    assert.ok(
      row,
      `AC #${k} must have a row under \`${AC_HEADING}\` carrying its ordinal token`,
    );
    // ordinal token kept (today's `#k`).
    assert.match(
      row!,
      new RegExp(`#${k}(?!\\d)`),
      `AC #${k}'s row must keep its ordinal token \`#${k}\``,
    );
    // criterion text carried — the row is NOT a bare ordinal.
    assert.ok(
      row!.includes(AC_TEXTS[k - 1]),
      `AC #${k}'s row must carry its criterion text \`${AC_TEXTS[k - 1]}\` — got: ${JSON.stringify(row)}`,
    );
    // exactly the verdict acResults dictate, and it is one of the permitted tokens.
    const expected = EXPECTED_VERDICT.get(k)!;
    assert.ok(
      row!.includes(expected),
      `AC #${k}'s row must carry the verdict \`${expected}\` — got: ${JSON.stringify(row)}`,
    );
    assert.ok(
      VERDICTS.some((t) => row!.includes(t)),
      `AC #${k}'s row must carry one of the permitted verdict tokens`,
    );
  }
});

// ── AC2: no row is a bare `#N` — every ordinal-bearing row also carries criterion text ─────
//
// The explicit negative half of the AC. Strip the ordinal token, the verdict glyphs, and the
// row's dash/table separators from every ordinal-bearing row: what's LEFT must be non-empty (the
// criterion) — a bare `#N` row would strip down to nothing. And that residue must in fact be the
// AC's own criterion text.

test("AC2: no AC row is a bare #N — every ordinal-bearing row carries its criterion text", () => {
  const report = buildDeliveryReport(buildInput());
  const section = acSection(report);

  const ordinalRows = section.split(/\r?\n/).filter((l) => /#\d+/.test(l));
  assert.equal(
    ordinalRows.length,
    DECLARED.length,
    "there must be exactly one ordinal-bearing row per declared AC",
  );

  for (const row of ordinalRows) {
    const k = Number(/#(\d+)/.exec(row)![1]);
    const residue = row
      .replace(/#\d+/g, "") // the ordinal token
      .replace(/✓ pass|✗ fail|· not run/g, "") // the verdict token
      .replace(/[|—–·]/g, "") // table pipes / em-en dashes / mid-dot separators
      .trim();
    assert.ok(
      residue.length > 0,
      `AC #${k}'s row must NOT be a bare ordinal (no criterion text): ${JSON.stringify(row)}`,
    );
    assert.ok(
      row.includes(AC_TEXTS[k - 1]),
      `AC #${k}'s ordinal-bearing row must carry its criterion text: ${JSON.stringify(row)}`,
    );
  }
});

// ── AC2: the ordinal → criterion pairing is correct (no off-by-one) ─────────────────
//
// acTexts[k-1] ↔ AC k: guard against a shift where every row carries the WRONG criterion. The
// three criterion strings are mutually distinct, so pairing AC k with anything but acTexts[k-1]
// would put a foreign string on the row.

test("AC2: acTexts[k-1] pairs with AC k — the criterion on each row is the right one, not a shifted neighbour", () => {
  const report = buildDeliveryReport(buildInput());
  const section = acSection(report);

  for (const v of DECLARED) {
    const k = v.ac;
    const row = rowForAc(section, k)!;
    assert.ok(
      row.includes(AC_TEXTS[k - 1]),
      `AC #${k} carries acTexts[${k - 1}]`,
    );
    // it must NOT carry a DIFFERENT AC's criterion text (no shift / duplication).
    for (let j = 0; j < AC_TEXTS.length; j++) {
      if (j === k - 1) continue;
      assert.ok(
        !row.includes(AC_TEXTS[j]),
        `AC #${k}'s row must not carry the criterion for AC ${j + 1}: ${JSON.stringify(row)}`,
      );
    }
  }
});
