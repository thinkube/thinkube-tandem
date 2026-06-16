/**
 * Unit tests for the Tandem (3-column) quality gates. Run via `npm test`,
 * which compiles this + its source to out-test/ and runs it with Node's
 * built-in test runner. Pure functions over a Spec body — node:test +
 * node:assert are enough.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  gateForTandemTransition,
  gateSliceDocsToDone,
  gateSliceSatisfiesToDone,
  gateSpecAcceptance,
  resolveDocsObligation,
  runTandemGate,
} from "./qualityGates";

const SPEC_PARTIAL = `# A spec

## Acceptance Criteria

- [ ] First
- [x] Second
`;

const SPEC_ALL_CHECKED = `# A spec

## Acceptance Criteria

- [x] First
- [x] Second
`;

const SPEC_NO_AC = `# A spec

## Design

- something
`;

test("gateSpecAcceptance: refuses while a slice is not Done", () => {
  const r = gateSpecAcceptance({
    specBody: SPEC_ALL_CHECKED,
    sliceStatuses: ["done", "ready"],
  });
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /1 slice is not yet Done/);
});

test("gateSpecAcceptance: refuses while an AC is unchecked", () => {
  const r = gateSpecAcceptance({
    specBody: SPEC_PARTIAL,
    sliceStatuses: ["done"],
  });
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /unchecked/);
});

test("gateSpecAcceptance: refuses a Spec with no acceptance criteria", () => {
  const r = gateSpecAcceptance({
    specBody: SPEC_NO_AC,
    sliceStatuses: ["done"],
  });
  assert.equal(r.ok, false);
});

test("gateSpecAcceptance: passes when all slices Done and all ACs checked", () => {
  const r = gateSpecAcceptance({
    specBody: SPEC_ALL_CHECKED,
    sliceStatuses: ["done", "done"],
  });
  assert.equal(r.ok, true);
});

test("gates are keyed by destination: → Ready and → Done gated, → Doing ungated", () => {
  assert.equal(gateForTandemTransition("Ready"), "to-ready");
  assert.equal(gateForTandemTransition("Done"), "to-done");
  assert.equal(gateForTandemTransition("Doing"), undefined);
});

test("to-ready: passes with an AC checklist, fails when the Spec has none", () => {
  assert.equal(runTandemGate("to-ready", { specBody: SPEC_PARTIAL }).ok, true);
  assert.equal(runTandemGate("to-ready", { specBody: SPEC_NO_AC }).ok, false);
});

test("to-done: passes only when every AC is checked", () => {
  assert.equal(runTandemGate("to-done", { specBody: SPEC_PARTIAL }).ok, false);
  assert.equal(
    runTandemGate("to-done", { specBody: SPEC_ALL_CHECKED }).ok,
    true,
  );
});

test("to-done: fails when the Spec has no AC to verify against", () => {
  assert.equal(runTandemGate("to-done", { specBody: SPEC_NO_AC }).ok, false);
});

// ── Per-slice satisfies gate (SP-6) ──
// SPEC_PARTIAL: #1 "First" unchecked, #2 "Second" checked.

test("satisfies gate: refuses when a satisfied AC is unchecked, naming it", () => {
  const r = gateSliceSatisfiesToDone({
    specBody: SPEC_PARTIAL,
    satisfies: [1],
  });
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /#1/);
  assert.match((r as { reason: string }).reason, /First/);
});

test("satisfies gate: allows when every satisfied AC is checked", () => {
  assert.equal(
    gateSliceSatisfiesToDone({ specBody: SPEC_PARTIAL, satisfies: [2] }).ok,
    true,
  );
  assert.equal(
    gateSliceSatisfiesToDone({ specBody: SPEC_ALL_CHECKED, satisfies: [1, 2] })
      .ok,
    true,
  );
});

test("satisfies gate: a partially-checked set refuses, naming only the unchecked", () => {
  const r = gateSliceSatisfiesToDone({
    specBody: SPEC_PARTIAL,
    satisfies: [1, 2],
  });
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /#1/);
  assert.doesNotMatch((r as { reason: string }).reason, /#2/);
});

test("satisfies gate: legacy slice (no satisfies) passes ungated with a skip marker", () => {
  const r = gateSliceSatisfiesToDone({
    specBody: SPEC_PARTIAL,
    satisfies: undefined,
  });
  assert.equal(r.ok, true);
  assert.equal(
    (r as { gateSkipped?: string }).gateSkipped,
    "no satisfies field",
  );
  assert.equal(
    gateSliceSatisfiesToDone({ specBody: SPEC_PARTIAL, satisfies: [] }).ok,
    true,
  );
});

test("satisfies gate: an out-of-range ordinal is refused, not silently passed", () => {
  const r = gateSliceSatisfiesToDone({
    specBody: SPEC_PARTIAL,
    satisfies: [9],
  });
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /#9/);
});

// ── docs obligation (TEP-tgh6iy) ───────────────────────────────────────────

test("docs obligation: defaults to required when omitted (fail closed)", () => {
  const r = resolveDocsObligation({});
  assert.equal(r.ok, true);
  assert.deepEqual((r as { value: unknown }).value, { docs: "required" });
});

test("docs obligation: explicit required ignores any stray reason", () => {
  const r = resolveDocsObligation({ docs: "required", docs_reason: "x" });
  assert.equal(r.ok, true);
  assert.deepEqual((r as { value: unknown }).value, { docs: "required" });
});

test("docs obligation: n/a with a reason is accepted and carries it", () => {
  const r = resolveDocsObligation({
    docs: "n/a",
    docs_reason: "test-only change",
  });
  assert.equal(r.ok, true);
  assert.deepEqual((r as { value: unknown }).value, {
    docs: "n/a",
    docs_reason: "test-only change",
  });
});

test("docs obligation: n/a without a reason is refused", () => {
  const r = resolveDocsObligation({ docs: "n/a" });
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /docs_reason/);
});

test("docs obligation: n/a with a blank reason is refused", () => {
  const r = resolveDocsObligation({ docs: "n/a", docs_reason: "   " });
  assert.equal(r.ok, false);
});

test("docs obligation: an invalid value is refused", () => {
  const r = resolveDocsObligation({ docs: "maybe" });
  assert.equal(r.ok, false);
  assert.match(
    (r as { reason: string }).reason,
    /expected "required" or "n\/a"/,
  );
});

// ── → Done docs gate (TEP-tgh6iy) ──────────────────────────────────────────

test("docs gate: n/a slice is ungated in both modes", () => {
  assert.equal(gateSliceDocsToDone({ docs: "n/a", mode: "blocking" }).ok, true);
  assert.equal(gateSliceDocsToDone({ docs: "n/a", mode: "advisory" }).ok, true);
});

test("docs gate: a legacy slice (no docs field) is ungated", () => {
  assert.equal(gateSliceDocsToDone({ mode: "blocking" }).ok, true);
});

test("docs gate: required + docs_done passes in blocking mode", () => {
  const r = gateSliceDocsToDone({
    docs: "required",
    docsDone: true,
    mode: "blocking",
  });
  assert.equal(r.ok, true);
  assert.equal((r as { warning?: string }).warning, undefined);
});

test("docs gate: required + unsatisfied is REFUSED in blocking mode", () => {
  const r = gateSliceDocsToDone({
    docs: "required",
    docsDone: false,
    mode: "blocking",
  });
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /docs_done/);
});

test("docs gate: required + unsatisfied PASSES with a warning in advisory mode", () => {
  const r = gateSliceDocsToDone({ docs: "required", mode: "advisory" });
  assert.equal(r.ok, true);
  assert.match((r as { warning?: string }).warning ?? "", /advisory/);
});

// ── Done gate is UNCHANGED under worktree parallelism (SP-tgpwbm AC6) ───────
// Parallel slices run in isolated worktrees and verify there, but the → Done
// gate's contract must not change: it still refuses Done while a satisfied AC is
// unchecked and allows it once checked. This pins that contract so a regression
// is caught — SP-tgpwbm changes *where* the verifier runs, never the gate.

test("AC6: the → Done gate still refuses while a satisfied AC is unchecked", () => {
  // SPEC_PARTIAL: #1 unchecked, #2 checked.
  const r = gateSliceSatisfiesToDone({
    specBody: SPEC_PARTIAL,
    satisfies: [1],
  });
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /#1/);
});

test("AC6: the → Done gate still allows once every satisfied AC is checked", () => {
  assert.equal(
    gateSliceSatisfiesToDone({ specBody: SPEC_ALL_CHECKED, satisfies: [1, 2] })
      .ok,
    true,
  );
});
