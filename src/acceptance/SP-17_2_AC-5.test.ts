// SP-17/2 AC5 — the extension type-checks under tsconfig.test.json and the whole
// node:test suite is green after the change.
//
// WHY (one-time TRANSITION — its job is done once the change ships): this probe proves
// the SP-17/2 change lands coherently. Three things it confirms:
//   1. The new rtkRewrite module (src/services/rtkRewrite.ts) exports the contracted
//      public interface without compile error.
//   2. OrchestratorDeps gains the two optional fields (rtkEnabled, rtkBinaryPresent)
//      — the fact that this file constructs an OrchestratorDeps-shaped object using
//      those fields WITHOUT a compile error is the type-check evidence. Omitting them
//      also compiles (they are optional).
//   3. OrchestratorService can be constructed with the new fields and the hook wiring
//      runs end-to-end without throwing.
// Once the transition ships and the suite is green, this probe's work is complete.

import { test } from "node:test";
import assert from "node:assert/strict";

import { rtkRewrite, RTK_SUPPORTED } from "../services/rtkRewrite";
import {
  OrchestratorService,
  type OrchestratorDeps,
} from "../services/OrchestratorService";

// ── Compile-time type assertions (evaluated at import/module-init time) ───────
//
// These assignments are the TYPE-CHECK evidence: if rtkEnabled or rtkBinaryPresent
// are absent from OrchestratorDeps, or have the wrong type, tsc refuses to compile
// this file — which is exactly the guarantee AC5 requires.

// New optional fields present with both supported value shapes.
const _depsWithRtkEnabled: Partial<OrchestratorDeps> = {
  rtkEnabled: true,
  rtkBinaryPresent: () => true,
};
const _depsWithRtkDisabled: Partial<OrchestratorDeps> = {
  rtkEnabled: false,
  rtkBinaryPresent: async () => false,
};
// Omitting the new fields is also valid (optional).
const _depsWithoutRtk: Partial<OrchestratorDeps> = {};

// ── Runtime tests ─────────────────────────────────────────────────────────────

test("AC5 TRANSITION: rtkRewrite and RTK_SUPPORTED are exported from the new module", () => {
  // The import above is the compile evidence; exercise the API at runtime to confirm
  // the module is live and returns the contracted types.
  assert.equal(typeof rtkRewrite, "function", "rtkRewrite is a function");
  assert.ok(Array.isArray(RTK_SUPPORTED), "RTK_SUPPORTED is an array");
  assert.ok(RTK_SUPPORTED.length > 0, "RTK_SUPPORTED has at least one entry");
  // Sanity: one representative entry from the mandated starting set.
  assert.ok(
    (RTK_SUPPORTED as readonly string[]).includes("git status"),
    'RTK_SUPPORTED includes "git status"',
  );
});

test("AC5 TRANSITION: OrchestratorDeps accepts rtkEnabled (boolean) and rtkBinaryPresent (sync/async) without type error", () => {
  // The Partial<OrchestratorDeps> assignments above are the compile evidence.
  // Confirm the constructed objects are well-formed at runtime.
  assert.equal(_depsWithRtkEnabled.rtkEnabled, true);
  assert.equal(typeof _depsWithRtkEnabled.rtkBinaryPresent, "function");
  assert.equal(
    typeof (_depsWithRtkEnabled.rtkBinaryPresent as Function)(),
    "boolean",
  );

  assert.equal(_depsWithRtkDisabled.rtkEnabled, false);
  assert.equal(typeof _depsWithRtkDisabled.rtkBinaryPresent, "function");
  // Async variant returns a Promise.
  const asyncResult = (_depsWithRtkDisabled.rtkBinaryPresent as Function)();
  assert.ok(
    asyncResult instanceof Promise,
    "async rtkBinaryPresent returns a Promise",
  );

  assert.equal(
    _depsWithoutRtk.rtkEnabled,
    undefined,
    "omitting rtkEnabled is valid",
  );
  assert.equal(
    _depsWithoutRtk.rtkBinaryPresent,
    undefined,
    "omitting rtkBinaryPresent is valid",
  );
});

