/**
 * The worker's brief carries the parent TEP as ONE embedded intent artifact. A prompt that
 * threaded the same rendered TEP under two names (a separate PARENT SPEC block plus a
 * `specBody` context field) repeated the same lines to the worker and, worse, invited the
 * two copies to drift — a code worker reading one filtered view in one block and an
 * unfiltered view in the other. These tests pin: no duplication when a caller supplies the
 * same text under both `tepBody` and `sliceBody`, the role-conditioned `satisfies:`
 * stripping applied to that ONE copy, and the "embedded, not a file to hunt for" framing
 * that replaces any instruction sending the worker to read a spec off the filesystem.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkerPrompt } from "./preflight";
import type { SchedUnit } from "./dag";

function baseUnit(role: "code" | "test"): SchedUnit {
  return {
    id: "SL-1#eu-0",
    slice: "SL-1",
    footprint: ["src/example.ts"],
    requires: [],
    shape: "serial",
    role,
    note: "do the thing",
  };
}

test("INVARIANT: a distinctive tepBody line appears exactly once, even when the same text is also passed as sliceBody", () => {
  const distinctive = "The quick brown fox jumps over the lazy zebra crossing.";
  const body = `Some intent prose.\n${distinctive}\nMore prose.`;
  const prompt = buildWorkerPrompt(baseUnit("code"), "SP-1", {
    tepBody: body,
    sliceBody: body,
  });
  const occurrences = prompt.split(distinctive).length - 1;
  assert.equal(
    occurrences,
    1,
    "the shared line must be rendered once, not once per body field it was supplied under",
  );
});

test("INVARIANT: a code unit's brief strips satisfies: lines from the embedded intent, keeping the surrounding prose", () => {
  const body =
    "Prose before.\nsatisfies:\n  - AC1\n  - AC2\nProse after remains.";
  const prompt = buildWorkerPrompt(baseUnit("code"), "SP-1", {
    tepBody: body,
  });
  assert.ok(
    !/satisfies\s*:/i.test(prompt),
    "a code worker's brief must contain no satisfies: key anywhere",
  );
  assert.ok(prompt.includes("Prose before."));
  assert.ok(prompt.includes("Prose after remains."));
});

test("INVARIANT: a test unit's brief renders satisfies: lines from the embedded intent verbatim", () => {
  const body =
    "Prose before.\nsatisfies:\n  - AC1\n  - AC2\nProse after remains.";
  const prompt = buildWorkerPrompt(baseUnit("test"), "SP-1", {
    tepBody: body,
  });
  assert.ok(
    /satisfies\s*:\s*\n\s*-\s*AC1\s*\n\s*-\s*AC2/.test(prompt),
    "a test worker's brief must keep the satisfies: key and its list items unchanged",
  );
  assert.ok(prompt.includes("Prose before."));
  assert.ok(prompt.includes("Prose after remains."));
});

test("INVARIANT: whenever tepBody is supplied, the brief states the intent is embedded and never sends the worker to read a spec off the filesystem", () => {
  for (const role of ["code", "test"] as const) {
    const prompt = buildWorkerPrompt(baseUnit(role), "SP-1", {
      tepBody: "Some intent text.",
    });
    assert.match(
      prompt,
      /embedded/i,
      `${role} unit: brief must plainly say the intent is embedded`,
    );
    assert.ok(
      !/read the (?:parent )?spec\b[^\n]*\bfor context/i.test(prompt),
      `${role} unit: brief must not instruct reading a parent spec off disk for context`,
    );
    assert.ok(
      !/search the filesystem for specs/i.test(prompt),
      `${role} unit: brief must not instruct hunting the filesystem for spec files`,
    );
  }
});
