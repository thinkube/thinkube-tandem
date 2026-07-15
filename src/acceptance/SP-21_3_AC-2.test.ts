// SP-21/3 AC-2 — Only the human settles.
//
// WHY (INVARIANT): The reducer mechanically enforces that no worker can ever set an
// item to checked. A checkItem or uncheckItem action whose actor is not "human" must
// return the SAME model reference (no mutation) and append a rejected delta carrying a
// reason. An addItem action whose actor is not "human" is similarly rejected. The
// identical actions with actor "human" apply the change and return an applied delta.
// addItem with actor "human" creates an item born checked:true.
//
// This invariant must hold forever — any implementation that lets a non-human actor
// settle an item, or that silently drops the action without a rejected delta, breaks the
// foundational guarantee that the human's checkmark is the only settling act.

import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "../scratchpad/model";
import type { Action, WorkingModel } from "../scratchpad/model";

// ── Local SP-3 type helpers (defined here; the implementation exports these) ──

interface SP3Item {
  id: string;
  text: string;
  checked: boolean;
  modality: string;
  evals: { complexity?: number; risk?: number };
  origin: string;
  state: string;
}

interface SP3Section {
  id: string;
  kind: string;
  items: SP3Item[];
}

interface SP3Model {
  sections: SP3Section[];
}

type AnyDelta = {
  kind: string; // "applied" | "rejected"
  reason?: string; // present when kind === "rejected"
  field?: string; // present when kind === "applied"
  before?: unknown;
  after?: unknown;
  action?: unknown;
};

type ReduceResult = { model: WorkingModel; delta: AnyDelta };

/**
 * Apply an action through the reducer, casting to our SP-3 delta union shape.
 * Uses `as unknown as Action` to submit action types that are new in SP-3 but
 * not yet in the pre-implementation `Action` union.
 */
function apply(
  model: WorkingModel,
  action: Record<string, unknown>,
): ReduceResult {
  return reduce(model, action as unknown as Action) as unknown as ReduceResult;
}

/**
 * Helper: build a model that has one active, checked item in the 'constraints'
 * section. Returns the model and the item's id.
 *
 * SP-3 contract: emptyModel seeds all 6 section kinds. addItem with actor:'human'
 * is born checked:true.
 */
function makeModelWithCheckedItem(): {
  model: WorkingModel;
  itemId: string;
  sectionId: string;
} {
  const base = emptyModel("tep");
  const sp3Base = base as unknown as SP3Model;
  const constraintsSec = sp3Base.sections.find((s) => s.kind === "constraints");
  assert.ok(
    constraintsSec,
    "emptyModel (SP-3) must seed a 'constraints' section — precondition for AC-2 setup",
  );
  const sectionId = constraintsSec.id;

  const { model } = apply(base, {
    type: "addItem",
    actor: "human",
    sectionId,
    text: "SETUPITEMTEXT",
  });

  const sec = (model as unknown as SP3Model).sections.find(
    (s) => s.kind === "constraints",
  )!;
  assert.equal(sec.items.length, 1, "setup: one item must exist after addItem");
  const itemId = sec.items[0].id;
  return { model, itemId, sectionId };
}

// ── REJECTED: checkItem with non-human actor ──────────────────────────────────

test("checkItem with actor 'gap-filler' (non-human) — same model reference, rejected delta with reason", () => {
  // Start with a born-checked item, then uncheck it as human to create a
  // checkable starting state.
  const { model: withItem, itemId } = makeModelWithCheckedItem();
  const { model: uncheckedModel } = apply(withItem, {
    type: "uncheckItem",
    actor: "human",
    itemId,
  });

  // Non-human checkItem — must be rejected
  const result = apply(uncheckedModel, {
    type: "checkItem",
    actor: "gap-filler",
    itemId,
  });

  // SAME reference: the reducer must not allocate a new model for a rejected action
  assert.strictEqual(
    result.model,
    uncheckedModel,
    "checkItem with actor:'gap-filler' must return the SAME model reference — " +
      "no mutation when the invariant rejects the action",
  );

  assert.equal(
    result.delta.kind,
    "rejected",
    "delta.kind must be 'rejected' for a non-human checkItem",
  );
  assert.ok(
    typeof result.delta.reason === "string" && result.delta.reason.length > 0,
    "rejected delta must carry a non-empty reason string naming why it was rejected",
  );

  // The item must remain unchecked
  const item = (result.model as unknown as SP3Model).sections
    .find((s) => s.kind === "constraints")!
    .items.find((i) => i.id === itemId)!;
  assert.equal(
    item.checked,
    false,
    "item must remain unchecked after a rejected non-human checkItem",
  );
});

