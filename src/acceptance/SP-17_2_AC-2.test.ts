// SP-17/2 AC2 — the worker PreToolUse hook rewrites EVERY fence-allowed Bash call whose
// command rtkRewrite supports — unconditionally, with no enable gate.
//
// WHY (TRANSITION — proves the enable gate was removed): in SP-17/1 the rewrite was gated on
// `rtkEnabled === true`. SP-17/2 removes that gate: every fence-allowed Bash call on
// RTK_SUPPORTED is now rewritten unconditionally. Proved here by showing the rewrite fires
// with NO rtkEnabled in the deps — the field no longer exists in OrchestratorDeps.
// The old tests asserting "rtkEnabled:false → no rewrite" and "rtkEnabled:absent → no
// rewrite" are gone because the concept they tested is gone. Once this change ships and the
// suite is green, that TRANSITION is complete.
//
// WHY (INVARIANT — must always hold, lives forever): fences decide first; the rewrite runs
// ONLY on the allow path. A fence-denied command is returned unchanged with no updatedInput.
// An unsupported/compound command or non-Bash allowed call passes through unchanged. These
// precedences must survive any future refactor of the hook chain.
//
// Testability seam (contract): inject OrchestratorDeps.sdkQuery with a fake that captures
// options.hooks.PreToolUse; drive the private runViaSdk via TypeScript cast
// (svc as any).runViaSdk(unit, spec, cwd, onPark, unionFootprint, baseline); then invoke
// the captured PreToolUse hook directly with { tool_name, tool_input }.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OrchestratorService,
  type OrchestratorDeps,
} from "../services/OrchestratorService";
import type { SchedUnit } from "../services/orchestratorCore";

// ── Minimal test unit (code role, footprint = one file) ──────────────────────

const TEST_UNIT: SchedUnit = {
  id: "TEP-17_SP-2_SL-2#eu-1",
  slice: "TEP-17_SP-2_SL-2",
  footprint: ["src/services/rtkRewrite.ts"],
  requires: [],
  shape: "serial",
  role: "code",
  note: "implement always-on rtk wiring",
};

const SPEC_NUMBER = "17/2";
const CWD = "/nonexistent-cwd-ac2";
const noop = () => {};

// ── Factory: minimal deps with a capturing sdkQuery — NO rtkEnabled anywhere ─
// The absence of rtkEnabled in the deps object is the TRANSITION proof:
// in the old opt-in wiring the hook checked `this.deps.rtkEnabled === true`;
// this factory proves the unconditional hook fires without it.

function makeCapturingDeps(capturedHooks: {
  current: unknown;
}): OrchestratorDeps {
  return {
    worktrees: {} as never,
    arbiter: {} as never,
    store: {} as never,
    output: { appendLine: () => {} } as never,
    canonicalRepo: "/nonexistent-canonical",
    workerModel: {},
    // NOTE: rtkEnabled is intentionally ABSENT — removed in SP-17/2.
    // NOTE: rtkBinaryPresent is absent — runViaSdk does not call the binary guard;
    //   that guard lives in dispatchSpec. Not setting it here keeps the deps minimal.
    sdkQuery: ((args: {
      prompt: unknown;
      options: Record<string, unknown>;
    }) => {
      capturedHooks.current = args.options.hooks;
      return (async function* () {
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "done",
          session_id: "sess-ac2",
        };
      })();
    }) as never,
    containmentCheck: async () => ({ ok: true as const, violations: [] }),
  } as unknown as OrchestratorDeps;
}

/** Drive the private runViaSdk via TypeScript cast — the "focused-cast test helper". */
async function driveRunViaSdk(
  svc: OrchestratorService,
  unit: SchedUnit = TEST_UNIT,
  unionFootprint: string[] = [],
): Promise<void> {
  await (svc as unknown as Record<string, Function>).runViaSdk(
    unit,
    SPEC_NUMBER,
    CWD,
    noop, // onPark
    unionFootprint,
    [], // baseline
  );
}

