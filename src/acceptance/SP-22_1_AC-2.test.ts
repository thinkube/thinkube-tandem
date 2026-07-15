// SP-22/1 AC-2 — Pure aggregation of defect rows is correct and fail-soft on bad data.
//
// WHY (INVARIANT): Given a fixture log with known rows across two months, mixed types
// and triggers (including one unknown trigger), plus two malformed JSONL lines:
//   - parseDefectLog yields exactly the valid rows, counts exactly the malformed lines, never throws
//   - typeByMonth groups counts by YYYY-MM then by type, exact per-cell values
//   - catchPointCurve orders known triggers by TRIGGER_ORDER (unknown triggers last, alphabetical)
//   - integrityList returns only impact==="integrity" rows, newest first
//   - an empty/absent text yields empty tables and zero errors
// This must hold for the life of the code: any change to the aggregation logic that alters
// counts, ordering, or error handling must break this test.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseDefectLog,
  typeByMonth,
  catchPointCurve,
  integrityList,
  TRIGGER_ORDER,
} from "../services/defectStats";
import type { DefectRow } from "../services/defectStats";

// ── Shared fixture ─────────────────────────────────────────────────────────────
// Five well-formed JSONL rows (three in 2026-07, two in 2026-06) followed by two
// malformed lines. Row A2 is the sole integrity row and is neither the newest nor
// oldest — forcing a genuine sort. Row B2 carries a trigger not in TRIGGER_ORDER.
const FIXTURE_TEXT = [
  // 2026-07 rows
  '{"ts":"2026-07-01T10:00:00Z","spec":"22/1","activity":"spec-authoring","trigger":"authoring-time audit","type":"lifecycle definition","impact":"prevented","detail":"A1"}',
  '{"ts":"2026-07-02T11:00:00Z","spec":"22/1","activity":"implementation (code)","trigger":"gate-verifier failure","type":"algorithm","impact":"integrity","detail":"A2"}',
  '{"ts":"2026-07-03T12:00:00Z","spec":"22/1","activity":"verify: reporting","trigger":"post-hoc diagnosis","type":"algorithm","impact":"round lost","detail":"A3"}',
  // 2026-06 rows
  '{"ts":"2026-06-15T09:00:00Z","spec":"21/1","activity":"slicing","trigger":"worker flag (⚑)","type":"lifecycle definition","impact":"round lost","detail":"B1"}',
  '{"ts":"2026-06-16T10:00:00Z","spec":"21/1","activity":"slicing","trigger":"UNKNOWN_ZZZ","type":"algorithm","impact":"round lost","detail":"B2"}',
  // Two malformed lines — not parseable as JSON
  "not json at all",
  '{"incomplete":',
].join("\n");

// ── TRIGGER_ORDER export ───────────────────────────────────────────────────────

test("TRIGGER_ORDER is exported as a readonly array with the nine canonical catch-point entries in earliest-to-latest order", () => {
  // The nine triggers the TEP defines, in cheapest-catch-point order.
  const expected = [
    "authoring-time audit",
    "preflight",
    "fence denial / containment",
    "build gate (prepare)",
    "gate-verifier failure",
    "judge contradiction",
    "worker flag (⚑)",
    "human challenge",
    "post-hoc diagnosis",
  ];
  assert.equal(
    TRIGGER_ORDER.length,
    expected.length,
    `TRIGGER_ORDER must have ${expected.length} entries — one per canonical catch-point`,
  );
  for (let i = 0; i < expected.length; i++) {
    assert.equal(
      TRIGGER_ORDER[i],
      expected[i],
      `TRIGGER_ORDER[${i}] must be "${expected[i]}" — canonical catch-point ranking must match the TEP definition exactly`,
    );
  }
});

// ── parseDefectLog ─────────────────────────────────────────────────────────────

