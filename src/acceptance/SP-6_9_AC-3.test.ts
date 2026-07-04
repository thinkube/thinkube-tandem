/**
 * SP-6/9 (TEP-6) AC3 — The verification trace records the judged fault kind per red AC,
 * `contract` included, so a contract-caused red is auditable after the fact.
 *
 * Exercised strictly through the contract's public interface:
 *   - `buildVerificationTrace` + its input/entry shapes (`VerificationTraceInput`,
 *     `VerificationTraceEntry`, `AcVerification`, `AcResult`) and the widened `Fault`
 *     from src/services/orchestratorCore.ts.
 *
 * What these tests pin (per the SP-6/9 contract on `buildVerificationTrace`):
 *   • EXACTLY ONE entry per `acResults` element, in that order.
 *   • verdict = pass ? "pass" : "fail".
 *   • `route` is taken from `routes` keyed by the entry's `.ac` VALUE and set ONLY on a
 *     FAILED entry — a `"contract"` route (the widened Fault kind) flows through unchanged.
 *   • A PASSING AC in the same run carries NO `route`, even when a route exists for it in the map.
 *
 * The point of AC3 is auditability: after a red judged `fault: contract`, the durable trace
 * must name that exact route on the failed AC (never on a green one). Both the `Map` and the
 * `Record` forms of `routes` (the union the contract accepts) are covered.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildVerificationTrace,
  type AcVerification,
  type AcResult,
  type Fault,
  type VerificationTraceInput,
  type VerificationTraceEntry,
} from "../services/orchestratorCore";

// ── fixtures ──────────────────────────────────────────────────────────────────

// A run over two ACs: AC #1 failed and was judged a CONTRACT fault; AC #2 passed.
const DECLARED: AcVerification[] = [
  { ac: 1, run: "npm run test:ac1", env: "local" },
  { ac: 2, run: "npm run test:ac2", env: "local" },
];

const AC_RESULTS: AcResult[] = [
  {
    ac: 1,
    pass: false,
    evidence:
      "$ npm run test:ac1 → exit 1\nboth hands conform; red pivots on an undefined seam",
  },
  { ac: 2, pass: true, evidence: "$ npm run test:ac2 → exit 0" },
];

/** The judged route for the red AC — the NEW `contract` fault kind (SP-6/9). Only the failed
 *  AC #1 is keyed; the passing AC #2 is intentionally absent so it carries no route. */
const CONTRACT_ROUTE: Fault = "contract";

const entryFor = (
  trace: VerificationTraceEntry[],
  ac: number,
): VerificationTraceEntry => {
  const matches = trace.filter((e) => e.ac === ac);
  assert.equal(
    matches.length,
    1,
    `exactly one trace entry per AC result — AC #${ac} appears ${matches.length} time(s)`,
  );
  return matches[0];
};

// ── 1. the red AC records verdict "fail" + route "contract" (Map form) ────────

test("a red AC judged a contract fault records verdict 'fail' and route 'contract'", () => {
  const input: VerificationTraceInput = {
    round: 2,
    declared: DECLARED,
    acResults: AC_RESULTS,
    routes: new Map<number, Fault>([[1, CONTRACT_ROUTE]]),
  };

  const trace = buildVerificationTrace(input);

  // EXACTLY ONE entry per acResults element, in that order.
  assert.equal(trace.length, AC_RESULTS.length, "one entry per AC result");
  assert.deepEqual(
    trace.map((e) => e.ac),
    AC_RESULTS.map((r) => r.ac),
    "entries preserve acResults order, one per element",
  );

  // The single entry for the red AC #1: fail + the contract route, verbatim.
  const red = entryFor(trace, 1);
  assert.equal(red.verdict, "fail", "the failed AC's verdict is 'fail'");
  assert.equal(
    red.route,
    "contract",
    "the widened `contract` fault flows through onto the failed AC's trace entry unchanged",
  );
});

// ── 2. a passing AC in the same run carries NO route ──────────────────────────

test("a passing AC in the same run carries no route", () => {
  const input: VerificationTraceInput = {
    round: 2,
    declared: DECLARED,
    acResults: AC_RESULTS,
    routes: new Map<number, Fault>([[1, CONTRACT_ROUTE]]),
  };

  const green = entryFor(buildVerificationTrace(input), 2);
  assert.equal(green.verdict, "pass", "the passing AC's verdict is 'pass'");
  assert.equal(
    green.route,
    undefined,
    "a passing AC carries no route — route is recorded only on a failed AC",
  );
  assert.ok(
    !("route" in green) || green.route === undefined,
    "the passing AC's entry has no meaningful `route` field",
  );
});

// ── 3. route is attached ONLY to the failed entry, even when the map keys a pass ──

test("route is keyed by ac value and set only on the failed entry", () => {
  // The routes map keys BOTH ACs — a route even for the passing AC #2. The contract says
  // route is set ONLY on a failed entry, so AC #2 must still carry none.
  const input: VerificationTraceInput = {
    round: 2,
    declared: DECLARED,
    acResults: AC_RESULTS,
    routes: new Map<number, Fault>([
      [1, "contract"],
      [2, "code"],
    ]),
  };

  const trace = buildVerificationTrace(input);
  assert.equal(
    entryFor(trace, 1).route,
    "contract",
    "failed AC keeps its route",
  );
  assert.equal(
    entryFor(trace, 2).route,
    undefined,
    "a route in the map for a PASSING AC is not attached — routes decorate reds only",
  );
});

// ── 4. the Record form of `routes` behaves identically (union coverage) ───────

test("the contract route flows through the Record form of `routes` too", () => {
  const routes: Record<number, Fault> = { 1: "contract" };
  const trace = buildVerificationTrace({
    round: (ac) => ac, // per-AC round lookup — the other accepted `round` form
    declared: DECLARED,
    acResults: AC_RESULTS,
    routes,
  });

  const red = entryFor(trace, 1);
  assert.equal(red.verdict, "fail");
  assert.equal(
    red.route,
    "contract",
    "a `contract` route resolves the same via a Record keyed by ac value",
  );
  assert.equal(red.round, 1, "the per-AC round function is honoured for AC #1");
  assert.equal(
    entryFor(trace, 2).route,
    undefined,
    "the green AC carries no route",
  );
});