test("checkItem with actor 'integrator' (non-human) — rejected, same reference, item unchanged", () => {
  const { model: withItem, itemId } = makeModelWithCheckedItem();
  const { model: uncheckedModel } = apply(withItem, {
    type: "uncheckItem",
    actor: "human",
    itemId,
  });

  const result = apply(uncheckedModel, {
    type: "checkItem",
    actor: "integrator",
    itemId,
  });

  assert.strictEqual(
    result.model,
    uncheckedModel,
    "same model reference for 'integrator' checkItem",
  );
  assert.equal(
    result.delta.kind,
    "rejected",
    "delta rejected for 'integrator' checkItem",
  );
});

test("checkItem with actor 'research' (non-human) — rejected, same reference", () => {
  const { model: withItem, itemId } = makeModelWithCheckedItem();
  const { model: uncheckedModel } = apply(withItem, {
    type: "uncheckItem",
    actor: "human",
    itemId,
  });

  const result = apply(uncheckedModel, {
    type: "checkItem",
    actor: "research",
    itemId,
  });

  assert.strictEqual(
    result.model,
    uncheckedModel,
    "same model reference for 'research' checkItem",
  );
  assert.equal(result.delta.kind, "rejected");
});

test("checkItem with actor 'interpreter' (non-human) — rejected, same reference", () => {
  const { model: withItem, itemId } = makeModelWithCheckedItem();
  const { model: uncheckedModel } = apply(withItem, {
    type: "uncheckItem",
    actor: "human",
    itemId,
  });

  const result = apply(uncheckedModel, {
    type: "checkItem",
    actor: "interpreter",
    itemId,
  });

  assert.strictEqual(
    result.model,
    uncheckedModel,
    "same model reference for 'interpreter' checkItem",
  );
  assert.equal(result.delta.kind, "rejected");
});

// ── REJECTED: uncheckItem with non-human actor ────────────────────────────────

test("uncheckItem with actor 'gap-filler' (non-human) — same model reference, rejected delta with reason", () => {
  // The born-checked item from setup is already checked — directly test uncheckItem.
  const { model, itemId } = makeModelWithCheckedItem();

  const result = apply(model, {
    type: "uncheckItem",
    actor: "gap-filler",
    itemId,
  });

  assert.strictEqual(
    result.model,
    model,
    "uncheckItem with actor:'gap-filler' must return the SAME model reference",
  );
  assert.equal(
    result.delta.kind,
    "rejected",
    "delta.kind must be 'rejected' for a non-human uncheckItem",
  );
  assert.ok(
    typeof result.delta.reason === "string" && result.delta.reason.length > 0,
    "rejected delta must carry a non-empty reason string",
  );

  // The item must remain checked
  const item = (result.model as unknown as SP3Model).sections
    .find((s) => s.kind === "constraints")!
    .items.find((i) => i.id === itemId)!;
  assert.equal(
    item.checked,
    true,
    "item must remain checked after a rejected non-human uncheckItem",
  );
});

test("uncheckItem with actor 'research' (non-human) — rejected, same reference", () => {
  const { model, itemId } = makeModelWithCheckedItem();

  const result = apply(model, {
    type: "uncheckItem",
    actor: "research",
    itemId,
  });

  assert.strictEqual(
    result.model,
    model,
    "same model reference for 'research' uncheckItem",
  );
  assert.equal(result.delta.kind, "rejected");
});

