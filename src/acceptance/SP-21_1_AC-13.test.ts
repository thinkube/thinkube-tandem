// SP-21/1 AC-13 — The artifact projection is tenant-parameterized.
//
// The step that turns the settled working model into a delivered artifact is parameterized by
// tenant — `project(model, tenant)`. The TEP tenant produces a `# TEP — <title>` document
// containing the canonical TEP section headers; the spec tenant is a named second tenant on
// the same seam. The parameterization is a permanent, explicit contract: adding more tenants
// later must stay mechanical, and the TEP shape must not silently change.

import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "../scratchpad/model";
import type { WorkingModel } from "../scratchpad/model";
import { project, FROZEN_TEP_STATUS } from "../scratchpad/projection";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** A model with a seeded (non-empty) goal section. */
function modelWithGoal(goalText: string): WorkingModel {
  let m = emptyModel("tep");
  ({ model: m } = reduce(m, { type: "seedGoal", text: goalText }));
  return m;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// WHY INVARIANT: project(model, 'tep') must return markdown that begins '# TEP — <goal title>'
// so the frozen artifact is recognisable as a TEP by every downstream consumer.
test("project with 'tep' tenant returns markdown beginning '# TEP — <goal title>'", () => {
  const m = modelWithGoal("Introduce the scratchpad authoring surface");
  const output = project(m, "tep");

  assert.ok(
    output.startsWith("# TEP — "),
    `TEP projection must start with '# TEP — '; got: ${JSON.stringify(output.slice(0, 60))}`,
  );
  assert.ok(
    output.includes("Introduce the scratchpad authoring surface"),
    "the goal title must appear in the TEP projection",
  );
});

// WHY INVARIANT: project takes `tenant` as an explicit second parameter — different tenants
// produce structurally different output. If the tenant argument were ignored the seam would be
// an illusion and adding a new tenant would silently produce the wrong artifact.
test("project produces different markdown for 'tep' and 'spec' tenants given the same model", () => {
  const m = modelWithGoal("A shared goal for both tenants");
  const tepOutput = project(m, "tep");
  const specOutput = project(m, "spec");

  assert.notEqual(
    tepOutput,
    specOutput,
    "TEP and spec projections must differ — the tenant parameter must be honoured",
  );
  assert.ok(
    tepOutput.startsWith("# TEP — "),
    "TEP tenant must begin with '# TEP — '",
  );
  assert.ok(
    !tepOutput.startsWith("# Spec"),
    "TEP projection must not begin with '# Spec'",
  );
});

// WHY INVARIANT: the TEP projection must contain ALL canonical TEP section headers in the
// output so the frozen artifact conforms to the expected TEP document shape consumers rely on.
test("project with 'tep' tenant contains every canonical TEP section header", () => {
  const m = modelWithGoal("Canonical header coverage check");
  const output = project(m, "tep");

  const expectedHeaders = [
    "## Goal",
    "## User Expectation",
    "## Context",
    "## Decision",
    "## Detailed Description",
    "## Consequences",
    "## Alternatives Considered",
    "## Implemented By",
  ];

  for (const header of expectedHeaders) {
    assert.ok(
      output.includes(header),
      `TEP projection must contain the canonical header: ${header}`,
    );
  }
});

// WHY INVARIANT: settled sections are rendered into their corresponding TEP headers —
// a settled 'goal' section populates '## Goal', not an empty placeholder.
test("settled sections appear under their mapped TEP headers in the projection", () => {
  let m = emptyModel("tep");
  ({ model: m } = reduce(m, {
    type: "seedGoal",
    text: "Surface the working model as a TEP",
  }));
  // Propose and settle a constraints section.
  ({ model: m } = reduce(m, {
    type: "proposeSection",
    kind: "constraints",
    text: "Must run inside the thinkube-tandem extension",
    workerId: "worker-0",
  }));
  const constraintId = m.sections.find((s) => s.kind === "constraints")!.id;
  ({ model: m } = reduce(m, {
    type: "setSectionState",
    id: constraintId,
    state: "settled",
  }));

  const output = project(m, "tep");

  assert.ok(
    output.includes("Must run inside the thinkube-tandem extension"),
    "the settled constraints section text must appear in the TEP projection",
  );
});

// WHY INVARIANT: FROZEN_TEP_STATUS must be the literal string 'proposed' — the signing tool
// and TEP workflow consumers depend on this exact value; any change silently breaks the pipeline.
test("FROZEN_TEP_STATUS is the string 'proposed'", () => {
  assert.equal(
    FROZEN_TEP_STATUS,
    "proposed",
    "FROZEN_TEP_STATUS must be 'proposed'",
  );
});

// WHY INVARIANT: the goal title in the artifact heading is derived from the model's goal
// section text — the heading is not invented or sourced from outside the model.
test("project uses the goal section text as the artifact title, not a static default", () => {
  const m = modelWithGoal("A uniquely identifiable goal phrase XYZ");
  const output = project(m, "tep");

  assert.ok(
    output.includes("A uniquely identifiable goal phrase XYZ"),
    "the artifact heading must contain the goal section text verbatim",
  );
});

// WHY INVARIANT: sections that are NOT settled must not pollute the projection —
// only settled content is canonical; proposed/empty/shaping sections are still in-flight.
test("unsettled sections do not appear in the TEP projection body", () => {
  let m = emptyModel("tep");
  ({ model: m } = reduce(m, { type: "seedGoal", text: "Settled goal title" }));
  // Add a proposed (unsettled) section with a unique marker.
  ({ model: m } = reduce(m, {
    type: "proposeSection",
    kind: "criteria",
    text: "UNSETTLED_CRITERIA_MARKER_DO_NOT_INCLUDE",
    workerId: "w-1",
  }));
  // Leave it in 'proposed' state — do NOT settle it.

  const output = project(m, "tep");

  assert.ok(
    !output.includes("UNSETTLED_CRITERIA_MARKER_DO_NOT_INCLUDE"),
    "a proposed (unsettled) section must not appear in the TEP projection body",
  );
});
