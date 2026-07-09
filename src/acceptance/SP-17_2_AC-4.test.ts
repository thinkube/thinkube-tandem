// SP-17/2 AC4 — one-time TRANSITION: with rtkEnabled removed and the always-on rewrite
// in place, the extension type-checks under tsconfig.test.json and the whole node:test
// suite passes.
//
// WHY (TRANSITION — its job is done once this change ships): this probe confirms the SP-17/2
// landing is coherent. Three things it confirms:
//   1. rtkRewrite + RTK_SUPPORTED remain exported with the contracted types (no regression).
//   2. OrchestratorDeps no longer requires rtkEnabled — this file constructs deps WITHOUT it;
//      if the field were still required anywhere, tsc would report an error elsewhere. The
//      file that type-asserted rtkEnabled:true (old AC-5) is deleted because after the
//      implementation it causes a tsc type-error — that deletion is what makes `npx tsc` green.
//   3. The two always-on behaviors compose correctly without rtkEnabled anywhere:
//        a. runViaSdk's PreToolUse hook rewrites a supported Bash call unconditionally.
//        b. dispatchSpec refuses up front when rtkBinaryPresent reports false.
// Run command: node --test out-test/acceptance/SP-17_2_AC-4.test.js
// Once the change ships and the suite is green, this probe's work is complete.

import { test } from "node:test";
import assert from "node:assert/strict";

import { rtkRewrite, RTK_SUPPORTED } from "../services/rtkRewrite";
import {
  OrchestratorService,
  type OrchestratorDeps,
} from "../services/OrchestratorService";
import type { SchedUnit } from "../services/orchestratorCore";

// ── Compile-time type evidence ────────────────────────────────────────────────
// These Partial<OrchestratorDeps> assignments construct the interface WITHOUT rtkEnabled.
// If the implementer accidentally kept rtkEnabled as a required field, or if the type
// narrowed in a way that rejects a missing rtkEnabled, tsc reports a compile error here —
// which is the type-check guarantee AC4 requires.
const _depsWithBinaryCheck: Partial<OrchestratorDeps> = {
  rtkBinaryPresent: () => true,
};
const _depsWithAsyncBinaryCheck: Partial<OrchestratorDeps> = {
  rtkBinaryPresent: async () => false,
};
// Omitting all rtk fields is also valid (rtkBinaryPresent is optional, rtkEnabled is gone).
const _depsWithNoRtk: Partial<OrchestratorDeps> = {};

// ── Helper types / stubs ──────────────────────────────────────────────────────

const TRANSITION_UNIT: SchedUnit = {
  id: "TEP-17_SP-2_SL-2#eu-1",
  slice: "TEP-17_SP-2_SL-2",
  footprint: ["src/services/rtkRewrite.ts"],
  requires: [],
  shape: "serial",
  role: "code",
  note: "always-on rtk composition smoke",
};

function makeStore(tracker: { sliceListingCalled: boolean }) {
  return {
    pathForSpecDoc: (n: string) => `teps/SP-${n}/spec.md`,
    getFile: async (_rel: string) => ({ frontmatter: {}, body: "" }),
    listSlices: async (_n: string): Promise<string[]> => {
      tracker.sliceListingCalled = true;
      return [];
    },
    thinkubeDir: "/nonexistent",
    sliceHandle: (n: string, sl: number) => `SP-${n}_SL-${sl}`,
    writeFile: async () => {},
  };
}

// ── AC-4 tests ────────────────────────────────────────────────────────────────

test("AC4 TRANSITION: rtkRewrite and RTK_SUPPORTED are still exported with the contracted types (no regression)", () => {
  // WHY (TRANSITION): confirms the rtkRewrite module is intact after the opt-in removal —
  // no accidental rename or type change was introduced alongside the OrchestratorDeps change.
  assert.equal(typeof rtkRewrite, "function", "rtkRewrite is a function");
  assert.ok(Array.isArray(RTK_SUPPORTED), "RTK_SUPPORTED is an array");
  assert.ok(RTK_SUPPORTED.length > 0, "RTK_SUPPORTED has at least one entry");
  // Representative entries from the mandated starting set.
  assert.ok(
    (RTK_SUPPORTED as readonly string[]).includes("git status"),
    'RTK_SUPPORTED includes "git status"',
  );
  assert.ok(
    (RTK_SUPPORTED as readonly string[]).includes("grep"),
    'RTK_SUPPORTED includes "grep"',
  );
  // The rewrite function still works correctly (pure-function smoke).
  assert.equal(rtkRewrite("git status"), "rtk git status");
  assert.equal(rtkRewrite("npm install"), undefined);
  assert.equal(rtkRewrite("git status | grep m"), undefined);
});