// ── REJECTED: addItem with non-human actor ────────────────────────────────────
//
// The reducer enforces the invariant even for addItem when a non-human actor is
// supplied at runtime (the TypeScript type constrains actor:"human" but the runtime
// invariant is the authoritative gate — a cast or serialization round-trip could
// bypass the type).

test("addItem with actor 'gap-filler' (non-human) — same model reference, rejected delta", () => {
  const base = emptyModel("tep");
  const sp3 = base as unknown as SP3Model;
  const constraintsSec = sp3.sections.find((s) => s.kind === "constraints");
  assert.ok(constraintsSec, "emptyModel must seed a constraints section");

  const result = apply(base, {
    type: "addItem",
    actor: "gap-filler",
    sectionId: constraintsSec.id,
    text: "NONHUMANATTEMPT",
  });

  assert.strictEqual(
    result.model,
    base,
    "addItem with non-human actor must return the SAME model reference",
  );
  assert.equal(
    result.delta.kind,
    "rejected",
    "delta.kind must be 'rejected' — a non-human addItem (born-checked) is refused",
  );
  assert.ok(
    typeof result.delta.reason === "string" && result.delta.reason.length > 0,
    "rejected delta must carry a reason",
  );

  // No item must have been added
  const sec = (result.model as unknown as SP3Model).sections.find(
    (s) => s.kind === "constraints",
  )!;
  assert.equal(
    sec.items.length,
    0,
    "no item must be added when the addItem is rejected",
  );
});

// ── APPLIED: addItem with actor 'human' — born checked, applied delta ─────────

test("addItem with actor 'human' — item born checked:true, origin:'human', applied delta", () => {
  const base = emptyModel("tep");
  const sp3 = base as unknown as SP3Model;
  const constraintsSec = sp3.sections.find((s) => s.kind === "constraints");
  assert.ok(constraintsSec, "emptyModel must seed a constraints section");

  const { model, delta } = apply(base, {
    type: "addItem",
    actor: "human",
    sectionId: constraintsSec.id,
    text: "BORNCHECKEDITEMTEXT",
  });

  assert.equal(
    delta.kind,
    "applied",
    "addItem with actor:'human' must produce an 'applied' delta",
  );

  // Model must be a NEW object (not the same reference)
  assert.notStrictEqual(
    model,
    base,
    "addItem with actor:'human' must return a new model object",
  );

  const sec = (model as unknown as SP3Model).sections.find(
    (s) => s.kind === "constraints",
  )!;
  assert.equal(
    sec.items.length,
    1,
    "one item must be in the section after addItem",
  );

  const item = sec.items[0];
  assert.equal(
    item.checked,
    true,
    "human-added item must be born checked:true — " +
      "the act of adding IS the human's settling act",
  );
  assert.equal(item.text, "BORNCHECKEDITEMTEXT");
  assert.equal(item.origin, "human", "item origin must be 'human'");
  assert.equal(item.state, "active", "new item must have state:'active'");
});

test("addItem with actor 'human' with explicit optional modality — item carries modality:'optional'", () => {
  const base = emptyModel("tep");
  const sp3 = base as unknown as SP3Model;
  const constraintsSec = sp3.sections.find((s) => s.kind === "constraints")!;

  const { model, delta } = apply(base, {
    type: "addItem",
    actor: "human",
    sectionId: constraintsSec.id,
    text: "OPTIONALITEMTEXT",
    modality: "optional",
  });

  assert.equal(delta.kind, "applied");
  const item = (model as unknown as SP3Model).sections.find(
    (s) => s.kind === "constraints",
  )!.items[0];
  assert.equal(
    item.modality,
    "optional",
    "explicit optional modality must be preserved on the born item",
  );
  assert.equal(
    item.checked,
    true,
    "still born-checked even with optional modality",
  );
});

