// SP-21/1 AC-5 — Readiness is grounded in a non-committing dry run.
//
// The readiness check runs the downstream slicer WITHOUT writing any slice files.
// When the slicer cannot cut a clean contract it names the offending section via
// gapSection, and the Freeze control stays disabled. The dry run returns only a
// verdict (cleanCut/gapSection) and a proposed decomposition — it never calls
// create_slice.
//
// All tests here are INVARIANT — this is a standing gate, not a one-time change.

import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce, freezeEnabled } from "../scratchpad/model";
import type { WorkingModel } from "../scratchpad/model";
import { dryRunSlice, toReadinessRecord } from "../scratchpad/dryRunSlice";
import type { DryRunResult } from "../scratchpad/dryRunSlice";

// ── dryRunSlice: non-committing invocation via injected runSlicer ─────────────

// WHY INVARIANT: dryRunSlice must pass the goal section text as the slicer intent and
// call runSlicer exactly once. The stub never writes files, proving the non-committing
// contract: if create_slice were called, it would have to go through this seam — which
// the test controls entirely.
test("dryRunSlice calls runSlicer exactly once with the goal section text (INVARIANT: non-committing via stub)", async () => {
  let slicerCallCount = 0;
  let capturedIntent = "";

  const { model } = reduce(emptyModel("tep"), {
    type: "seedGoal",
    text: "build the scratchpad surface",
  });

  const result = await dryRunSlice(model, {
    runSlicer: async (intent) => {
      slicerCallCount++;
      capturedIntent = intent;
      // The stub returns a clean result without writing any files.
      return {
        cleanCut: true,
        gapSection: null,
        decomposition: ["SL-1", "SL-2"],
      };
    },
  });

  assert.equal(
    slicerCallCount,
    1,
    "runSlicer must be called exactly once per dry run",
  );
  assert.equal(
    capturedIntent,
    "build the scratchpad surface",
    "runSlicer must receive the goal section text as its intent argument",
  );
  assert.equal(result.cleanCut, true);
  assert.deepEqual(result.decomposition, ["SL-1", "SL-2"]);
});

// WHY INVARIANT: dryRunSlice must pass ONLY the goal text to the slicer — not notes,
// not other sections, not the full model JSON. The slicer's intent is exactly what the
// person typed as the goal; everything else is scratchpad-internal context.
test("dryRunSlice passes only the goal section text to runSlicer — not notes, not constraints (INVARIANT)", async () => {
  let capturedIntent = "";

  // Build a model with a goal, a proposed section, and a note on the goal.
  const base = emptyModel("tep");
  const { model: m1 } = reduce(base, {
    type: "seedGoal",
    text: "the canonical goal text",
  });
  const { model: m2 } = reduce(m1, {
    type: "proposeSection",
    kind: "constraints",
    text: "some constraint text",
    workerId: "w-1",
  });
  const { model: m3 } = reduce(m2, {
    type: "addNote",
    sectionId: "sec-0",
    text: "a clarifying note",
  });

  await dryRunSlice(m3, {
    runSlicer: async (intent) => {
      capturedIntent = intent;
      return { cleanCut: true, gapSection: null, decomposition: ["SL-1"] };
    },
  });

  assert.equal(
    capturedIntent,
    "the canonical goal text",
    "runSlicer must receive exactly the goal text — not notes, constraints, or the full model",
  );
});

// ── dryRunSlice: propagates gap information from the slicer ──────────────────

// WHY INVARIANT: when the slicer cannot cut a clean contract it must name the offending
// section. dryRunSlice must propagate gapSection verbatim — silencing or replacing it
// would hide a real gap from the readiness view and the user.
test("dryRunSlice propagates cleanCut=false and gapSection when the slicer cannot cut (INVARIANT: gap is named, not silenced)", async () => {
  const { model } = reduce(emptyModel("tep"), {
    type: "seedGoal",
    text: "underspecified intent with no clear constraints",
  });

  const result = await dryRunSlice(model, {
    runSlicer: async (_intent) => ({
      cleanCut: false,
      gapSection: "constraints" as const,
      decomposition: [],
    }),
  });

  assert.equal(
    result.cleanCut,
    false,
    "cleanCut=false must propagate from the slicer",
  );
  assert.equal(
    result.gapSection,
    "constraints",
    "the named gap section must propagate verbatim — not be nulled or lost",
  );
  assert.deepEqual(result.decomposition, []);
});