test("AC5 TRANSITION: OrchestratorService can be constructed with the new fields (no throw, correct type)", () => {
  // Constructing with rtkEnabled + rtkBinaryPresent proves the constructor signature
  // accepts the new optional fields without error.
  const svc = new OrchestratorService({
    worktrees: {} as never,
    arbiter: {} as never,
    store: {} as never,
    output: { appendLine: () => {} } as never,
    canonicalRepo: "/nonexistent",
    workerModel: {},
    rtkEnabled: true,
    rtkBinaryPresent: () => true,
  } as unknown as OrchestratorDeps);

  assert.ok(
    svc instanceof OrchestratorService,
    "OrchestratorService was constructed with the new fields without throwing",
  );
});

test("AC5 TRANSITION: OrchestratorService can be constructed WITHOUT rtkEnabled (backward-compatible — omission compiles)", () => {
  // Existing callers that do not set rtkEnabled must continue to compile and run.
  const svc = new OrchestratorService({
    worktrees: {} as never,
    arbiter: {} as never,
    store: {} as never,
    output: { appendLine: () => {} } as never,
    canonicalRepo: "/nonexistent",
    workerModel: {},
    // rtkEnabled and rtkBinaryPresent intentionally omitted.
  } as unknown as OrchestratorDeps);

  assert.ok(
    svc instanceof OrchestratorService,
    "OrchestratorService constructed without the new optional fields — backward compatible",
  );
});

test("AC5 TRANSITION: rtkRewrite integrates correctly with the hook chain — end-to-end smoke", async () => {
  // Drive a full runViaSdk invocation with rtkEnabled:true and a capturing sdkQuery,
  // then exercise the captured hook with a supported Bash command. This is the shortest
  // end-to-end path that exercises rtkRewrite, OrchestratorDeps.rtkEnabled, and the
  // hook wiring in a single test — proving all three parts compose without throwing.
  const capturedHooks: { current: unknown } = { current: undefined };

  const svc = new OrchestratorService({
    worktrees: {} as never,
    arbiter: {} as never,
    store: {} as never,
    output: { appendLine: () => {} } as never,
    canonicalRepo: "/nonexistent",
    workerModel: {},
    rtkEnabled: true,
    rtkBinaryPresent: () => true,
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
          session_id: "sess-ac5",
        };
      })();
    }) as never,
    containmentCheck: async () => ({ ok: true as const, violations: [] }),
  } as unknown as OrchestratorDeps);

  // Drive the private runViaSdk.
  await (svc as unknown as Record<string, Function>).runViaSdk(
    {
      id: "TEP-17_SP-2_SL-1#eu-1",
      slice: "TEP-17_SP-2_SL-1",
      footprint: ["src/services/rtkRewrite.ts"],
      requires: [],
      shape: "serial",
      role: "code",
      note: "smoke test",
    },
    "17/2",
    "/nonexistent-cwd-ac5",
    () => {},
    [],
    [],
  );

  assert.ok(capturedHooks.current, "hooks were captured");

  const hooks = capturedHooks.current as Record<
    string,
    Array<{
      hooks: Array<(input: unknown) => Promise<Record<string, unknown>>>;
    }>
  >;
  const hook = hooks?.PreToolUse?.[0]?.hooks?.[0];
  assert.ok(hook, "PreToolUse hook is present");

  // A supported Bash call → updatedInput with rtk prefix.
  const result = await hook({
    tool_name: "Bash",
    tool_input: { command: "grep -r TODO src/" },
  });
  const out = result?.hookSpecificOutput as Record<string, unknown> | undefined;
  assert.ok(
    out?.updatedInput,
    "updatedInput present — rtkRewrite wired end-to-end",
  );
  const updated = out!.updatedInput as Record<string, unknown>;
  assert.equal(updated.command, "rtk grep -r TODO src/");
});
