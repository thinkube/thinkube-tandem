// SP-17/2 AC2 — the worker PreToolUse hook rewrites allowed Bash calls when rtkEnabled:true.
//
// WHY (INVARIANT — must always hold, lives forever): when rtkEnabled is true the
// hook must wrap allowed Bash commands on RTK_SUPPORTED with `rtk`; when rtkEnabled
// is false or absent the same command must pass through unchanged; and a call the
// fences deny must be returned UNCHANGED — the deny stands with no updatedInput and
// the rewrite only ever runs on the allow path. This precedence (fences first, rewrite
// only on allow) is a standing contract that must survive any future refactor of the
// hook chain.
//
// Testability seam (contract): inject OrchestratorDeps.sdkQuery with a fake that
// captures options.hooks.PreToolUse, drive the private runViaSdk via TypeScript cast
// (svc as any).runViaSdk(...) with rtkEnabled:true on the deps, then invoke the
// captured hook directly with { tool_name, tool_input:{command} }.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OrchestratorService,
  type OrchestratorDeps,
} from "../services/OrchestratorService";
import type { SchedUnit } from "../services/orchestratorCore";

// ── Minimal test unit (code role, footprint = one file) ──────────────────────

const TEST_UNIT: SchedUnit = {
  id: "TEP-17_SP-2_SL-1#eu-1",
  slice: "TEP-17_SP-2_SL-1",
  footprint: ["src/services/rtkRewrite.ts"],
  requires: [],
  shape: "serial",
  role: "code",
  note: "implement rtkRewrite",
};

const SPEC_NUMBER = "17/2";
const CWD = "/nonexistent-cwd-ac2";
const noop = () => {};

// ── Factory: minimal deps with a capturing sdkQuery ──────────────────────────

function makeCapturingDeps(
  rtkEnabled: boolean | undefined,
  capturedHooks: { current: unknown },
): OrchestratorDeps {
  return {
    worktrees: {} as never,
    arbiter: {} as never,
    store: {} as never,
    output: { appendLine: () => {} } as never,
    canonicalRepo: "/nonexistent-canonical",
    workerModel: {},
    rtkEnabled,
    // Capture the hooks from options and yield one success result so runViaSdk completes.
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
    // Containment check: always ok so PostToolUse never aborts the run.
    containmentCheck: async () => ({ ok: true as const, violations: [] }),
  } as unknown as OrchestratorDeps;
}

/** Drive the private runViaSdk via TypeScript cast and return when it resolves. */
async function driveRunViaSdk(
  svc: OrchestratorService,
  unit: SchedUnit = TEST_UNIT,
): Promise<void> {
  // Access the private method via cast — the "focused-cast test helper" the contract names.
  await (svc as unknown as Record<string, Function>).runViaSdk(
    unit,
    SPEC_NUMBER,
    CWD,
    noop, // onPark
    [], // unionFootprint
    [], // baseline
    // oracleFor omitted — fail-soft, worker runs without verify tool (oracle stays undefined)
  );
}

// ── AC-2 tests ────────────────────────────────────────────────────────────────

test("PreToolUse hook — allowed Bash call with rtkEnabled:true returns hookSpecificOutput with rtk-wrapped updatedInput", async () => {
  // INVARIANT: when rtkEnabled is true and a Bash command is on RTK_SUPPORTED and the
  // fences all allow, the hook must inject updatedInput with the rtk-wrapped command.
  const capturedHooks: { current: unknown } = { current: undefined };
  const svc = new OrchestratorService(makeCapturingDeps(true, capturedHooks));

  await driveRunViaSdk(svc);

  assert.ok(
    capturedHooks.current,
    "hooks object was passed to the worker query options",
  );

  const hooks = capturedHooks.current as Record<
    string,
    Array<{ hooks: Array<(input: unknown) => unknown> }>
  >;
  const preToolUseChain = hooks?.PreToolUse?.[0]?.hooks;
  assert.ok(
    Array.isArray(preToolUseChain),
    "options.hooks.PreToolUse[0].hooks is an array",
  );
  const hook = preToolUseChain[0];
  assert.equal(typeof hook, "function", "the hook is a function");

  // An allowed Bash call for a command on RTK_SUPPORTED → updatedInput with rtk-wrapped form.
  const result = (await hook({
    tool_name: "Bash",
    tool_input: { command: "git status" },
  })) as Record<string, unknown>;

  const out = result?.hookSpecificOutput as Record<string, unknown> | undefined;
  assert.ok(out, "hookSpecificOutput is present");
  assert.equal(out.hookEventName, "PreToolUse", "hookEventName is PreToolUse");
  const updated = out.updatedInput as Record<string, unknown> | undefined;
  assert.ok(updated, "updatedInput is present");
  assert.equal(updated.command, "rtk git status", "command is rtk-wrapped");
});

