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
  gateSliceSatisfiesToDone,
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
