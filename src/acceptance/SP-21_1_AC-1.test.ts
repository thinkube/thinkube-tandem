// SP-21/1 AC-1 — Writing a rough intent then running the gap-filler yields proposed sections
// with state markers, and the gap-filler cannot write a TEP or spec file.
//
// WHY (INVARIANT): The gap-filler's sole job is to propose structure — it must never produce
// the final artifact or trigger the sign-off at any time. Standing gate requirements:
//   (1) proposeSection actions applied via reduce() create sections with state:'proposed'
//   (2) writeArtifact and freeze remain disallowed tools for the gap-filler worker
// Any refactor that loosens the gate or changes the proposed-state marker must break this test.

import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "../scratchpad/model";
import type { Action } from "../scratchpad/model";
import {
  gapFiller,
  GATES,
  assertWithinGate,
} from "../scratchpad/workers/worker";
import type { QueryFn, WorkerMessage } from "../scratchpad/workers/worker";

/** Fake QueryFn: yields one WorkerMessage containing the supplied actions, then ends. */
function makeQuery(actions: Action[]): QueryFn {
  return async function* () {
    const msg: WorkerMessage = { type: "actions", actions };
    yield msg;
  };
}

// ── per-phase tool-gate declarations ─────────────────────────────────────────

test("GATES.gapFiller.disallowedTools includes 'writeArtifact' — gap-filler cannot produce a TEP or spec file", () => {
  assert.ok(
    GATES.gapFiller.disallowedTools.includes("writeArtifact"),
    "writeArtifact must be in gapFiller disallowedTools — the gap-filler must never write the delivered artifact",
  );
});

test("GATES.gapFiller.disallowedTools includes 'freeze' — gap-filler cannot trigger the human-only sign-off", () => {
  assert.ok(
    GATES.gapFiller.disallowedTools.includes("freeze"),
    "freeze must be in gapFiller disallowedTools — the gap-filler has no path to the Freeze control",
  );
});

test("GATES.gapFiller.disallowedTools includes 'editGoal' — gap-filler may not rewrite the person's stated intent", () => {
  assert.ok(
    GATES.gapFiller.disallowedTools.includes("editGoal"),
    "editGoal must be in gapFiller disallowedTools — the gap-filler proposes structure around the goal, never overwrites it",
  );
});

test("GATES.gapFiller.allowedTools covers proposeSection, editSection, addNote — the three legitimate structure-filling operations", () => {
  const { allowedTools } = GATES.gapFiller;
  assert.ok(
    allowedTools.includes("proposeSection"),
    "proposeSection must be allowed for gapFiller",
  );
  assert.ok(
    allowedTools.includes("editSection"),
    "editSection must be allowed for gapFiller",
  );
  assert.ok(
    allowedTools.includes("addNote"),
    "addNote must be allowed for gapFiller",
  );
});

// ── assertWithinGate enforces the gate at the call site ──────────────────────

test("assertWithinGate throws when the gap-filler attempts writeArtifact", () => {
  const worker = gapFiller({ loadQuery: () => makeQuery([]), model: "sonnet" });
  const opts = worker.buildOptions();
  assert.throws(
    () => assertWithinGate(opts, "writeArtifact"),
    "assertWithinGate must throw when writeArtifact is attempted inside the gapFiller gate — this is the enforcement point",
  );
});

test("assertWithinGate throws when the gap-filler attempts freeze", () => {
  const worker = gapFiller({ loadQuery: () => makeQuery([]), model: "sonnet" });
  const opts = worker.buildOptions();
  assert.throws(
    () => assertWithinGate(opts, "freeze"),
    "assertWithinGate must throw when freeze is attempted inside the gapFiller gate",
  );
});

test("assertWithinGate throws when the gap-filler attempts editGoal", () => {
  const worker = gapFiller({ loadQuery: () => makeQuery([]), model: "sonnet" });
  const opts = worker.buildOptions();
  assert.throws(
    () => assertWithinGate(opts, "editGoal"),
    "assertWithinGate must throw when editGoal is attempted inside the gapFiller gate",
  );
});