test("parseDefectLog: five well-formed rows + two malformed lines → five rows, parseErrors=2, no throw", () => {
  // INVARIANT: fail-soft parsing keeps good rows and counts bad ones; it never throws.
  const result = parseDefectLog(FIXTURE_TEXT);
  assert.equal(
    result.parseErrors,
    2,
    "parseErrors must equal the number of malformed lines (2) — every bad line is counted once",
  );
  assert.equal(
    result.rows.length,
    5,
    "rows must contain exactly the five parseable entries — malformed lines are skipped, not included",
  );
  assert.ok(
    result.rows.every((r) => typeof r.ts === "string" && r.ts.length > 0),
    "every parsed row must carry a non-empty ts field",
  );
});

test("parseDefectLog: empty string → zero rows, zero parseErrors", () => {
  // INVARIANT: an absent or empty log produces empty results, not an error.
  const result = parseDefectLog("");
  assert.equal(result.rows.length, 0, "empty text must yield zero rows");
  assert.equal(
    result.parseErrors,
    0,
    "empty text must yield zero parse errors — there are no lines to fail",
  );
});

test("parseDefectLog: whitespace-only text (no content lines) → zero rows, zero parseErrors", () => {
  const result = parseDefectLog("   \n  \n   ");
  assert.equal(result.rows.length, 0);
  assert.equal(result.parseErrors, 0);
});

test("parseDefectLog: parsed rows carry the expected field values verbatim", () => {
  // INVARIANT: parse must not transform or drop field values — round-trip fidelity.
  const result = parseDefectLog(FIXTURE_TEXT);
  const byDetail = new Map<string, DefectRow>(
    result.rows.map((r) => [r.detail, r]),
  );

  const a1 = byDetail.get("A1");
  assert.ok(a1, "row A1 (detail='A1') must be present");
  assert.equal(a1.ts, "2026-07-01T10:00:00Z");
  assert.equal(a1.activity, "spec-authoring");
  assert.equal(a1.trigger, "authoring-time audit");
  assert.equal(a1.type, "lifecycle definition");
  assert.equal(a1.impact, "prevented");

  const a2 = byDetail.get("A2");
  assert.ok(a2, "row A2 (detail='A2') must be present");
  assert.equal(a2.impact, "integrity");
  assert.equal(a2.type, "algorithm");

  const b2 = byDetail.get("B2");
  assert.ok(
    b2,
    "row B2 (detail='B2') must be present — unknown triggers are not malformed",
  );
  assert.equal(b2.trigger, "UNKNOWN_ZZZ");
});

// ── typeByMonth ────────────────────────────────────────────────────────────────

test("typeByMonth: fixture rows produce exact per-month, per-type counts", () => {
  // INVARIANT: the grouping function must count each row exactly once under the
  // YYYY-MM prefix of its ts field and its type field.
  const { rows } = parseDefectLog(FIXTURE_TEXT);
  const byMonth = typeByMonth(rows);

  // 2026-07: lifecycle definition=1, algorithm=2 (rows A1, A2, A3)
  const jul = byMonth.get("2026-07");
  assert.ok(jul, 'typeByMonth must contain a "2026-07" entry');
  assert.equal(
    jul.get("lifecycle definition"),
    1,
    '2026-07 must have exactly 1 "lifecycle definition" entry (row A1)',
  );
  assert.equal(
    jul.get("algorithm"),
    2,
    '2026-07 must have exactly 2 "algorithm" entries (rows A2 and A3)',
  );
  assert.equal(jul.size, 2, "2026-07 must have exactly two distinct types");

  // 2026-06: lifecycle definition=1, algorithm=1 (rows B1, B2)
  const jun = byMonth.get("2026-06");
  assert.ok(jun, 'typeByMonth must contain a "2026-06" entry');
  assert.equal(
    jun.get("lifecycle definition"),
    1,
    '2026-06 must have exactly 1 "lifecycle definition" entry (row B1)',
  );
  assert.equal(
    jun.get("algorithm"),
    1,
    '2026-06 must have exactly 1 "algorithm" entry (row B2)',
  );
  assert.equal(jun.size, 2, "2026-06 must have exactly two distinct types");

  assert.equal(
    byMonth.size,
    2,
    "typeByMonth must produce exactly two month entries for this fixture",
  );
});

