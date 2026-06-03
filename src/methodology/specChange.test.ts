/**
 * Unit tests for the spec-change classifier (SP-86). Run via `npm test`, which
 * compiles this + its source to out-test/ and executes it with Node's built-in
 * test runner (`node --test`). No external test framework — the classifier is a
 * pure function, so `node:test` + `node:assert` are enough.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifySpecChange,
  isSpecStale,
  normalizeRequirementSections,
  requirementHash,
} from "./specChange";

const SPEC = `---
kind: spec
---
# A spec

Summary line that is not a requirement.

## Acceptance Criteria

- [ ] First criterion
- [ ] Second criterion

## Constraints

- Be fast

## Design

Do the thing with a hash.

### A sub-heading inside Design

still part of the design.

## File Structure Plan

- \`a.ts\` — not a requirement
`;

test("normalizeRequirementSections captures only the requirement sections", () => {
  const n = normalizeRequirementSections(SPEC);
  assert.match(n, /First criterion/);
  assert.match(n, /Be fast/);
  assert.match(n, /Do the thing with a hash/);
  // a ### sub-heading inside Design is kept as content, not a section boundary
  assert.match(n, /still part of the design/);
  // title, summary, and the File Structure Plan section are excluded
  assert.doesNotMatch(n, /A spec/);
  assert.doesNotMatch(n, /Summary line/);
  assert.doesNotMatch(n, /not a requirement/);
});

test("ticking an AC checkbox does not change the requirement hash", () => {
  const ticked = SPEC.replace("- [ ] First criterion", "- [x] First criterion");
  assert.equal(requirementHash(ticked), requirementHash(SPEC));
});

test("editing AC text / Design / Constraints changes the requirement hash", () => {
  const ac = SPEC.replace("Second criterion", "Second criterion, revised");
  const design = SPEC.replace("Do the thing with a hash.", "Do something else.");
  const constraints = SPEC.replace("- Be fast", "- Be slow");
  assert.notEqual(requirementHash(ac), requirementHash(SPEC));
  assert.notEqual(requirementHash(design), requirementHash(SPEC));
  assert.notEqual(requirementHash(constraints), requirementHash(SPEC));
});

test("editing a non-requirement section (File Structure Plan) does NOT change the hash", () => {
  const edited = SPEC.replace("`a.ts` — not a requirement", "`b.ts` — moved");
  assert.equal(requirementHash(edited), requirementHash(SPEC));
});

const H = requirementHash(SPEC);

test("no verification baseline → none (un-verified work is never flagged)", () => {
  assert.equal(
    classifySpecChange({
      currentReqHash: H,
      stampedReqHash: undefined,
      parentUpdatedAt: "2026-06-02T00:00:02Z",
      taskUpdatedAt: "2026-06-02T00:00:00Z",
    }),
    "none",
  );
});

test("requirement hash differs from the stamp → requirements (stale)", () => {
  const input = { currentReqHash: "different", stampedReqHash: H };
  assert.equal(classifySpecChange(input), "requirements");
  assert.equal(isSpecStale(input), true);
});

test("regression: migration touches the parent after its children → metadata, not stale", () => {
  // This session's false positive: the Configure-Project migration assigned the
  // parent Spec its Issue Type + stripped its kind label at 17:39:03Z, ~2s
  // after the child tasks were migrated — bumping parent.updatedAt without any
  // requirement change. Must classify as metadata (not stale).
  const input = {
    currentReqHash: H,
    stampedReqHash: H,
    parentUpdatedAt: "2026-06-02T17:39:03Z",
    taskUpdatedAt: "2026-06-02T17:38:50Z",
  };
  assert.equal(classifySpecChange(input), "metadata");
  assert.equal(isSpecStale(input), false);
});

test("checkbox-only spec edit after the task → metadata, not stale", () => {
  const ticked = SPEC.replace("- [ ] First criterion", "- [x] First criterion");
  const input = {
    currentReqHash: requirementHash(ticked),
    stampedReqHash: requirementHash(SPEC),
    parentUpdatedAt: "2026-06-02T18:00:00Z",
    taskUpdatedAt: "2026-06-02T17:00:00Z",
  };
  assert.equal(classifySpecChange(input), "metadata");
  assert.equal(isSpecStale(input), false);
});

test("hash unchanged and no later parent touch → none", () => {
  assert.equal(
    classifySpecChange({
      currentReqHash: H,
      stampedReqHash: H,
      parentUpdatedAt: "2026-06-02T00:00:00Z",
      taskUpdatedAt: "2026-06-02T17:00:00Z",
    }),
    "none",
  );
});
