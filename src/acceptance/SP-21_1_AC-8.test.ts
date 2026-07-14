// SP-21/1 AC-8 — The freeze is human-only, gated, and signed.
//
// The freeze function is the sole human-authorization gate for publishing a TEP.
// It must refuse when no approval token is present, must refuse when the model has not passed
// the readiness check (coverage green + dry run clean), and when both preconditions are met
// it must call the signing tool with the projected artifact body and return the artifact
// reference. These are standing invariants — the human-only guarantee is broken the moment
// any path bypasses either guard.

import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyModel, reduce } from "../scratchpad/model";
import type { WorkingModel } from "../scratchpad/model";
import { freeze } from "../scratchpad/freeze";
import type {
  ApprovalToken,
  FreezeDeps,
  SigningTool,
} from "../scratchpad/freeze";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** A model that satisfies freezeEnabled: one readiness record with covered+cleanCut. */
function coveredAndCleanModel(): WorkingModel {
  let m = emptyModel("tep");
  ({ model: m } = reduce(m, {
    type: "seedGoal",
    text: "Build the Tandem scratchpad authoring surface",
  }));
  ({ model: m } = reduce(m, {
    type: "recordReadiness",
    record: { covered: true, cleanCut: true, gapSection: null },
  }));
  return m;
}

/** A signing-tool stub that records the args it receives. */
function capturingSigning(returnedTep = "tep-99"): {
  calls: Parameters<SigningTool["writeTep"]>[0][];
  tool: SigningTool;
} {
  const calls: Parameters<SigningTool["writeTep"]>[0][] = [];
  return {
    calls,
    tool: {
      writeTep: async (args) => {
        calls.push(args);
        return { tep: returnedTep };
      },
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// WHY INVARIANT: freeze with null approval must throw — the assistant has no path to mint
// an approval token, so null approval is the signed proof that no human authorized this.
test("freeze throws when approval is null (no human has approved)", async () => {
  const m = coveredAndCleanModel();
  const { tool } = capturingSigning();
  const deps: FreezeDeps = {
    approval: null,
    signing: tool,
    thinkingSpace: "ts-1",
  };
  await assert.rejects(
    () => freeze(m, deps),
    (err: unknown) => err instanceof Error,
    "freeze must throw when approval is null",
  );
});

// WHY INVARIANT: freeze with no readiness history must throw — freezeEnabled is false when
// there is no readiness record, so the gate must refuse before calling the signing tool.
test("freeze throws when the model has no readiness record (freezeEnabled false — empty history)", async () => {
  const m = emptyModel("tep"); // readinessHistory is [] → freezeEnabled false
  const approval: ApprovalToken = { value: "human-tok" };
  const { tool } = capturingSigning();
  const deps: FreezeDeps = { approval, signing: tool, thinkingSpace: "ts-1" };
  await assert.rejects(
    () => freeze(m, deps),
    (err: unknown) => err instanceof Error,
    "freeze must throw when there is no readiness record",
  );
});

// WHY INVARIANT: freeze with covered=false must throw — uncovered sections ("red") must keep
// the Freeze control disabled; the gate must enforce this even if approval is present.
test("freeze throws when the readiness record has covered=false (red sections remain)", async () => {
  let m = emptyModel("tep");
  ({ model: m } = reduce(m, {
    type: "seedGoal",
    text: "Draft intent with uncovered sections",
  }));
  ({ model: m } = reduce(m, {
    type: "recordReadiness",
    record: { covered: false, cleanCut: true, gapSection: null },
  }));
  const approval: ApprovalToken = { value: "human-tok" };
  const { tool } = capturingSigning();
  const deps: FreezeDeps = { approval, signing: tool, thinkingSpace: "ts-1" };
  await assert.rejects(
    () => freeze(m, deps),
    (err: unknown) => err instanceof Error,
    "freeze must throw when coverage is not green",
  );
});

// WHY INVARIANT: freeze with cleanCut=false must throw — the dry run named a gap, so the
// Freeze control stays disabled; approval alone cannot override a failing clean-cut check.
test("freeze throws when the readiness record has cleanCut=false (dry run named a gap)", async () => {
  let m = emptyModel("tep");
  ({ model: m } = reduce(m, {
    type: "seedGoal",
    text: "Intent with a gap in constraints",
  }));
  ({ model: m } = reduce(m, {
    type: "recordReadiness",
    record: { covered: true, cleanCut: false, gapSection: "constraints" },
  }));
  const approval: ApprovalToken = { value: "human-tok" };
  const { tool } = capturingSigning();
  const deps: FreezeDeps = { approval, signing: tool, thinkingSpace: "ts-1" };
  await assert.rejects(
    () => freeze(m, deps),
    (err: unknown) => err instanceof Error,
    "freeze must throw when the dry run did not cut clean",
  );
});

// WHY INVARIANT: with approval + a covered-and-clean model, freeze must call signing.writeTep
// exactly once with the correct thinking_space, the FROZEN_TEP_STATUS ('proposed'), a
// non-empty title, and a non-empty body — and must return the tep reference from the tool.
test("freeze calls signing.writeTep with correct args and returns the artifact when approved and ready", async () => {
  const m = coveredAndCleanModel();
  const approval: ApprovalToken = { value: "human-tok-42" };
  const { calls, tool } = capturingSigning("tep-signed-1");
  const deps: FreezeDeps = {
    approval,
    signing: tool,
    thinkingSpace: "thinking-space-abc",
  };

  const result = await freeze(m, deps);

  assert.equal(calls.length, 1, "signing.writeTep must be called exactly once");
  assert.equal(
    calls[0].thinking_space,
    "thinking-space-abc",
    "thinking_space must match the deps.thinkingSpace",
  );
  assert.equal(
    calls[0].status,
    "proposed",
    "status must be the FROZEN_TEP_STATUS ('proposed')",
  );
  assert.ok(
    typeof calls[0].title === "string" && calls[0].title.length > 0,
    "title must be a non-empty string",
  );
  assert.ok(
    typeof calls[0].body === "string" && calls[0].body.length > 0,
    "body must be a non-empty string",
  );
  assert.equal(
    result.tep,
    "tep-signed-1",
    "freeze must return the tep reference produced by the signing tool",
  );
});

// WHY INVARIANT: the title passed to the signing tool derives from the goal section text,
// not from a static string or an external source — the goal is the artifact's identity.
test("the title passed to signing.writeTep is derived from the goal section text", async () => {
  let m = emptyModel("tep");
  ({ model: m } = reduce(m, {
    type: "seedGoal",
    text: "A very distinctive goal title for the signing check",
  }));
  ({ model: m } = reduce(m, {
    type: "recordReadiness",
    record: { covered: true, cleanCut: true, gapSection: null },
  }));

  const { calls, tool } = capturingSigning();
  const approval: ApprovalToken = { value: "tok" };
  const deps: FreezeDeps = { approval, signing: tool, thinkingSpace: "ts" };
  await freeze(m, deps);

  assert.ok(
    calls[0].title.includes("A very distinctive goal title"),
    `signing title must include the goal text; got: ${calls[0].title}`,
  );
});