// WHY INVARIANT: even when the gap points at 'verification', the most semantically
// specific section kind, it must propagate without substitution. The gap naming is exact.
test("dryRunSlice propagates whichever gapSection the slicer returns — no substitution (INVARIANT)", async () => {
  const { model } = reduce(emptyModel("tep"), {
    type: "seedGoal",
    text: "intent missing verification detail",
  });

  const result = await dryRunSlice(model, {
    runSlicer: async (_intent) => ({
      cleanCut: false,
      gapSection: "verification" as const,
      decomposition: [],
    }),
  });

  assert.equal(result.gapSection, "verification");
});

// ── freeze blocked when cleanCut=false ────────────────────────────────────────

// WHY INVARIANT: a gapped dry run (cleanCut=false) must keep freeze disabled even when
// every section is covered. Both halves of the readiness gate — coverage AND a clean cut
// — must pass independently; a clean coverage state cannot compensate for a slicer gap.
test("toReadinessRecord + freezeEnabled: a gapped dry run keeps freeze disabled even when all sections are covered (INVARIANT)", async () => {
  const allCoveredModel: WorkingModel = {
    tenant: "tep",
    phase: "ready",
    sections: [
      {
        id: "sec-0",
        kind: "goal",
        text: "goal text",
        state: "settled",
        coverage: "verified",
        notes: [],
        proposals: [],
      },
      {
        id: "sec-1",
        kind: "constraints",
        text: "constraints text",
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
    gapSection: "criteria",
    decomposition: [],
  };

  const record = toReadinessRecord(allCoveredModel, gappedDry);
  assert.equal(record.covered, true, "fully-verified model gives covered=true");
  assert.equal(record.cleanCut, false, "gapped dry run gives cleanCut=false");
  assert.equal(
    record.gapSection,
    "criteria",
    "gapSection names the offending section",
  );

  const { model: withRecord } = reduce(allCoveredModel, {
    type: "recordReadiness",
    record,
  });
  assert.equal(
    freezeEnabled(withRecord),
    false,
    "freeze must stay disabled when the dry run is not clean — even if all sections are covered",
  );
});

// WHY INVARIANT: the dry run and coverage gate are two distinct checks. Freeze is enabled
// only when BOTH pass. This test confirms the clean path: all covered AND slicer is clean.
test("toReadinessRecord + freezeEnabled: all covered AND clean dry run enables freeze (INVARIANT: both gates must pass)", () => {
  const allCoveredModel: WorkingModel = {
    tenant: "tep",
    phase: "ready",
    sections: [
      {
        id: "sec-0",
        kind: "goal",
        text: "goal text",
        state: "settled",
        coverage: "verified",
        notes: [],
        proposals: [],
      },
    ],
    objections: [],
    readinessHistory: [],
  };

  const cleanDry: DryRunResult = {
    cleanCut: true,
    gapSection: null,
    decomposition: ["SL-1", "SL-2"],
  };

  const record = toReadinessRecord(allCoveredModel, cleanDry);
  assert.equal(record.covered, true);
  assert.equal(record.cleanCut, true);
  assert.equal(record.gapSection, null);

  const { model: withRecord } = reduce(allCoveredModel, {
    type: "recordReadiness",
    record,
  });
  assert.equal(
    freezeEnabled(withRecord),
    true,
    "freeze must be enabled when all sections are covered AND the dry run cuts clean",
  );
});

// WHY INVARIANT: the dry run result includes the proposed decomposition. This is what the
// readiness view shows the person before they decide to freeze. dryRunSlice must return it
// intact so the view can display it — silencing it would hide the proposed work breakdown.
test("dryRunSlice returns the decomposition from the slicer for display in the readiness view (INVARIANT)", async () => {
  const { model } = reduce(emptyModel("tep"), {
    type: "seedGoal",
    text: "well-formed intent",
  });

  const result = await dryRunSlice(model, {
    runSlicer: async (_intent) => ({
      cleanCut: true,
      gapSection: null,
      decomposition: ["SL-1: Data model", "SL-2: Workers", "SL-3: Freeze"],
    }),
  });

  assert.deepEqual(
    result.decomposition,
    ["SL-1: Data model", "SL-2: Workers", "SL-3: Freeze"],
    "the decomposition from the slicer must be returned intact for display in the readiness view",
  );
});