test("typeByMonth: empty row list → empty map", () => {
  // INVARIANT: no rows → no counts.
  const result = typeByMonth([]);
  assert.equal(
    result.size,
    0,
    "typeByMonth of an empty array must be an empty Map",
  );
});

// ── catchPointCurve ────────────────────────────────────────────────────────────

test("catchPointCurve: known triggers ordered by TRIGGER_ORDER, unknown trigger last", () => {
  // INVARIANT: the catch-point curve lists known triggers in the canonical cheapest-first
  // order; unknown triggers follow alphabetically. Only triggers with at least one row appear.
  const { rows } = parseDefectLog(FIXTURE_TEXT);
  const curve = catchPointCurve(rows);

  // Triggers present in fixture:
  //   "authoring-time audit"   → TRIGGER_ORDER index 0   (row A1)
  //   "gate-verifier failure"  → TRIGGER_ORDER index 4   (row A2)
  //   "worker flag (⚑)"        → TRIGGER_ORDER index 6   (row B1)
  //   "post-hoc diagnosis"     → TRIGGER_ORDER index 8   (row A3)
  //   "UNKNOWN_ZZZ"            → not in TRIGGER_ORDER    (row B2 — goes last)

  const labels = curve.map((e) => e.trigger);
  assert.deepStrictEqual(
    labels,
    [
      "authoring-time audit",
      "gate-verifier failure",
      "worker flag (⚑)",
      "post-hoc diagnosis",
      "UNKNOWN_ZZZ",
    ],
    "catchPointCurve must list triggers in TRIGGER_ORDER order with unknown triggers last alphabetically",
  );

  const counts = curve.map((e) => e.count);
  assert.deepStrictEqual(
    counts,
    [1, 1, 1, 1, 1],
    "each trigger in the fixture appears exactly once — counts must all be 1",
  );
});

test("catchPointCurve: multiple rows per trigger → count aggregates correctly", () => {
  // INVARIANT: counts accumulate per trigger across all rows.
  const rows: DefectRow[] = [
    {
      ts: "2026-07-01T00:00:00Z",
      activity: "spec-authoring",
      trigger: "gate-verifier failure",
      impact: "round lost",
      detail: "X",
    },
    {
      ts: "2026-07-02T00:00:00Z",
      activity: "spec-authoring",
      trigger: "gate-verifier failure",
      impact: "round lost",
      detail: "Y",
    },
    {
      ts: "2026-07-03T00:00:00Z",
      activity: "spec-authoring",
      trigger: "authoring-time audit",
      impact: "prevented",
      detail: "Z",
    },
  ];
  const curve = catchPointCurve(rows);
  const byTrigger = new Map(curve.map((e) => [e.trigger, e.count]));
  assert.equal(
    byTrigger.get("authoring-time audit"),
    1,
    '"authoring-time audit" must aggregate to count 1',
  );
  assert.equal(
    byTrigger.get("gate-verifier failure"),
    2,
    '"gate-verifier failure" must aggregate to count 2 (two rows share it)',
  );
  // Canonical order is preserved: authoring-time audit (idx 0) before gate-verifier failure (idx 4)
  assert.ok(
    curve.findIndex((e) => e.trigger === "authoring-time audit") <
      curve.findIndex((e) => e.trigger === "gate-verifier failure"),
    '"authoring-time audit" must precede "gate-verifier failure" — canonical order must hold even when counts differ',
  );
});

test("catchPointCurve: empty rows → empty array", () => {
  assert.deepStrictEqual(
    catchPointCurve([]),
    [],
    "catchPointCurve of an empty array must be an empty array",
  );
});

