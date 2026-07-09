// SP-17/2 AC4 — with rtkEnabled:true and the binary-presence check reporting absent,
// dispatchSpec returns { ok: false, reason } BEFORE any slice is built or worker dispatched.
//
// WHY (INVARIANT — must always hold, lives forever): the guard must be LOUD and UP FRONT —
// orchestration is refused before touching the thinking space (no store.listSlices call,
// zero units dispatched) and the reason must name both "rtk" and the setting
// "thinkube.orchestrator.rtk" so the operator knows what to install and which knob controls
// it. There must never be a silent pass-through and never an automatic disable: the system
// either runs with RTK or refuses to start. This contract is permanent — any future refactor
// that moves the guard AFTER buildSlices / workers, or that silently downgrades it to a
// warning, is a regression.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OrchestratorService,
  type OrchestratorDeps,
} from "../services/OrchestratorService";

// ── Minimal store stub ────────────────────────────────────────────────────────
//
// We need a store that:
//  • satisfies pathForSpecDoc + getFile (superseded-gate, which runs before the RTK guard)
//  • tracks whether listSlices was called (the probe: it must NOT be called)

function makeStore(tracker: { sliceListingCalled: boolean }) {
  return {
    pathForSpecDoc: (n: string) => `teps/SP-${n}/spec.md`,
    // Return a spec doc with no superseded stamp so the superseded gate passes.
    getFile: async (_rel: string) => ({ frontmatter: {}, body: "" }),
    listSlices: async (_n: string): Promise<string[]> => {
      tracker.sliceListingCalled = true;
      return [];
    },
    thinkubeDir: "/nonexistent",
    // Stub other store methods the OrchestratorService might reference elsewhere.
    sliceHandle: (n: string, sl: number) => `SP-${n}_SL-${sl}`,
    writeFile: async () => {},
  };
}

/** Build a minimal OrchestratorService with rtkEnabled:true and binary absent. */
function makeSvc(
  rtkBinaryPresent: () => boolean | Promise<boolean>,
  tracker: { sliceListingCalled: boolean },
): OrchestratorService {
  return new OrchestratorService({
    worktrees: {} as never,
    arbiter: {} as never,
    store: makeStore(tracker) as never,
    output: { appendLine: () => {} } as never,
    canonicalRepo: "/nonexistent",
    workerModel: {},
    rtkEnabled: true,
    rtkBinaryPresent,
  } as unknown as OrchestratorDeps);
}

// ── AC-4 tests ────────────────────────────────────────────────────────────────

test("dispatchSpec — rtkEnabled:true and rtkBinaryPresent() === false → { ok:false, reason } before slice listing", async () => {
  // INVARIANT: the loud binary-presence guard fires before buildSlices, so the store's
  // slice-listing is never called — zero slices enumerated, zero workers dispatched.
  const tracker = { sliceListingCalled: false };
  const svc = makeSvc(() => false, tracker);

  const result = await svc.dispatchSpec("17/2", 1);

  assert.equal(result.ok, false, "dispatchSpec must return ok:false");
  assert.equal(result.dispatched, 0, "zero units must have been dispatched");
  assert.equal(
    tracker.sliceListingCalled,
    false,
    "store.listSlices must NOT have been called — the guard fires before buildSlices",
  );
});

test("dispatchSpec — reason names 'rtk' when binary is absent", async () => {
  // INVARIANT: the refusal reason must name the rtk binary so the operator knows
  // what to install.
  const tracker = { sliceListingCalled: false };
  const svc = makeSvc(() => false, tracker);

  const result = await svc.dispatchSpec("17/2", 1);

  assert.ok(result.reason, "a reason string is present");
  assert.match(
    result.reason!,
    /rtk/i,
    'reason must mention "rtk" (the binary name)',
  );
});

test("dispatchSpec — reason names the thinkube.orchestrator.rtk setting when binary is absent", async () => {
  // INVARIANT: the refusal reason must name the VS Code setting so the operator knows
  // which knob to adjust after installing the binary.
  const tracker = { sliceListingCalled: false };
  const svc = makeSvc(() => false, tracker);

  const result = await svc.dispatchSpec("17/2", 1);

  assert.ok(result.reason, "a reason string is present");
  assert.match(
    result.reason!,
    /thinkube\.orchestrator\.rtk/,
    'reason must mention "thinkube.orchestrator.rtk" (the setting name)',
  );
});

