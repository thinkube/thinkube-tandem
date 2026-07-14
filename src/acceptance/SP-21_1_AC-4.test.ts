// SP-21/1 AC-4 — Coverage gate blocks a premature freeze.
//
// A section that is not yet sufficiently characterized (coverage != 'verified') is
// reported as uncovered ("red"), and the Freeze control must be disabled while any
// section is red. Only when every section's coverage reaches 'verified' AND the dry
// run cuts clean may freeze become enabled.
//
// All tests here are INVARIANT — this is a standing gate, not a one-time change.

import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce, freezeEnabled } from "../scratchpad/model";
import type { WorkingModel } from "../scratchpad/model";
import { uncoveredSections } from "../scratchpad/coverage";
import { toReadinessRecord } from "../scratchpad/dryRunSlice";
import type { DryRunResult } from "../scratchpad/dryRunSlice";

// ── uncoveredSections: identifies red sections by coverage field ───────────────

// WHY INVARIANT: A section whose coverage is 'unknown' (the initial state) is red.
// emptyModel starts with one goal section at coverage='unknown'; it must appear in the result.
test("uncoveredSections reports the goal section as uncovered in a freshly-created model (INVARIANT)", () => {
  const model = emptyModel("tep");
  const reds = uncoveredSections(model);
  assert.ok(
    reds.includes("goal"),
    "a goal section with coverage 'unknown' must be reported as uncovered",
  );
  assert.equal(
    reds.length,
    1,
    "only the one initial section should be uncovered",
  );
});

// WHY INVARIANT: 'assumed' coverage is still red — only 'verified' turns a section green.
// The distinction matters: a proposer or gap-filler may mark a section 'assumed' without
// full verification; that must not silently satisfy the coverage gate.
test("uncoveredSections treats coverage='assumed' as red — only 'verified' is green (INVARIANT)", () => {
  const model: WorkingModel = {
    tenant: "tep",
    phase: "shaping",
    sections: [
      {
        id: "sec-0",
        kind: "goal",
        text: "build the scratchpad",
        state: "settled",
        coverage: "assumed",
        notes: [],
        proposals: [],
      },
      {
        id: "sec-1",
        kind: "criteria",
        text: "some criteria",
        state: "settled",
        coverage: "verified",
        notes: [],
        proposals: [],
      },
    ],
    objections: [],
    readinessHistory: [],
  };
  const reds = uncoveredSections(model);
  assert.ok(
    reds.includes("goal"),
    "'assumed' coverage must appear in uncoveredSections — it is still red",
  );
  assert.ok(
    !reds.includes("criteria"),
    "'verified' coverage must NOT appear in uncoveredSections — it is green",
  );
  assert.equal(reds.length, 1);
});

// WHY INVARIANT: when all sections are 'verified' the coverage is fully green and
// uncoveredSections returns an empty array — the first half of the freeze gate passes.
test("uncoveredSections returns empty when every section has coverage='verified' (INVARIANT)", () => {
  const model: WorkingModel = {
    tenant: "tep",
    phase: "ready",
    sections: [
      {
        id: "sec-0",
        kind: "goal",
        text: "goal",
        state: "settled",
        coverage: "verified",
        notes: [],
        proposals: [],
      },
      {
        id: "sec-1",
        kind: "constraints",
        text: "constraints",
        state: "settled",
        coverage: "verified",
        notes: [],
        proposals: [],
      },
      {
        id: "sec-2",
        kind: "criteria",
        text: "criteria",
        state: "settled",
        coverage: "verified",
        notes: [],
        proposals: [],
      },
    ],
    objections: [],
    readinessHistory: [],
  };
  assert.deepEqual(
    uncoveredSections(model),
    [],
    "all sections verified → uncoveredSections must return []",
  );
});

// ── freezeEnabled: blocked until readiness history exists ─────────────────────

// WHY INVARIANT: without a readiness check the system has not confirmed coverage or a
// clean cut — freezeEnabled must return false so the freeze control stays locked until
// the readiness view has been run at least once.
test("freezeEnabled returns false when no readiness check has been recorded (INVARIANT)", () => {
  const model = emptyModel("tep");
  assert.equal(
    freezeEnabled(model),
    false,
    "no readiness history → freeze must be disabled (the gate requires at least one check)",
  );
});

// ── toReadinessRecord: coverage flag propagates through to freezeEnabled ──────