test("catchPointCurve: multiple unknown triggers sorted alphabetically after all known", () => {
  // INVARIANT: unknown triggers go last and are sorted among themselves.
  const rows: DefectRow[] = [
    {
      ts: "2026-07-01T00:00:00Z",
      activity: "a",
      trigger: "ZULU_UNKNOWN",
      impact: "round lost",
      detail: "x",
    },
    {
      ts: "2026-07-02T00:00:00Z",
      activity: "a",
      trigger: "preflight",
      impact: "prevented",
      detail: "y",
    },
    {
      ts: "2026-07-03T00:00:00Z",
      activity: "a",
      trigger: "ALPHA_UNKNOWN",
      impact: "round lost",
      detail: "z",
    },
  ];
  const curve = catchPointCurve(rows);
  const labels = curve.map((e) => e.trigger);
  // Known triggers first in TRIGGER_ORDER, then unknowns alphabetically
  assert.equal(
    labels[0],
    "preflight",
    "known trigger must come before unknown ones",
  );
  assert.equal(
    labels[1],
    "ALPHA_UNKNOWN",
    "first unknown alphabetically must be second",
  );
  assert.equal(
    labels[2],
    "ZULU_UNKNOWN",
    "second unknown alphabetically must be third",
  );
});

// ── integrityList ──────────────────────────────────────────────────────────────

test("integrityList: only impact==='integrity' rows returned, newest first", () => {
  // INVARIANT: false-green defects (integrity class) get a dedicated, prominently
  // ordered list — newest first so the most recent false green surfaces immediately.
  const { rows } = parseDefectLog(FIXTURE_TEXT);
  const integrity = integrityList(rows);

  // Only row A2 (ts=2026-07-02) has impact="integrity" in this fixture.
  assert.equal(
    integrity.length,
    1,
    "integrityList must return exactly one row (row A2 is the only integrity-impact row)",
  );
  assert.equal(
    integrity[0].detail,
    "A2",
    "the integrity row must be row A2 — only impact==='integrity' rows qualify",
  );
  assert.equal(
    integrity[0].impact,
    "integrity",
    "every row in integrityList must have impact==='integrity'",
  );
});

test("integrityList: multiple integrity rows returned newest-first", () => {
  // INVARIANT: newest-first ordering means the most recent false green is always at [0].
  const rows: DefectRow[] = [
    {
      ts: "2026-06-01T00:00:00Z",
      activity: "a",
      trigger: "gate-verifier failure",
      impact: "integrity",
      detail: "older",
    },
    {
      ts: "2026-07-01T00:00:00Z",
      activity: "b",
      trigger: "gate-verifier failure",
      impact: "integrity",
      detail: "newer",
    },
    {
      ts: "2026-07-02T00:00:00Z",
      activity: "c",
      trigger: "judge contradiction",
      impact: "integrity",
      detail: "newest",
    },
    {
      ts: "2026-05-15T00:00:00Z",
      activity: "d",
      trigger: "post-hoc diagnosis",
      impact: "round lost", // NOT integrity — must be excluded
      detail: "non-integrity",
    },
  ];
  const result = integrityList(rows);
  assert.equal(result.length, 3, "only the three integrity rows must appear");
  assert.equal(
    result[0].detail,
    "newest",
    "newest ts must be first (2026-07-02)",
  );
  assert.equal(
    result[1].detail,
    "newer",
    "second newest must be second (2026-07-01)",
  );
  assert.equal(result[2].detail, "older", "oldest must be last (2026-06-01)");
});

test("integrityList: no integrity rows → empty array", () => {
  // INVARIANT: when there are no false greens, the list is empty (not an error).
  const { rows } = parseDefectLog(
    '{"ts":"2026-07-01T00:00:00Z","activity":"a","trigger":"preflight","impact":"prevented","detail":"x"}\n',
  );
  assert.deepStrictEqual(
    integrityList(rows),
    [],
    "integrityList must be empty when no rows have impact==='integrity'",
  );
});

test("integrityList: empty row list → empty array", () => {
  assert.deepStrictEqual(
    integrityList([]),
    [],
    "integrityList of empty array must be empty",
  );
});
