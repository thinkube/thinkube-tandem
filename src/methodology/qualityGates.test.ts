/**
 * Unit tests for the Tandem (3-column) quality gates. Run via `npm test`,
 * which compiles this + its source to out-test/ and runs it with Node's
 * built-in test runner. Pure functions over a Spec body — node:test +
 * node:assert are enough.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { gateForTandemTransition, runTandemGate } from "./qualityGates";

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