test("dispatchSpec — rtkBinaryPresent returning a Promise<false> is also caught (async check)", async () => {
  // INVARIANT: rtkBinaryPresent is typed as () => boolean | Promise<boolean>; the guard
  // must await it, so an async false is not silently treated as truthy.
  const tracker = { sliceListingCalled: false };
  const svc = makeSvc(async () => false, tracker);

  const result = await svc.dispatchSpec("17/2", 1);

  assert.equal(result.ok, false, "async false must also trigger the guard");
  assert.ok(result.reason, "reason is present");
  assert.match(result.reason!, /rtk/i, 'reason mentions "rtk"');
  assert.match(
    result.reason!,
    /thinkube\.orchestrator\.rtk/,
    "reason mentions the setting",
  );
  assert.equal(
    tracker.sliceListingCalled,
    false,
    "slice listing still not called for async false",
  );
});

test("dispatchSpec — rtkEnabled:true and rtkBinaryPresent() === true proceeds past the guard (no early exit)", async () => {
  // INVARIANT: when the binary is present the guard must NOT block orchestration.
  // We confirm the guard is bypassed by observing that buildSlices runs (listSlices IS called)
  // even though the run then terminates for other reasons (no real worktree in a unit test).
  const tracker = { sliceListingCalled: false };
  const svc = makeSvc(() => true, tracker);

  // The run will fail further in (no real worktree/git), but the guard must not block it.
  // We catch any downstream error; what matters is the guard didn't refuse up front.
  let result: Awaited<ReturnType<typeof svc.dispatchSpec>> | undefined;
  try {
    result = await svc.dispatchSpec("17/2", 1);
  } catch {
    // Downstream errors (no worktree, no git, etc.) are acceptable; guard refusal is not.
  }

  // The guard itself must not have fired (no early ok:false with the RTK reason).
  if (result) {
    const isGuardRefusal =
      result.ok === false &&
      typeof result.reason === "string" &&
      /rtk/i.test(result.reason) &&
      /thinkube\.orchestrator\.rtk/.test(result.reason);
    assert.ok(
      !isGuardRefusal,
      "when binary is present, the RTK guard must not block orchestration",
    );
  }
  // At minimum the guard did not fire AND slice listing was attempted (binary-present path).
  assert.equal(
    tracker.sliceListingCalled,
    true,
    "store.listSlices IS called when binary is present — guard was bypassed",
  );
});

test("dispatchSpec — rtkEnabled:false skips the guard entirely (binary absence irrelevant)", async () => {
  // INVARIANT: when rtkEnabled is false the binary-presence check is never consulted
  // and orchestration proceeds normally (failing only on downstream reasons, not the guard).
  const tracker = { sliceListingCalled: false };
  const svc = new OrchestratorService({
    worktrees: {} as never,
    arbiter: {} as never,
    store: makeStore(tracker) as never,
    output: { appendLine: () => {} } as never,
    canonicalRepo: "/nonexistent",
    workerModel: {},
    rtkEnabled: false,
    // rtkBinaryPresent returning false must be irrelevant when rtkEnabled is false.
    rtkBinaryPresent: () => false,
  } as unknown as OrchestratorDeps);

  let result: Awaited<ReturnType<typeof svc.dispatchSpec>> | undefined;
  try {
    result = await svc.dispatchSpec("17/2", 1);
  } catch {
    // Downstream failures are fine.
  }

  if (result) {
    const isGuardRefusal =
      result.ok === false &&
      typeof result.reason === "string" &&
      /rtk/i.test(result.reason) &&
      /thinkube\.orchestrator\.rtk/.test(result.reason);
    assert.ok(
      !isGuardRefusal,
      "rtkEnabled:false must not trigger the guard refusal",
    );
  }
  // listSlices IS called — binary check was skipped, guard was not hit.
  assert.equal(
    tracker.sliceListingCalled,
    true,
    "store.listSlices IS called when rtkEnabled is false — guard was not consulted",
  );
});