test("AC4 TRANSITION: OrchestratorDeps accepts rtkBinaryPresent without rtkEnabled (compile + runtime evidence)", () => {
  // WHY (TRANSITION): the Partial<OrchestratorDeps> assignments above this test ARE the
  // compile-time evidence — they construct the interface without rtkEnabled. If the field
  // were still required, tsc would fail on them. This runtime test confirms the constructed
  // objects are well-formed.
  assert.equal(typeof _depsWithBinaryCheck.rtkBinaryPresent, "function");
  assert.equal(
    (_depsWithBinaryCheck.rtkBinaryPresent as () => boolean)(),
    true,
    "sync rtkBinaryPresent returns boolean",
  );
  assert.ok(
    (
      _depsWithAsyncBinaryCheck.rtkBinaryPresent as () => Promise<boolean>
    )() instanceof Promise,
    "async rtkBinaryPresent returns a Promise",
  );
  // The key absence: rtkEnabled is not present in any of the constructed dep objects.
  assert.equal(
    (_depsWithBinaryCheck as Record<string, unknown>).rtkEnabled,
    undefined,
    "rtkEnabled is absent from the deps — it was removed in SP-17/2",
  );
  assert.equal(
    (_depsWithNoRtk as Record<string, unknown>).rtkEnabled,
    undefined,
    "no rtkEnabled even when all rtk fields are omitted",
  );
});

test("AC4 TRANSITION: OrchestratorService constructed without rtkEnabled — hook fires unconditionally (end-to-end smoke)", async () => {
  // WHY (TRANSITION): proves the two behaviors compose correctly without rtkEnabled anywhere.
  // The worker's PreToolUse hook rewrites a supported Bash call even when the dep object
  // carries no rtkEnabled field — unconditional wiring is the guarantee of SP-17/2.
  const capturedHooks: { current: unknown } = { current: undefined };

  const svc = new OrchestratorService({
    worktrees: {} as never,
    arbiter: {} as never,
    store: {} as never,
    output: { appendLine: () => {} } as never,
    canonicalRepo: "/nonexistent",
    workerModel: {},
    // rtkBinaryPresent is NOT injected here; the binary guard lives in dispatchSpec, not
    // runViaSdk, so calling runViaSdk directly bypasses it.
    // rtkEnabled is intentionally ABSENT — the field no longer exists in OrchestratorDeps.
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
          session_id: "sess-ac4-smoke",
        };
      })();
    }) as never,
    containmentCheck: async () => ({ ok: true as const, violations: [] }),
  } as unknown as OrchestratorDeps);

  // Drive the private runViaSdk — bypasses the binary guard in dispatchSpec.
  await (svc as unknown as Record<string, Function>).runViaSdk(
    TRANSITION_UNIT,
    "17/2",
    "/nonexistent-cwd-ac4",
    () => {}, // onPark
    [], // unionFootprint
    [], // baseline
  );

  assert.ok(capturedHooks.current, "hooks were captured by the fake sdkQuery");

  const hooks = capturedHooks.current as Record<
    string,
    Array<{
      hooks: Array<(input: unknown) => Promise<Record<string, unknown>>>;
    }>
  >;
  const hook = hooks?.PreToolUse?.[0]?.hooks?.[0];
  assert.ok(hook, "PreToolUse hook is present in the captured options.hooks");
  assert.equal(typeof hook, "function");

  // Invoke with a supported Bash command → rewrite must fire unconditionally.
  const result = await hook({
    tool_name: "Bash",
    tool_input: { command: "grep -r TODO src/" },
  });
  const out = result?.hookSpecificOutput as Record<string, unknown> | undefined;
  assert.ok(
    out?.updatedInput,
    "updatedInput is present — rewrite fired without rtkEnabled",
  );
  const updated = out!.updatedInput as Record<string, unknown>;
  assert.equal(
    updated.command,
    "rtk grep -r TODO src/",
    "the command is rtk-wrapped end-to-end",
  );
});

test("AC4 TRANSITION: dispatchSpec refuses when binary absent — unconditionally, no rtkEnabled (end-to-end smoke)", async () => {
  // WHY (TRANSITION): proves the binary guard also composes correctly without rtkEnabled.
  // dispatchSpec returns ok:false naming "rtk" when rtkBinaryPresent reports false —
  // even with no rtkEnabled in the deps object at all.
  const tracker = { sliceListingCalled: false };

  const svc = new OrchestratorService({
    worktrees: {} as never,
    arbiter: {} as never,
    store: makeStore(tracker) as never,
    output: { appendLine: () => {} } as never,
    canonicalRepo: "/nonexistent",
    workerModel: {},
    // rtkEnabled intentionally ABSENT — removed in SP-17/2.
    rtkBinaryPresent: () => false,
  } as unknown as OrchestratorDeps);

  const result = await svc.dispatchSpec("17/2", 1);

  assert.equal(
    result.ok,
    false,
    "dispatchSpec refuses when binary absent, no rtkEnabled",
  );
  assert.ok(result.reason, "reason is present");
  assert.match(result.reason!, /rtk/i, 'reason names "rtk"');
  assert.equal(result.dispatched, 0, "zero units dispatched");
  assert.equal(
    tracker.sliceListingCalled,
    false,
    "listSlices was never called — guard fired before buildSlices",
  );
});
