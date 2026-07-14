// SP-21/1 AC-9 — Freezing over an unresolved objection is recorded, not silent.
//
// If the person freezes while an adversarial objection is still unresolved, the freeze must
// still succeed (the human's choice to freeze stands) but the unresolved objection must be
// captured in markedObjections and rendered into the artifact body — so the artifact's
// provenance is honest. A freeze is NEVER silently clean when objections remain open.
// These are standing invariants: the "surface-don't-hide" posture must survive any refactor.

import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "../scratchpad/model";
import type { WorkingModel } from "../scratchpad/model";
import { freeze } from "../scratchpad/freeze";
import type {
  ApprovalToken,
  FreezeDeps,
  SigningTool,
} from "../scratchpad/freeze";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** A model that satisfies freezeEnabled (covered + cleanCut readiness record). */
function readyModel(): WorkingModel {
  let m = emptyModel("tep");
  ({ model: m } = reduce(m, {
    type: "seedGoal",
    text: "Build the Tandem scratchpad authoring surface",
  }));
  ({ model: m } = reduce(m, {
    type: "recordReadiness",
    record: { covered: true, cleanCut: true, gapSection: null },
  }));
  return m;
}

/** A signing-tool stub that captures the artifact body for inspection. */
function bodySigning(): { body: string; tool: SigningTool } {
  const capture = { body: "" };
  return {
    body: capture.body,
    tool: {
      writeTep: async (args) => {
        capture.body = args.body;
        return { tep: "tep-1" };
      },
    },
  };
}

function simpleSigning(): SigningTool {
  return { writeTep: async () => ({ tep: "tep-1" }) };
}

const APPROVAL: ApprovalToken = { value: "human-tok" };

// ── Tests ─────────────────────────────────────────────────────────────────────

// WHY INVARIANT: an unresolved objection must NOT block a human freeze — the person owns the
// decision to freeze; the objection is surfaced on the artifact, not enforced as a veto.
test("freeze succeeds (does not throw) when an unresolved objection is present", async () => {
  let m = readyModel();
  ({ model: m } = reduce(m, {
    type: "addObjection",
    text: "The constraint gate may be underspecified",
  }));

  const deps: FreezeDeps = {
    approval: APPROVAL,
    signing: simpleSigning(),
    thinkingSpace: "ts-1",
  };

  // Must NOT throw — the human's intent to freeze overrides the open objection.
  const result = await freeze(m, deps);
  assert.ok(
    typeof result.tep === "string",
    "freeze must return a tep reference",
  );
});

// WHY INVARIANT: an unresolved objection is kept in markedObjections so it can be tracked —
// the freeze return value is an honest record of what was unresolved at commit time.
test("freeze with an unresolved objection returns it in markedObjections", async () => {
  let m = readyModel();
  ({ model: m } = reduce(m, {
    type: "addObjection",
    text: "Scope may drift without a constraint gate",
  }));

  const deps: FreezeDeps = {
    approval: APPROVAL,
    signing: simpleSigning(),
    thinkingSpace: "ts-1",
  };

  const result = await freeze(m, deps);

  assert.equal(
    result.markedObjections.length,
    1,
    "exactly one unresolved objection must appear in markedObjections",
  );
  assert.equal(
    result.markedObjections[0].text,
    "Scope may drift without a constraint gate",
  );
  assert.equal(
    result.markedObjections[0].resolved,
    false,
    "the objection in markedObjections must still be unresolved",
  );
});

// WHY INVARIANT: only UNRESOLVED objections go into markedObjections — a resolved objection
// was addressed and must not pollute the artifact's provenance record.
test("a resolved objection is NOT listed in markedObjections", async () => {
  let m = readyModel();
  ({ model: m } = reduce(m, {
    type: "addObjection",
    text: "Initial concern that was later addressed",
  }));
  const objId = m.objections[0].id;
  ({ model: m } = reduce(m, { type: "resolveObjection", id: objId }));

  const deps: FreezeDeps = {
    approval: APPROVAL,
    signing: simpleSigning(),
    thinkingSpace: "ts-1",
  };

  const result = await freeze(m, deps);
  assert.equal(
    result.markedObjections.length,
    0,
    "a resolved objection must not appear in markedObjections",
  );
});

// WHY INVARIANT: with multiple objections where some are resolved and some are not, only the
// unresolved ones are marked — the distinction is tracked at the individual-objection level.
test("only unresolved objections appear in markedObjections when the model has a mix", async () => {
  let m = readyModel();
  ({ model: m } = reduce(m, {
    type: "addObjection",
    text: "Resolved concern",
  }));
  ({ model: m } = reduce(m, {
    type: "addObjection",
    text: "Open concern that remains",
  }));
  // Resolve the first objection only.
  const firstId = m.objections[0].id;
  ({ model: m } = reduce(m, { type: "resolveObjection", id: firstId }));

  const deps: FreezeDeps = {
    approval: APPROVAL,
    signing: simpleSigning(),
    thinkingSpace: "ts-1",
  };

  const result = await freeze(m, deps);

  assert.equal(
    result.markedObjections.length,
    1,
    "only the one unresolved objection must appear",
  );
  assert.equal(result.markedObjections[0].text, "Open concern that remains");
});

// WHY INVARIANT: the unresolved objection text must appear in the artifact body written to the
// signing tool — it is marked on the artifact's provenance, not just in the return value.
test("the signed artifact body contains the unresolved objection text", async () => {
  let m = readyModel();
  ({ model: m } = reduce(m, {
    type: "addObjection",
    text: "Criteria section needs a concrete exit condition",
  }));

  let capturedBody = "";
  const signing: SigningTool = {
    writeTep: async (args) => {
      capturedBody = args.body;
      return { tep: "tep-1" };
    },
  };

  const deps: FreezeDeps = {
    approval: APPROVAL,
    signing,
    thinkingSpace: "ts-1",
  };
  await freeze(m, deps);

  assert.ok(
    capturedBody.includes("Criteria section needs a concrete exit condition"),
    `the unresolved objection text must appear in the artifact body; body was:\n${capturedBody}`,
  );
});

// WHY INVARIANT: markedObjections is empty (not undefined, not absent) when all objections
// are resolved — the caller can safely iterate it without a guard.
test("markedObjections is an empty array (not absent) when no objections are unresolved", async () => {
  const m = readyModel(); // no objections at all

  const deps: FreezeDeps = {
    approval: APPROVAL,
    signing: simpleSigning(),
    thinkingSpace: "ts-1",
  };

  const result = await freeze(m, deps);
  assert.ok(
    Array.isArray(result.markedObjections),
    "markedObjections must be an array even when there are no unresolved objections",
  );
  assert.equal(result.markedObjections.length, 0);
});