test("PreToolUse hook — rtkEnabled:true but command not on RTK_SUPPORTED passes through with no updatedInput", async () => {
  // INVARIANT: only commands on RTK_SUPPORTED are rewritten; others pass through unchanged.
  const capturedHooks: { current: unknown } = { current: undefined };
  const svc = new OrchestratorService(makeCapturingDeps(true, capturedHooks));

  await driveRunViaSdk(svc);

  const hooks = capturedHooks.current as Record<
    string,
    Array<{ hooks: Array<(input: unknown) => unknown> }>
  >;
  const hook = hooks?.PreToolUse?.[0]?.hooks?.[0];
  assert.ok(hook, "hook exists");

  // A command NOT on RTK_SUPPORTED → allow but no rewrite.
  const result = (await hook({
    tool_name: "Bash",
    tool_input: { command: "npm install" },
  })) as Record<string, unknown>;

  const out = result?.hookSpecificOutput as Record<string, unknown> | undefined;
  assert.ok(
    !out?.updatedInput,
    "no updatedInput for a command not on RTK_SUPPORTED",
  );
  assert.ok(!out?.permissionDecision, "no deny — the command is allowed");
});

test("PreToolUse hook — rtkEnabled:false passes through allowed Bash call with no updatedInput", async () => {
  // INVARIANT: when rtkEnabled is false the hook must not rewrite any command.
  const capturedHooks: { current: unknown } = { current: undefined };
  const svc = new OrchestratorService(makeCapturingDeps(false, capturedHooks));

  await driveRunViaSdk(svc);

  const hooks = capturedHooks.current as Record<
    string,
    Array<{ hooks: Array<(input: unknown) => unknown> }>
  >;
  const hook = hooks?.PreToolUse?.[0]?.hooks?.[0];
  assert.ok(hook, "hook exists");

  const result = (await hook({
    tool_name: "Bash",
    tool_input: { command: "git status" },
  })) as Record<string, unknown>;

  const out = result?.hookSpecificOutput as Record<string, unknown> | undefined;
  assert.ok(
    !out?.updatedInput,
    "no updatedInput when rtkEnabled is false — command passes through",
  );
  assert.ok(!out?.permissionDecision, "no deny either");
});

test("PreToolUse hook — rtkEnabled absent (undefined) passes through allowed Bash call with no updatedInput", async () => {
  // INVARIANT: omitting rtkEnabled from deps must be equivalent to false — no rewrite.
  const capturedHooks: { current: unknown } = { current: undefined };
  const svc = new OrchestratorService(
    makeCapturingDeps(undefined, capturedHooks),
  );

  await driveRunViaSdk(svc);

  const hooks = capturedHooks.current as Record<
    string,
    Array<{ hooks: Array<(input: unknown) => unknown> }>
  >;
  const hook = hooks?.PreToolUse?.[0]?.hooks?.[0];
  assert.ok(hook, "hook exists");

  const result = (await hook({
    tool_name: "Bash",
    tool_input: { command: "git status" },
  })) as Record<string, unknown>;

  const out = result?.hookSpecificOutput as Record<string, unknown> | undefined;
  assert.ok(
    !out?.updatedInput,
    "no updatedInput when rtkEnabled is absent — command passes through",
  );
});

test("PreToolUse hook — a fence-denied Write outside footprint is returned unchanged with no updatedInput (rtkEnabled:true)", async () => {
  // INVARIANT: the deny must stand unchanged — the rewrite never runs on the deny path.
  // Fences screen the ORIGINAL command; rtk runs ONLY on the allow path, so a denied call
  // is never rewritten.
  const capturedHooks: { current: unknown } = { current: undefined };
  const svc = new OrchestratorService(makeCapturingDeps(true, capturedHooks));

  await driveRunViaSdk(svc);

  const hooks = capturedHooks.current as Record<
    string,
    Array<{ hooks: Array<(input: unknown) => unknown> }>
  >;
  const hook = hooks?.PreToolUse?.[0]?.hooks?.[0];
  assert.ok(hook, "hook exists");

  // Write to a path outside the unit's footprint (footprint = ["src/services/rtkRewrite.ts"]).
  const result = (await hook({
    tool_name: "Write",
    tool_input: {
      file_path: "src/views/sidebar/ChatPanel.ts",
      content: "outside footprint",
    },
  })) as Record<string, unknown>;

  const out = result?.hookSpecificOutput as Record<string, unknown> | undefined;
  assert.ok(out, "hookSpecificOutput is present (it is a deny)");
  assert.equal(out.permissionDecision, "deny", "the call is denied");
  assert.ok(
    !out.updatedInput,
    "no updatedInput on a deny — the deny is returned unchanged, never carrying a rewrite",
  );
});

test("PreToolUse hook — rtkEnabled:true but tool is not Bash passes through with no updatedInput", async () => {
  // INVARIANT: the rewrite only applies to Bash tool calls; other allowed calls (Read, etc.)
  // pass through without updatedInput.
  const capturedHooks: { current: unknown } = { current: undefined };
  const svc = new OrchestratorService(makeCapturingDeps(true, capturedHooks));

  await driveRunViaSdk(svc);

  const hooks = capturedHooks.current as Record<
    string,
    Array<{ hooks: Array<(input: unknown) => unknown> }>
  >;
  const hook = hooks?.PreToolUse?.[0]?.hooks?.[0];
  assert.ok(hook, "hook exists");

  // A Read tool call (allowed, but not Bash) → no rewrite.
  const result = (await hook({
    tool_name: "Read",
    tool_input: { file_path: "src/services/rtkRewrite.ts" },
  })) as Record<string, unknown>;

  const out = result?.hookSpecificOutput as Record<string, unknown> | undefined;
  assert.ok(!out?.updatedInput, "no updatedInput for a non-Bash allowed call");
  // Also no deny — the Read of an in-footprint path is allowed.
  assert.ok(!out?.permissionDecision, "no deny for an allowed Read");
});