/** Extract the first PreToolUse hook from the captured hooks structure. */
function extractHook(capturedHooks: {
  current: unknown;
}): (input: unknown) => Promise<Record<string, unknown>> {
  const hooks = capturedHooks.current as Record<
    string,
    Array<{ hooks: Array<(input: unknown) => unknown> }>
  >;
  assert.ok(
    capturedHooks.current,
    "hooks object was passed to the worker query options",
  );
  const chain = hooks?.PreToolUse?.[0]?.hooks;
  assert.ok(
    Array.isArray(chain),
    "options.hooks.PreToolUse[0].hooks is an array",
  );
  const hook = chain[0];
  assert.equal(typeof hook, "function", "the PreToolUse hook is a function");
  return hook as (input: unknown) => Promise<Record<string, unknown>>;
}

// ── AC-2 tests ────────────────────────────────────────────────────────────────

test("PreToolUse hook — REWRITE: allowed Bash call with supported command returns updatedInput with rtk-wrapped command (no rtkEnabled in deps)", async () => {
  // WHY (TRANSITION): proves the enable gate was removed — the rewrite fires unconditionally,
  // without rtkEnabled set anywhere in deps. With the old opt-in, this same dep object (no
  // rtkEnabled) would have produced no rewrite; with SP-17/2 it MUST rewrite.
  const capturedHooks: { current: unknown } = { current: undefined };
  const svc = new OrchestratorService(makeCapturingDeps(capturedHooks));
  await driveRunViaSdk(svc);
  const hook = extractHook(capturedHooks);

  const result = await hook({
    tool_name: "Bash",
    tool_input: { command: "git status" },
  });

  const out = result?.hookSpecificOutput as Record<string, unknown> | undefined;
  assert.ok(out, "hookSpecificOutput is present");
  assert.equal(out.hookEventName, "PreToolUse", "hookEventName is PreToolUse");
  const updated = out.updatedInput as Record<string, unknown> | undefined;
  assert.ok(updated, "updatedInput is present");
  assert.equal(updated.command, "rtk git status", "command is rtk-wrapped");
});

test("PreToolUse hook — REWRITE: wraps a variety of supported commands unconditionally", async () => {
  // WHY (INVARIANT): the unconditional rewrite applies to every command on RTK_SUPPORTED;
  // checking multiple entries guards against a partial list or a match-by-prefix mistake.
  const capturedHooks: { current: unknown } = { current: undefined };
  const svc = new OrchestratorService(makeCapturingDeps(capturedHooks));
  await driveRunViaSdk(svc);
  const hook = extractHook(capturedHooks);

  for (const [cmd, expected] of [
    ["grep -r TODO src/", "rtk grep -r TODO src/"],
    ["find . -name '*.ts'", "rtk find . -name '*.ts'"],
    ["ls -la", "rtk ls -la"],
    ["git diff HEAD", "rtk git diff HEAD"],
  ] as const) {
    const result = await hook({
      tool_name: "Bash",
      tool_input: { command: cmd },
    });
    const updated = (result?.hookSpecificOutput as Record<string, unknown>)
      ?.updatedInput as Record<string, unknown> | undefined;
    assert.ok(updated, `updatedInput present for "${cmd}"`);
    assert.equal(updated.command, expected, `"${cmd}" is rtk-wrapped`);
  }
});

test("PreToolUse hook — PASSTHROUGH: allowed Bash call with unsupported command passes through with no updatedInput", async () => {
  // WHY (INVARIANT): only commands on RTK_SUPPORTED are rewritten; unsupported commands
  // must pass through unchanged — a mangled or uncompressed command is always better than
  // a silently-wrong rewrite.
  const capturedHooks: { current: unknown } = { current: undefined };
  const svc = new OrchestratorService(makeCapturingDeps(capturedHooks));
  await driveRunViaSdk(svc);
  const hook = extractHook(capturedHooks);

  const result = await hook({
    tool_name: "Bash",
    tool_input: { command: "npm install" },
  });

  const out = result?.hookSpecificOutput as Record<string, unknown> | undefined;
  assert.ok(
    !out?.updatedInput,
    "no updatedInput for a command not on RTK_SUPPORTED — passthrough",
  );
  assert.ok(!out?.permissionDecision, "no deny — the command is allowed");
});