// WHY INVARIANT: toReadinessRecord is the bridge between the live model state and the
// readiness record the app stores. When any section is uncovered it must set covered=false,
// and recording that result must keep freeze disabled — even if the dry run is clean.
test("toReadinessRecord sets covered=false when sections are uncovered; recording it keeps freeze disabled (INVARIANT)", () => {
  // Fresh model: goal section has coverage='unknown'.
  const model = emptyModel("tep");
  const cleanDry: DryRunResult = {
    cleanCut: true,
    gapSection: null,
    decomposition: ["SL-1", "SL-2"],
  };

  const record = toReadinessRecord(model, cleanDry);
  assert.equal(
    record.covered,
    false,
    "an uncovered section must make covered=false in the readiness record",
  );
  assert.equal(record.cleanCut, true);
  assert.equal(record.gapSection, null);

  const { model: withRecord } = reduce(model, {
    type: "recordReadiness",
    record,
  });
  assert.equal(
    freezeEnabled(withRecord),
    false,
    "recording covered=false must keep freeze disabled — a clean dry run cannot compensate for red sections",
  );
});

// WHY INVARIANT: freeze must be disabled if covered=false regardless of cleanCut — and
// if cleanCut=false regardless of covered. Both halves of the gate must independently pass.
test("freezeEnabled remains false when covered=false even if cleanCut=true (INVARIANT: coverage gate is independent)", () => {
  const { model } = reduce(emptyModel("tep"), {
    type: "recordReadiness",
    record: { covered: false, cleanCut: true, gapSection: null },
  });
  assert.equal(
    freezeEnabled(model),
    false,
    "covered=false blocks freeze even when the dry run is clean",
  );
});

test("freezeEnabled remains false when cleanCut=false even if covered=true (INVARIANT: dry-run gate is independent)", () => {
  const { model } = reduce(emptyModel("tep"), {
    type: "recordReadiness",
    record: { covered: true, cleanCut: false, gapSection: "constraints" },
  });
  assert.equal(
    freezeEnabled(model),
    false,
    "cleanCut=false blocks freeze even when all sections are covered",
  );
});

// WHY INVARIANT: freeze is enabled exactly when the LATEST readiness record has both
// covered=true AND cleanCut=true. This is the only combination that opens the gate.
test("freezeEnabled becomes true only when the latest record has both covered=true and cleanCut=true (INVARIANT)", () => {
  const { model: m1 } = reduce(emptyModel("tep"), {
    type: "recordReadiness",
    record: { covered: true, cleanCut: true, gapSection: null },
  });
  assert.equal(
    freezeEnabled(m1),
    true,
    "covered=true AND cleanCut=true → freeze must be enabled",
  );
});

// WHY INVARIANT: only the LATEST readiness record counts. If the person edits a section
// after a passing check, a subsequent failing check must re-close the gate. A stale
// passing record must never leave the freeze control open after a model change.
test("freezeEnabled uses only the latest readiness record — a subsequent failing check overrides a prior pass (INVARIANT)", () => {
  // First check: passing.
  const { model: m1 } = reduce(emptyModel("tep"), {
    type: "recordReadiness",
    record: { covered: true, cleanCut: true, gapSection: null },
  });
  assert.equal(freezeEnabled(m1), true, "gate open after first passing check");

  // Person edits sections; the next readiness run fails (some coverage went red again).
  const { model: m2 } = reduce(m1, {
    type: "recordReadiness",
    record: { covered: false, cleanCut: true, gapSection: null },
  });
  assert.equal(
    freezeEnabled(m2),
    false,
    "a subsequent failing check must close the gate — only the latest record counts",
  );
});

// WHY INVARIANT: toReadinessRecord copies cleanCut and gapSection verbatim from the dry run.
// This ensures the named gap the slicer found is preserved through to the readiness record
// the app displays and stores — no information about the failing section is lost.
test("toReadinessRecord copies cleanCut and gapSection verbatim from the dry-run result (INVARIANT)", () => {
  const allCoveredModel: WorkingModel = {
    tenant: "tep",
    phase: "ready",
    sections: [
      {
        id: "sec-0",
        kind: "goal",
        text: "goal",
        state: "settled",
        coverage: "verified",
        notes: [],
        proposals: [],
      },
    ],
    objections: [],
    readinessHistory: [],
  };
  const gappedDry: DryRunResult = {
    cleanCut: false,
    gapSection: "constraints",
    decomposition: [],
  };
  const record = toReadinessRecord(allCoveredModel, gappedDry);
  assert.equal(
    record.covered,
    true,
    "all sections verified → covered must be true",
  );
  assert.equal(
    record.cleanCut,
    false,
    "cleanCut must be copied from the dry run",
  );
  assert.equal(
    record.gapSection,
    "constraints",
    "gapSection must be copied verbatim from the dry run — not nulled or changed",
  );
});
