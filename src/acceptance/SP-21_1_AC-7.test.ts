// SP-21/1 AC-7 — the adversarial worker is blind to the authoring conversation, can add
// objections, and cannot edit the Goal.
//
// WHY (INVARIANT — must always hold): blinding the adversarial worker to the conversation
// means its critique cannot be anchored to the conversation's framing — it sees only the
// working model and must form an independent view. Limiting it to addObjection ensures it
// can surface concerns without being able to steer the design by rewriting sections or
// the Goal. These constraints are standing: they define what an "adversarial pass" means
// in the scratchpad methodology.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assertWithinGate,
  type QueryFn,
  type WorkerMessage,
} from "../scratchpad/workers/worker";
import { adversarial } from "../scratchpad/workers/adversarial";
import { emptyModel, reduce } from "../scratchpad/model";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Minimal seeded model — goal section with text so the adversarial worker has something
 *  to review. */
function makeSeededModel() {
  const { model } = reduce(emptyModel("tep"), {
    type: "seedGoal",
    text: "The system should enable collaborative intent authoring",
  });
  return model;
}

// A query factory that yields nothing — used where we only need buildOptions/buildPrompt.
const noopQuery: QueryFn = async function* (_args) {
  // yields nothing
};

// ── Blindness to conversation ────────────────────────────────────────────────

// WHY INVARIANT: the adversarial worker's prompt must not include the authoring conversation
// so its critique is independent of the conversation's framing. If the conversation leaked
// in, the adversarial worker could parrot the author's own reasoning back as a review.
test("adversarial buildPrompt does not include any authoring conversation turns", () => {
  const worker = adversarial({ loadQuery: () => noopQuery, model: "sonnet" });
  const model = makeSeededModel();

  const conversation = [
    "SENTINEL_CONVERSATION_TURN_ONE_MUST_NOT_APPEAR",
    "SENTINEL_CONVERSATION_TURN_TWO_MUST_NOT_APPEAR",
  ];
  const prompt = worker.buildPrompt(model, conversation);

  assert.ok(
    !prompt.includes("SENTINEL_CONVERSATION_TURN_ONE_MUST_NOT_APPEAR"),
    "conversation turn 1 must not appear in the adversarial prompt",
  );
  assert.ok(
    !prompt.includes("SENTINEL_CONVERSATION_TURN_TWO_MUST_NOT_APPEAR"),
    "conversation turn 2 must not appear in the adversarial prompt",
  );
});

// WHY INVARIANT: the adversarial prompt must not change when conversation content changes
// (blindness is structural, not selective filtering). An authoring conversation of arbitrary
// length — including empty — must produce identical prompts.
test("adversarial buildPrompt is identical regardless of what conversation is passed", () => {
  const worker = adversarial({ loadQuery: () => noopQuery, model: "sonnet" });
  const model = makeSeededModel();

  const promptEmpty = worker.buildPrompt(model, []);
  const promptFull = worker.buildPrompt(model, ["turn A", "turn B", "turn C"]);

  assert.equal(
    promptEmpty,
    promptFull,
    "adversarial buildPrompt must be identical for empty and non-empty conversation lists",
  );
});

// ── Gate: addObjection allowed ───────────────────────────────────────────────

// WHY INVARIANT: addObjection is the adversarial worker's only write path — the gate must
// allow it so the worker can surface concerns into the working model.
test("adversarial gate allows addObjection — assertWithinGate does not throw", () => {
  const worker = adversarial({ loadQuery: () => noopQuery, model: "sonnet" });
  const opts = worker.buildOptions();
  assert.doesNotThrow(
    () => assertWithinGate(opts, "addObjection"),
    "adversarial worker must be allowed to call addObjection",
  );
});

// ── Gate: editGoal disallowed ────────────────────────────────────────────────

// WHY INVARIANT: the adversarial worker must not be able to editGoal — the Goal is owned
// by the person (seeded) and the reframe worker (rewritten from settled sections); allowing
// the adversarial worker to editGoal would let a background review agent overwrite intent.
test("adversarial gate disallows editGoal — assertWithinGate throws", () => {
  const worker = adversarial({ loadQuery: () => noopQuery, model: "sonnet" });
  const opts = worker.buildOptions();
  assert.throws(
    () => assertWithinGate(opts, "editGoal"),
    {},
    "adversarial worker must be refused when it tries to editGoal",
  );
});

// ── Run: produces addObjection actions ──────────────────────────────────────

// WHY INVARIANT: the adversarial worker's run must collect and return addObjection actions
// yielded by the query — the app applies them to the working model to register concerns.
// This confirms the run/query plumbing works end-to-end for the adversarial case.
test("adversarial run flattens addObjection actions from the query into the result array", async () => {
  const messages: WorkerMessage[] = [
    {
      type: "actions",
      actions: [
        { type: "addObjection", text: "Objection alpha: scope is unclear" },
      ],
    },
    {
      type: "actions",
      actions: [
        { type: "addObjection", text: "Objection beta: no rollback story" },
      ],
    },
  ];
  const fakeQuery: QueryFn = async function* (_args) {
    for (const msg of messages) yield msg;
  };

  const worker = adversarial({ loadQuery: () => fakeQuery, model: "sonnet" });
  const model = makeSeededModel();

  // Pass a non-empty conversation — the worker must ignore it in the prompt (blindness)
  // but the run itself must still complete and return all yielded actions.
  const actions = await worker.run(model, ["some conversation turn"]);

  assert.equal(actions.length, 2, "both addObjection actions must be returned");
  assert.deepEqual(actions[0], {
    type: "addObjection",
    text: "Objection alpha: scope is unclear",
  });
  assert.deepEqual(actions[1], {
    type: "addObjection",
    text: "Objection beta: no rollback story",
  });
});