test("PreToolUse hook — PASSTHROUGH: allowed Bash compound/pipeline command passes through with no updatedInput", async () => {
  // WHY (INVARIANT): compound or pipeline commands are never rewritten, even when the leading
  // word is on RTK_SUPPORTED. A mangled compound command is worse than an uncompressed one;
  // conservative rewriting is the permanent contract.
  const capturedHooks: { current: unknown } = { current: undefined };
  const svc = new OrchestratorService(makeCapturingDeps(capturedHooks));
  await driveRunViaSdk(svc);
  const hook = extractHook(capturedHooks);

  // Pipe — leading word "git status" is supported but the line is compound.
  const pipeResult = await hook({
    tool_name: "Bash",
    tool_input: { command: "git status | grep modified" },
  });
  const pipeOut = pipeResult?.hookSpecificOutput as
    Record<string, unknown> | undefined;
  assert.ok(!pipeOut?.updatedInput, "no updatedInput for a pipe (|) command");

  // Logical AND.
  const andResult = await hook({
    tool_name: "Bash",
    tool_input: { command: "grep foo src/ && echo done" },
  });
  const andOut = andResult?.hookSpecificOutput as
    Record<string, unknown> | undefined;
  assert.ok(!andOut?.updatedInput, "no updatedInput for a && command");
});

test("PreToolUse hook — DENY: a Write to a path outside the footprint is denied unchanged — no updatedInput (fences decide first)", async () => {
  // WHY (INVARIANT): fences screen the ORIGINAL command and their deny is returned UNCHANGED.
  // The RTK rewrite runs ONLY on the allow path — a denied call is never rewritten. This
  // precedence (fences first, rewrite only on allow) must survive any future refactor.
  const capturedHooks: { current: unknown } = { current: undefined };
  const svc = new OrchestratorService(makeCapturingDeps(capturedHooks));
  // Pass an empty unionFootprint so the footprintGuard denies any write (no allowed paths).
  await driveRunViaSdk(svc, TEST_UNIT, []);
  const hook = extractHook(capturedHooks);

  // Write to a path not in the footprint → footprintGuard denies it.
  const result = await hook({
    tool_name: "Write",
    tool_input: {
      file_path: "src/views/sidebar/ChatPanel.ts",
      content: "outside footprint",
    },
  });

  const out = result?.hookSpecificOutput as Record<string, unknown> | undefined;
  assert.ok(out, "hookSpecificOutput is present (it is a deny)");
  assert.equal(out.permissionDecision, "deny", "the call is denied");
  assert.ok(
    !out.updatedInput,
    "no updatedInput on a deny — the deny is returned unchanged, never carrying a rewrite",
  );
});

test("PreToolUse hook — PASSTHROUGH: allowed non-Bash tool call passes through with no updatedInput", async () => {
  // WHY (INVARIANT): the rewrite only applies to Bash tool calls; other allowed calls (Read,
  // etc.) pass through without updatedInput, unconditionally. The scope of the rewrite is
  // Bash only — that must hold forever.
  const capturedHooks: { current: unknown } = { current: undefined };
  const svc = new OrchestratorService(makeCapturingDeps(capturedHooks));
  // Use the unit's footprint as the unionFootprint so a Read of an in-footprint path is allowed.
  await driveRunViaSdk(svc, TEST_UNIT, TEST_UNIT.footprint);
  const hook = extractHook(capturedHooks);

  // A Read of an in-footprint path — allowed, but not Bash → no rewrite.
  const result = await hook({
    tool_name: "Read",
    tool_input: { file_path: "src/services/rtkRewrite.ts" },
  });

  const out = result?.hookSpecificOutput as Record<string, unknown> | undefined;
  assert.ok(!out?.updatedInput, "no updatedInput for an allowed non-Bash call");
  assert.ok(
    !out?.permissionDecision,
    "no deny for an allowed Read inside footprint",
  );
});
