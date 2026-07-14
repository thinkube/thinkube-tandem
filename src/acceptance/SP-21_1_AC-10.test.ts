// SP-21/1 AC-10 — the reframe step rewrites the Goal from the settled sections rather than
// reusing the original seed text.
//
// WHY (INVARIANT — must always hold): the reframe worker's job is to synthesise a precise,
// coherent Goal from what was collaboratively settled in the surrounding sections. If the
// original seed text leaked into the reframe prompt, the model would anchor to it and the
// "reframe" would be an incremental refinement of the rough draft — not a clean synthesis.
// The separation is foundational to the scratchpad methodology and must hold forever.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assertWithinGate,
  GATES,
  type QueryFn,
  type WorkerMessage,
} from "../scratchpad/workers/worker";
import { reframe } from "../scratchpad/workers/reframe";
import { emptyModel, reduce } from "../scratchpad/model";
import type { WorkingModel } from "../scratchpad/model";

// ── Test model builder ───────────────────────────────────────────────────────

/**
 * Build a model that has:
 *   - a goal section seeded with a sentinel string (the "original seed")
 *   - a constraints section with a distinct sentinel string that is marked 'settled'
 *
 * The reframe buildPrompt must include the settled constraints text and must NOT include
 * the goal seed text.
 */
function makeModelWithSettledSections(): WorkingModel {
  // Seed the goal — this is the "original seed" the reframe prompt must NOT include.
  let { model } = reduce(emptyModel("tep"), {
    type: "seedGoal",
    text: "SENTINEL_ORIGINAL_SEED_DO_NOT_INCLUDE_IN_REFRAME_PROMPT",
  });

  // Propose a constraints section with a distinctive settled text.
  const r1 = reduce(model, {
    type: "proposeSection",
    kind: "constraints",
    text: "SENTINEL_SETTLED_CONSTRAINTS_TEXT_MUST_APPEAR_IN_REFRAME_PROMPT",
    workerId: "test-gap-filler",
  });
  model = r1.model;

  // Mark that section as 'settled'.
  const constraintsId = model.sections[model.sections.length - 1].id;
  const r2 = reduce(model, {
    type: "setSectionState",
    id: constraintsId,
    state: "settled",
  });
  model = r2.model;

  return model;
}

// A query factory that yields nothing — used where only buildOptions/buildPrompt is needed.
const noopQuery: QueryFn = async function* (_args) {
  // yields nothing
};

// ── buildPrompt: settled sections appear ─────────────────────────────────────

// WHY INVARIANT: the reframe prompt must include the settled sections' text — they are the
// input material the model uses to synthesise a precise Goal. Without them the reframe step
// has nothing to ground the new Goal in.
test("reframe buildPrompt includes the text of settled sections", () => {
  const worker = reframe({ loadQuery: () => noopQuery, model: "sonnet" });
  const model = makeModelWithSettledSections();

  const prompt = worker.buildPrompt(model, []);

  assert.ok(
    prompt.includes(
      "SENTINEL_SETTLED_CONSTRAINTS_TEXT_MUST_APPEAR_IN_REFRAME_PROMPT",
    ),
    "the settled constraints text must appear in the reframe prompt",
  );
});

// ── buildPrompt: original goal seed does not appear ──────────────────────────

// WHY INVARIANT: the reframe prompt must NOT include the original goal seed text — if it
// did, the model would anchor to the rough draft rather than synthesising from settled
// sections, and the reframe step would produce a refinement rather than a rewrite.
test("reframe buildPrompt does not include the original goal seed text", () => {
  const worker = reframe({ loadQuery: () => noopQuery, model: "sonnet" });
  const model = makeModelWithSettledSections();

  const prompt = worker.buildPrompt(model, []);

  assert.ok(
    !prompt.includes("SENTINEL_ORIGINAL_SEED_DO_NOT_INCLUDE_IN_REFRAME_PROMPT"),
    "the original seed/goal text must NOT appear in the reframe prompt",
  );
});

