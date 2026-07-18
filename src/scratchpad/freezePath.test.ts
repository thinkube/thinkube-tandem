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
import { computeDepMeta, freezeStatusText } from "./views/document";

// ── parseSlicerVerdict ────────────────────────────────────────────────────────

test("parseSlicerVerdict: a clean JSON verdict parses; cleanCut:true clears the gap", () => {
  const v = parseSlicerVerdict(
    '{"cleanCut": true, "gapSection": "acceptance", "decomposition": ["a", "b"]}',
  );
  assert.equal(v.cleanCut, true);
  assert.equal(v.gapSection, null);
  assert.deepEqual(v.decomposition, ["a", "b"]);
});

test("parseSlicerVerdict: fenced/prose-wrapped replies still parse (the intent-check parser lesson)", () => {
  const v = parseSlicerVerdict(
    'Here is my verdict:\n```json\n{"cleanCut": false, "gapSection": "acceptance", "decomposition": []}\n```\nDone.',
  );
  assert.equal(v.cleanCut, false);
  assert.equal(v.gapSection, "acceptance");
});

test("parseSlicerVerdict: garbage, missing cleanCut, or invalid gap kinds return the honest not-ready verdict", () => {
  for (const bad of [
    "no json here",
    "",
    '{"gapSection": "acceptance"}',
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
  assert.match(text, /goal \(write the first journal entry\)/);
  assert.match(text, /gap \(attend every open question/);
  assert.match(text, /constraints/);
  assert.match(text, /acceptance/);
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
    record: { covered: true, cleanCut: false, gapSection: "acceptance" },
  }).model;
  assert.match(
    freezeStatusText(model, false),
    /flagged the acceptance section as incomplete or ambiguous/,
  );

  model = reduce(model, {
    type: "recordReadiness",
    record: { covered: true, cleanCut: true, gapSection: null },
  }).model;
  assert.match(freezeStatusText(model, true), /Ready to freeze/);
});

test("freezeStatusText: unsettled mandatory items warn in every state; settling clears it", () => {
  let model = coveredModel();
  // Add one MANDATORY item, unchecked.
  const gapSec = model.sections.find((s) => s.kind === "gap")!;
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: gapSec.id,
    item: { text: "a required thing", modality: "mandatory", evals: {} },
  }).model;
  model = reduce(model, {
    type: "recordReadiness",
    record: { covered: true, cleanCut: true, gapSection: null },
  }).model;
  const ready = freezeStatusText(model, true);
  assert.match(ready, /Ready to freeze/);
  assert.match(ready, /1 MANDATORY item is not settled/);

  // Checking the mandatory item clears the warning.
  const mandatoryId = model.sections
    .find((s) => s.kind === "gap")!
    .items.find((it) => it.modality === "mandatory")!.id;
  model = reduce(model, {
    type: "checkItem",
    actor: "human",
    itemId: mandatoryId,
  }).model;
  assert.doesNotMatch(freezeStatusText(model, true), /MANDATORY/);
});

test("computeDepMeta: focus roles, stale rationale on dropped dependency, and chips", () => {
  let model = emptyModel("tep");
  const constraints = model.sections.find((s) => s.kind === "constraints")!;
  const elements = model.sections.find((s) => s.kind === "elements")!;
  // A ← B (B requires A); C unrelated.
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: constraints.id,
    item: { text: "item A", modality: "optional", evals: {} },
  }).model;
  const idA = model.sections.find((s) => s.kind === "constraints")!.items[0].id;
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: elements.id,
    item: { text: "item B", modality: "mandatory", evals: {}, requires: [idA] },
  }).model;
  const idB = model.sections.find((s) => s.kind === "elements")!.items[0].id;
  model = reduce(model, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: elements.id,
    item: { text: "item C", modality: "optional", evals: {} },
  }).model;
  const idC = model.sections.find((s) => s.kind === "elements")!.items[1].id;

  // Focus on B: A lights as requirement, C dims, B carries chips.
  const meta = computeDepMeta(model, idB);
  assert.equal(meta.get(idB)!.focusRole, "focus");
  assert.equal(meta.get(idA)!.focusRole, "req");
  assert.equal(meta.get(idC)!.focusRole, "dim");
  assert.deepEqual(
    meta.get(idB)!.chips!.map((c) => c.id),
    [idA],
  );
  // Focus on A: B lights as dependent.
  assert.equal(computeDepMeta(model, idA).get(idB)!.focusRole, "dependent");
  // Edge counts flow both directions.
  assert.equal(meta.get(idA)!.depCount, 1);
  assert.equal(meta.get(idB)!.depCount, 1);

  // Dropping A marks B's rationale stale — mechanically, no worker involved.
  model = reduce(model, { type: "dropItem", actor: "human", itemId: idA }).model;
  const after = computeDepMeta(model);
  assert.equal(after.get(idB)!.stale, true);
  assert.match(after.get(idB)!.staleDeps[0], /item A \(dropped\)/);
  assert.equal(after.get(idC)!.stale, false);
});

test("parseSlicerVerdict: the reason is carried on failures and dropped on clean cuts", () => {
  const failed = parseSlicerVerdict(
    '{"cleanCut": false, "gapSection": "acceptance", "reason": "No criterion says how success is observed.", "decomposition": []}',
  );
  assert.equal(failed.reason, "No criterion says how success is observed.");
  const clean = parseSlicerVerdict(
    '{"cleanCut": true, "gapSection": null, "reason": "irrelevant", "decomposition": []}',
  );
  assert.equal(clean.reason, undefined);
});
