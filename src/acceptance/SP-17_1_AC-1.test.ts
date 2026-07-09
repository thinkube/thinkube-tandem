// SP-17/1 AC1 — `resolveWorkerModel(config, role)` is a PURE, session-model-decoupled resolver.
//
// WHY (INVARIANT — must always hold, lives forever): a worker's model must be resolved from the
// operator's config alone — "sonnet" when nothing is declared, the per-role override when one exists
// for that role, otherwise the configured base — and NEVER from `process.env.ANTHROPIC_MODEL` (the
// model that drives the pairing session). This decoupling is the whole point of the spec: the strong
// session model must never leak into worker sessions. It is a standing behaviour, not a one-time
// change, so this probe lives permanently.

import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveWorkerModel } from "../services/workerModel";

test("resolveWorkerModel returns the named default 'sonnet' when the config declares no worker model", () => {
  // Empty config, no role.
  assert.equal(resolveWorkerModel({}), "sonnet");
  // Empty config, a role — still the default (no override, no base).
  assert.equal(resolveWorkerModel({}, "code"), "sonnet");
  // A role map that has no entry for this role → still the default.
  assert.equal(
    resolveWorkerModel({ workerModelByRole: {} }, "assessor"),
    "sonnet",
  );
  assert.equal(
    resolveWorkerModel({ workerModelByRole: { judge: "opus" } }, "assessor"),
    "sonnet",
  );
});

test("resolveWorkerModel returns the configured base worker model when set and no role override applies", () => {
  assert.equal(resolveWorkerModel({ workerModel: "claude-x" }), "claude-x");
  assert.equal(
    resolveWorkerModel({ workerModel: "claude-x" }, "code"),
    "claude-x",
  );
  // A role map present but with no entry for this role → falls through to the base, not the default.
  assert.equal(
    resolveWorkerModel(
      { workerModel: "claude-x", workerModelByRole: { test: "haiku" } },
      "code",
    ),
    "claude-x",
  );
});

test("resolveWorkerModel returns the per-role override when the config provides one for that role", () => {
  const config = {
    workerModel: "sonnet",
    workerModelByRole: { judge: "opus" },
  };
  // The role WITH an override gets it (raised above the base).
  assert.equal(resolveWorkerModel(config, "judge"), "opus");
  // A role WITHOUT an override falls back to the base — the override refines one role only.
  assert.equal(resolveWorkerModel(config, "assessor"), "sonnet");
  // No role passed → base, even though a role map exists.
  assert.equal(resolveWorkerModel(config), "sonnet");
  // The override applies even when there is no base worker model (default still the fallback).
  assert.equal(
    resolveWorkerModel({ workerModelByRole: { judge: "opus" } }, "judge"),
    "opus",
  );
});

test("resolveWorkerModel is pure — identical inputs yield identical output", () => {
  const config = {
    workerModel: "sonnet",
    workerModelByRole: { judge: "opus" },
  };
  assert.equal(
    resolveWorkerModel(config, "judge"),
    resolveWorkerModel(config, "judge"),
  );
  assert.equal(resolveWorkerModel({}, "code"), resolveWorkerModel({}, "code"));
});

test("resolveWorkerModel is independent of process.env.ANTHROPIC_MODEL (the session model)", () => {
  // Set the session-model env var to a sentinel that the resolver must NEVER return.
  const prev = process.env.ANTHROPIC_MODEL;
  process.env.ANTHROPIC_MODEL = "SENTINEL-SESSION-MODEL-DO-NOT-RETURN";
  try {
    // Unconfigured → still the named 'sonnet' default, NOT the env sentinel.
    assert.equal(resolveWorkerModel({}), "sonnet");
    assert.equal(resolveWorkerModel({}, "code"), "sonnet");
    // A configured base is honoured, unaffected by the env.
    assert.equal(
      resolveWorkerModel({ workerModel: "claude-x" }, "code"),
      "claude-x",
    );
    // A per-role override is honoured, unaffected by the env.
    assert.equal(
      resolveWorkerModel({ workerModelByRole: { judge: "opus" } }, "judge"),
      "opus",
    );
  } finally {
    if (prev === undefined) delete process.env.ANTHROPIC_MODEL;
    else process.env.ANTHROPIC_MODEL = prev;
  }
});