// WHY INVARIANT: settled-only prompt must hold across multiple settled sections, not just
// one — if the implementation filtered only the first section the invariant would be
// violated for any real model with constraints + elements + criteria all settled.
test("reframe buildPrompt includes all settled sections but no unsettled section text", () => {
  const worker = reframe({ loadQuery: () => noopQuery, model: "sonnet" });

  // Build a model with two settled sections and one proposed (unsettled) section.
  let { model } = reduce(emptyModel("tep"), {
    type: "seedGoal",
    text: "SEED_GOAL_UNSETTLED",
  });

  const r1 = reduce(model, {
    type: "proposeSection",
    kind: "constraints",
    text: "SETTLED_CONSTRAINTS",
    workerId: "w1",
  });
  model = r1.model;
  const r2 = reduce(model, {
    type: "setSectionState",
    id: model.sections[model.sections.length - 1].id,
    state: "settled",
  });
  model = r2.model;

  const r3 = reduce(model, {
    type: "proposeSection",
    kind: "elements",
    text: "SETTLED_ELEMENTS",
    workerId: "w1",
  });
  model = r3.model;
  const r4 = reduce(model, {
    type: "setSectionState",
    id: model.sections[model.sections.length - 1].id,
    state: "settled",
  });
  model = r4.model;

  const r5 = reduce(model, {
    type: "proposeSection",
    kind: "criteria",
    text: "PROPOSED_CRITERIA_NOT_YET_SETTLED",
    workerId: "w1",
  });
  model = r5.model;
  // Leave criteria as 'proposed' (not settled).

  const prompt = worker.buildPrompt(model, []);

  assert.ok(
    prompt.includes("SETTLED_CONSTRAINTS"),
    "settled constraints text must appear in reframe prompt",
  );
  assert.ok(
    prompt.includes("SETTLED_ELEMENTS"),
    "settled elements text must appear in reframe prompt",
  );
  assert.ok(
    !prompt.includes("SEED_GOAL_UNSETTLED"),
    "original seed/goal text must not appear in reframe prompt",
  );
  assert.ok(
    !prompt.includes("PROPOSED_CRITERIA_NOT_YET_SETTLED"),
    "unsettled (proposed) section text must not appear in reframe prompt",
  );
});

// ── Gate: reframe is pre-gated with GATES.reframe ───────────────────────────

// WHY INVARIANT: the reframe worker may only editGoal — no other action type is within
// its scope. freeze and writeArtifact are explicitly disallowed so the reframe step
// cannot accidentally commit an artifact (the freeze is a human-only action).
test("reframe buildOptions matches GATES.reframe — editGoal allowed, freeze/writeArtifact disallowed", () => {
  const worker = reframe({ loadQuery: () => noopQuery, model: "sonnet" });
  const opts = worker.buildOptions();

  assert.deepEqual(
    [...opts.allowedTools].sort(),
    [...GATES.reframe.allowedTools].sort(),
    "reframe allowedTools must equal GATES.reframe.allowedTools",
  );
  assert.deepEqual(
    [...opts.disallowedTools].sort(),
    [...GATES.reframe.disallowedTools].sort(),
    "reframe disallowedTools must equal GATES.reframe.disallowedTools",
  );

  // Confirm the gate at the assertWithinGate level.
  assert.doesNotThrow(
    () => assertWithinGate(opts, "editGoal"),
    "reframe must be allowed to call editGoal",
  );
  assert.throws(
    () => assertWithinGate(opts, "freeze"),
    /disallowed|not in the allowed/i,
    "reframe must not be able to call freeze",
  );
  assert.throws(
    () => assertWithinGate(opts, "writeArtifact"),
    /disallowed|not in the allowed/i,
    "reframe must not be able to call writeArtifact",
  );
});

// ── Run: produces an editGoal action ────────────────────────────────────────

// WHY INVARIANT: the reframe worker's run must return an editGoal action — that is the
// only action type the app expects from the reframe step, and what it applies to the
// working model to overwrite the Goal with the synthesised text.
test("reframe run returns the editGoal action yielded by the query", async () => {
  const editGoalMsg: WorkerMessage = {
    type: "actions",
    actions: [
      {
        type: "editGoal",
        text: "REFRAMED_GOAL_SYNTHESISED_FROM_SETTLED_SECTIONS",
      },
    ],
  };
  const fakeQuery: QueryFn = async function* (_args) {
    yield editGoalMsg;
  };

  const worker = reframe({ loadQuery: () => fakeQuery, model: "sonnet" });
  const model = makeModelWithSettledSections();
  const actions = await worker.run(model, []);

  assert.equal(actions.length, 1, "reframe must return exactly one action");
  assert.deepEqual(actions[0], {
    type: "editGoal",
    text: "REFRAMED_GOAL_SYNTHESISED_FROM_SETTLED_SECTIONS",
  });
});
