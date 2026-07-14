// SP-21/1 AC-6 — per-phase tool-gating: each phase worker is limited to its own tools, and
// an attempt to use a tool outside the gate is refused.
//
// WHY (INVARIANT — must always hold): the gate is the core safety contract of the
// scratchpad's orchestration model. A gap-filler that could freeze would commit an
// unreviewed artifact; an adversarial worker that could editGoal would let a background
// agent rewrite the person's intent. The gate must hold for every phase, every time —
// this probe lives forever.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assertWithinGate,
  GATES,
  gapFiller,
  integrator,
  type QueryFn,
  type QueryOptions,
} from "../scratchpad/workers/worker";
import { adversarial } from "../scratchpad/workers/adversarial";

// A query factory that yields nothing — only needed so the worker can be constructed.
const noopQuery: QueryFn = async function* (_args) {
  // yields nothing
};
const noopDeps = { loadQuery: () => noopQuery, model: "sonnet" };

// ── assertWithinGate primitive ──────────────────────────────────────────────

// WHY INVARIANT: assertWithinGate must refuse any tool in the disallowedTools list —
// the disallowed list is the safety hard stop regardless of what allowedTools says.
test("assertWithinGate throws for a tool in disallowedTools (even with empty allowedTools)", () => {
  const opts: QueryOptions = {
    model: "sonnet",
    allowedTools: [],
    disallowedTools: ["freeze"],
  };
  assert.throws(
    () => assertWithinGate(opts, "freeze"),
    /disallowed/i,
    "a disallowed tool must always throw",
  );
});

// WHY INVARIANT: when allowedTools is non-empty, any tool absent from that list is refused —
// this is the positive-list gate that limits each worker to exactly its job.
test("assertWithinGate throws when a tool is absent from a non-empty allowedTools list", () => {
  const opts: QueryOptions = {
    model: "sonnet",
    allowedTools: ["addObjection"],
    disallowedTools: [],
  };
  assert.throws(
    () => assertWithinGate(opts, "editGoal"),
    /not in the allowed/i,
    "a tool not in allowedTools must throw when allowedTools is non-empty",
  );
  assert.throws(
    () => assertWithinGate(opts, "freeze"),
    /not in the allowed/i,
    "freeze absent from allowedTools must throw",
  );
});

// WHY INVARIANT: an empty allowedTools list imposes no positive restriction —
// only the disallowed list matters when allowedTools is empty.
test("assertWithinGate does not throw when allowedTools is empty and tool is not disallowed", () => {
  const opts: QueryOptions = {
    model: "sonnet",
    allowedTools: [],
    disallowedTools: ["freeze"],
  };
  assert.doesNotThrow(
    () => assertWithinGate(opts, "editGoal"),
    "a tool absent from both lists (with empty allowed) must not throw",
  );
});

// WHY INVARIANT: assertWithinGate must pass when a tool is in allowedTools and not in
// disallowedTools — the happy path for every permitted phase action.
test("assertWithinGate does not throw for a tool in allowedTools and not in disallowedTools", () => {
  const opts: QueryOptions = {
    model: "sonnet",
    allowedTools: ["proposeSection", "editSection", "addNote"],
    disallowedTools: ["freeze", "writeArtifact", "editGoal"],
  };
  assert.doesNotThrow(() => assertWithinGate(opts, "proposeSection"));
  assert.doesNotThrow(() => assertWithinGate(opts, "editSection"));
  assert.doesNotThrow(() => assertWithinGate(opts, "addNote"));
});

// ── Gap-filler gate ─────────────────────────────────────────────────────────

// WHY INVARIANT: the gap-filler proposes structure — it must never be able to call freeze
// and commit the artifact. The AC specifically calls this out as the canonical example.
test("gap-filler gate disallows freeze — assertWithinGate throws when gap-filler tries to freeze", () => {
  const worker = gapFiller(noopDeps);
  const opts = worker.buildOptions();
  assert.throws(
    () => assertWithinGate(opts, "freeze"),
    /disallowed|not in the allowed/i,
    "gap-filler must not be able to call freeze",
  );
});