// ── APPLIED: checkItem with actor 'human' → applied delta ─────────────────────

test("checkItem with actor 'human' — new model object, item becomes checked, applied delta", () => {
  const { model: withItem, itemId } = makeModelWithCheckedItem();
  // Uncheck first (human) so we can check it again
  const { model: uncheckedModel } = apply(withItem, {
    type: "uncheckItem",
    actor: "human",
    itemId,
  });

  const { model, delta } = apply(uncheckedModel, {
    type: "checkItem",
    actor: "human",
    itemId,
  });

  assert.notStrictEqual(
    model,
    uncheckedModel,
    "human checkItem must produce a new model object",
  );
  assert.equal(
    delta.kind,
    "applied",
    "checkItem with actor:'human' must produce an 'applied' delta",
  );

  const item = (model as unknown as SP3Model).sections
    .find((s) => s.kind === "constraints")!
    .items.find((i) => i.id === itemId)!;
  assert.equal(
    item.checked,
    true,
    "item must be checked after human checkItem",
  );
});

// ── APPLIED: uncheckItem with actor 'human' → applied delta ───────────────────

test("uncheckItem with actor 'human' — new model object, item becomes unchecked, applied delta", () => {
  // The born-checked item from setup is already checked
  const { model, itemId } = makeModelWithCheckedItem();

  const beforeItem = (model as unknown as SP3Model).sections
    .find((s) => s.kind === "constraints")!
    .items.find((i) => i.id === itemId)!;
  assert.equal(
    beforeItem.checked,
    true,
    "precondition: item must be checked before human uncheckItem",
  );

  const { model: unchecked, delta } = apply(model, {
    type: "uncheckItem",
    actor: "human",
    itemId,
  });

  assert.notStrictEqual(
    unchecked,
    model,
    "human uncheckItem must produce a new model object",
  );
  assert.equal(
    delta.kind,
    "applied",
    "uncheckItem with actor:'human' must produce an 'applied' delta",
  );

  const afterItem = (unchecked as unknown as SP3Model).sections
    .find((s) => s.kind === "constraints")!
    .items.find((i) => i.id === itemId)!;
  assert.equal(
    afterItem.checked,
    false,
    "item must be unchecked after human uncheckItem",
  );
});

// ── APPLIED: proposeItem from non-human — arrives unchecked, applied delta ────
//
// WHY: proposeItem is the correct non-human "add" path — it is not a checked-affecting
// action, so it is applied (not rejected). The item arrives with checked:false so the
// human must explicitly check it to settle it. This is the contrast with addItem.

test("proposeItem with actor 'gap-filler' — applied, item arrives unchecked:false", () => {
  const base = emptyModel("tep");
  const sp3 = base as unknown as SP3Model;
  const constraintsSec = sp3.sections.find((s) => s.kind === "constraints")!;

  const { model, delta } = apply(base, {
    type: "proposeItem",
    actor: "gap-filler",
    sectionId: constraintsSec.id,
    item: {
      text: "PROPOSEDITEMBYWORKER",
      modality: "mandatory",
      evals: { complexity: 2 },
    },
  });

  // proposeItem is NOT a checked-affecting action — it is allowed for non-human
  assert.equal(
    delta.kind,
    "applied",
    "proposeItem from a non-human actor must produce an 'applied' delta — " +
      "it does not set checked, so the invariant does not reject it",
  );

  const sec = (model as unknown as SP3Model).sections.find(
    (s) => s.kind === "constraints",
  )!;
  assert.equal(
    sec.items.length,
    1,
    "one proposed item must appear in the section",
  );

  const item = sec.items[0];
  assert.equal(
    item.checked,
    false,
    "worker-proposed item must arrive unchecked:false — " +
      "the worker cannot settle items; the human must check it",
  );
  assert.equal(item.origin, "gap-filler");
  assert.equal(item.text, "PROPOSEDITEMBYWORKER");
  assert.equal(item.evals.complexity, 2);
});
