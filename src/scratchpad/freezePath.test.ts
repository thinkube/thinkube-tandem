/**
 * Unit tests for the freeze-path surfacing added after field use (2026-07-16):
 * parseSlicerVerdict (production readiness judge's reply parser) and
 * freezeStatusText (the human-visible replacement for the invisible
 * data-reason attribute). Run via the repo recipe (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "./model";
import type { Action, WorkingModel } from "./model";
import { parseSlicerVerdict } from "./dryRunSlice";
import { freezeStatusText } from "./views/document";

// ── parseSlicerVerdict ────────────────────────────────────────────────────────

test("parseSlicerVerdict: a clean JSON verdict parses; cleanCut:true clears the gap", () => {
  const v = parseSlicerVerdict(
    '{"cleanCut": true, "gapSection": "criteria", "decomposition": ["a", "b"]}',
  );
  assert.equal(v.cleanCut, true);
  assert.equal(v.gapSection, null);
  assert.deepEqual(v.decomposition, ["a", "b"]);
});

test("parseSlicerVerdict: fenced/prose-wrapped replies still parse (the intent-check parser lesson)", () => {
  const v = parseSlicerVerdict(
    'Here is my verdict:\n```json\n{"cleanCut": false, "gapSection": "criteria", "decomposition": []}\n```\nDone.',
  );
  assert.equal(v.cleanCut, false);
  assert.equal(v.gapSection, "criteria");
});

test("parseSlicerVerdict: garbage, missing cleanCut, or invalid gap kinds return the honest not-ready verdict", () => {
  for (const bad of [
    "no json here",
    "",
    '{"gapSection": "criteria"}',
    "{broken",
  ]) {
    const v = parseSlicerVerdict(bad);
    assert.equal(v.cleanCut, false, `expected not-ready for ${JSON.stringify(bad)}`);
    assert.equal(v.gapSection, null);
  }
  // Invalid gap kind is dropped to null, cleanCut kept honest.
  const v = parseSlicerVerdict('{"cleanCut": false, "gapSection": "backend"}');
  assert.equal(v.cleanCut, false);
  assert.equal(v.gapSection, null);
});

// ── freezeStatusText ──────────────────────────────────────────────────────────

function coveredModel(): WorkingModel {
  let model = emptyModel("tep");
  const seed: Action = { type: "seedGoal", text: "a real intent" };
  model = reduce(model, seed).model;
  for (const sec of model.sections) {
    if (sec.kind === "goal") continue;
    const propose: Action = {
      type: "proposeItem",
      actor: "gap-filler",
      sectionId: sec.id,
      item: { text: `item for ${sec.kind}`, modality: "optional", evals: {} },
    };
    model = reduce(model, propose).model;
    const itemId = model.sections.find((s) => s.id === sec.id)!.items[0].id;
    const check: Action = { type: "checkItem", actor: "human", itemId };
    model = reduce(model, check).model;
  }
  return model;
}

test("freezeStatusText: a fresh space names every uncovered section including the goal", () => {
  const text = freezeStatusText(emptyModel("tep"), false);
  assert.match(text, /Freeze locked/);
  assert.match(text, /goal \(write the intent text\)/);
  assert.match(text, /constraints/);
  assert.match(text, /verification/);
});

test("freezeStatusText: coverage green + no readiness run → points at Check readiness", () => {
  const text = freezeStatusText(coveredModel(), false);
  assert.match(text, /Check readiness/);
  assert.doesNotMatch(text, /uncovered/);
});

test("freezeStatusText: a dry-run gap renders the judge's reason when present", () => {
  let model = coveredModel();
  model = reduce(model, {
    type: "recordReadiness",
    record: {
      covered: true,
      cleanCut: false,
      gapSection: "gap",
      note: "The intent names two unrelated outcomes; split them or state which one this TEP delivers.",
    },
  }).model;
  const text = freezeStatusText(model, false);
  assert.match(text, /two unrelated outcomes/);
  assert.match(text, /\(gap section\)/);
  // The unhelpful 2026-07-16 phrasing must be gone.
  assert.doesNotMatch(text, /gap in “gap”/);
});

test("freezeStatusText: a dry-run gap without a note still reads sensibly; enabled state says ready", () => {
  let model = coveredModel();
  model = reduce(model, {
    type: "recordReadiness",
    record: { covered: true, cleanCut: false, gapSection: "criteria" },
  }).model;
  assert.match(
    freezeStatusText(model, false),
    /flagged the criteria section as incomplete or ambiguous/,
  );

  model = reduce(model, {
    type: "recordReadiness",
    record: { covered: true, cleanCut: true, gapSection: null },
  }).model;
  assert.match(freezeStatusText(model, true), /Ready to freeze/);
});

test("parseSlicerVerdict: the reason is carried on failures and dropped on clean cuts", () => {
  const failed = parseSlicerVerdict(
    '{"cleanCut": false, "gapSection": "criteria", "reason": "No criterion says how success is observed.", "decomposition": []}',
  );
  assert.equal(failed.reason, "No criterion says how success is observed.");
  const clean = parseSlicerVerdict(
    '{"cleanCut": true, "gapSection": null, "reason": "irrelevant", "decomposition": []}',
  );
  assert.equal(clean.reason, undefined);
});