test("assertWithinGate does not throw when the gap-filler attempts proposeSection", () => {
  const worker = gapFiller({ loadQuery: () => makeQuery([]), model: "sonnet" });
  const opts = worker.buildOptions();
  assert.doesNotThrow(
    () => assertWithinGate(opts, "proposeSection"),
    "proposeSection is an explicitly allowed tool for the gap-filler",
  );
});

test("assertWithinGate does not throw when the gap-filler attempts addNote", () => {
  const worker = gapFiller({ loadQuery: () => makeQuery([]), model: "sonnet" });
  const opts = worker.buildOptions();
  assert.doesNotThrow(
    () => assertWithinGate(opts, "addNote"),
    "addNote is an explicitly allowed tool for the gap-filler",
  );
});

// ── gap-filler run: proposeSection actions → sections with state:'proposed' ──

test("gap-filler run returns proposeSection actions; reduce() yields sections with state:'proposed'", async () => {
  let model = emptyModel("tep");
  // Seed the goal so the gap-filler has something to fill around; seedGoal → phase 'shaping'.
  ({ model } = reduce(model, {
    type: "seedGoal",
    text: "Introduce a human-paced intent-authoring surface with a human-only signed freeze",
  }));

  const proposedActions: Action[] = [
    {
      type: "proposeSection",
      kind: "constraints",
      text: "Must not call create_slice in non-committing mode",
      workerId: "gap-worker-1",
    },
    {
      type: "proposeSection",
      kind: "elements",
      text: "Working model, reducer, phase workers, freeze control",
      workerId: "gap-worker-1",
    },
    {
      type: "proposeSection",
      kind: "gap",
      text: "Coverage of the approval-token seam for the freeze gate is uncharted",
      workerId: "gap-worker-1",
    },
  ];

  const worker = gapFiller({
    loadQuery: () => makeQuery(proposedActions),
    model: "sonnet",
  });

  const actions = await worker.run(model, [
    "Person: please help me fill this out",
  ]);

  // Apply each returned action through the pure reducer.
  let m = model;
  for (const action of actions) {
    ({ model: m } = reduce(m, action));
  }

  const proposedSections = m.sections.filter((s) => s.state === "proposed");
  assert.ok(
    proposedSections.length >= 1,
    `expected at least one proposed section after running the gap-filler, got ${proposedSections.length}`,
  );
  for (const s of proposedSections) {
    assert.equal(
      s.state,
      "proposed",
      `section kind '${s.kind}' must carry state:'proposed' — each gap-filler result must be a proposal, never settled outright`,
    );
  }
});

test("gap-filler run: every proposed section produced by proposeSection has a non-empty id", async () => {
  let model = emptyModel("tep");
  ({ model } = reduce(model, {
    type: "seedGoal",
    text: "Some feature intent",
  }));

  const worker = gapFiller({
    loadQuery: () =>
      makeQuery([
        {
          type: "proposeSection",
          kind: "criteria",
          text: "A user can add a note to any section and it is retained on reopen",
          workerId: "gap-1",
        },
        {
          type: "proposeSection",
          kind: "verification",
          text: "The acceptance probe runs the serialise/deserialise round-trip",
          workerId: "gap-1",
        },
      ]),
    model: "sonnet",
  });

  const actions = await worker.run(model, []);
  let m = model;
  for (const action of actions) {
    ({ model: m } = reduce(m, action));
  }

  // Every section that came from a proposeSection action must have a real id.
  const nonGoalSections = m.sections.filter((s) => s.kind !== "goal");
  assert.ok(
    nonGoalSections.length >= 1,
    "at least one proposed section must exist",
  );
  for (const s of nonGoalSections) {
    assert.ok(
      typeof s.id === "string" && s.id.length > 0,
      `section of kind '${s.kind}' must have a non-empty string id — got: ${JSON.stringify(s.id)}`,
    );
  }
});

test("gap-filler buildOptions pins the model from WorkerFactoryDeps", () => {
  const worker = gapFiller({
    loadQuery: () => makeQuery([]),
    model: "claude-sonnet-4-5",
  });
  const opts = worker.buildOptions();
  assert.equal(
    opts.model,
    "claude-sonnet-4-5",
    "buildOptions must expose the model from WorkerFactoryDeps — model must not be hard-coded",
  );
});