// WHY INVARIANT: the gap-filler must not be able to editGoal — only the reframe worker
// may alter the Goal; gap-filling workers fill surrounding structure only.
test("gap-filler gate disallows editGoal — assertWithinGate throws when gap-filler tries to editGoal", () => {
  const worker = gapFiller(noopDeps);
  const opts = worker.buildOptions();
  assert.throws(
    () => assertWithinGate(opts, "editGoal"),
    /disallowed|not in the allowed/i,
    "gap-filler must not be able to edit the Goal",
  );
});

// ── Adversarial gate ────────────────────────────────────────────────────────

// WHY INVARIANT: the adversarial worker reviews intent but must never rewrite the Goal —
// rewriting is the reframe worker's exclusive job. The AC calls this out explicitly.
test("adversarial gate disallows editGoal — assertWithinGate throws when adversarial tries to editGoal", () => {
  const worker = adversarial(noopDeps);
  const opts = worker.buildOptions();
  assert.throws(
    () => assertWithinGate(opts, "editGoal"),
    /disallowed|not in the allowed/i,
    "adversarial worker must not be able to edit the Goal",
  );
});

// WHY INVARIANT: the adversarial worker must not be able to freeze — it adds objections
// only; it has no path to commit the artifact.
test("adversarial gate disallows freeze — assertWithinGate throws when adversarial tries to freeze", () => {
  const worker = adversarial(noopDeps);
  const opts = worker.buildOptions();
  assert.throws(
    () => assertWithinGate(opts, "freeze"),
    /disallowed|not in the allowed/i,
    "adversarial worker must not be able to call freeze",
  );
});

// ── GATES is the single source of truth ─────────────────────────────────────

// WHY INVARIANT: the pre-gated factory functions must embed exactly the GATES constant
// entries — if they diverged the gate would be a fiction (different constraint at runtime
// vs what the constant declares). This probe pins both sides of the equation.
test("gapFiller buildOptions matches GATES.gapFiller exactly", () => {
  const worker = gapFiller(noopDeps);
  const opts = worker.buildOptions();
  assert.deepEqual(
    [...opts.allowedTools].sort(),
    [...GATES.gapFiller.allowedTools].sort(),
    "gapFiller allowedTools must equal GATES.gapFiller.allowedTools",
  );
  assert.deepEqual(
    [...opts.disallowedTools].sort(),
    [...GATES.gapFiller.disallowedTools].sort(),
    "gapFiller disallowedTools must equal GATES.gapFiller.disallowedTools",
  );
});

test("integrator buildOptions matches GATES.integrator exactly", () => {
  const worker = integrator(noopDeps);
  const opts = worker.buildOptions();
  assert.deepEqual(
    [...opts.allowedTools].sort(),
    [...GATES.integrator.allowedTools].sort(),
    "integrator allowedTools must equal GATES.integrator.allowedTools",
  );
  assert.deepEqual(
    [...opts.disallowedTools].sort(),
    [...GATES.integrator.disallowedTools].sort(),
    "integrator disallowedTools must equal GATES.integrator.disallowedTools",
  );
});

test("adversarial buildOptions matches GATES.adversarial exactly", () => {
  const worker = adversarial(noopDeps);
  const opts = worker.buildOptions();
  assert.deepEqual(
    [...opts.allowedTools].sort(),
    [...GATES.adversarial.allowedTools].sort(),
    "adversarial allowedTools must equal GATES.adversarial.allowedTools",
  );
  assert.deepEqual(
    [...opts.disallowedTools].sort(),
    [...GATES.adversarial.disallowedTools].sort(),
    "adversarial disallowedTools must equal GATES.adversarial.disallowedTools",
  );
});
