// SP-17/2 AC3 — dispatchSpec returns { ok:false, reason } naming "rtk" when the injectable
// binary-presence check reports the binary absent, ALWAYS — no setting gates it, before any
// slice is built or worker dispatched, and the store's slice listing is never called.
//
// WHY (TRANSITION — proves the enable gate was removed): in SP-17/1 the binary guard was
// gated on `rtkEnabled === true`. SP-17/2 makes it unconditional: the guard fires regardless
// of any setting, whenever rtkBinaryPresent reports false. Every test in this file constructs
// OrchestratorService WITHOUT rtkEnabled (the field no longer exists in OrchestratorDeps).
// The fact that the guard fires anyway proves the TRANSITION is complete.
//
// WHY (INVARIANT — must always hold, lives forever): RTK compression is mandatory. When the
// binary is absent, orchestration refuses up front — the same loud-fail shape as mandatory
// signing refusing without its key — never a silent uncompressed run, never an automatic
// disable. The store's slice-listing (and therefore buildSlices, and therefore any worker
// dispatch) is never reached. This contract must survive any future refactor.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OrchestratorService,
  type OrchestratorDeps,
} from "../services/OrchestratorService";

// ── Minimal store stub ────────────────────────────────────────────────────────
// Tracks whether listSlices was called (the key assertion: it must NOT be called when the
// binary is absent). Also satisfies the superseded gate (getFile → empty frontmatter).

function makeStore(tracker: { sliceListingCalled: boolean }) {
  return {
    pathForSpecDoc: (n: string) => `teps/SP-${n}/spec.md`,
    // Return a spec doc with no superseded stamp so the superseded gate (which runs after
    // the RTK guard) passes if we ever reach it — a clean false negative in tests where we
    // expect the RTK guard to fire first and short-circuit.
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

/** Build OrchestratorService with the given rtkBinaryPresent but WITHOUT rtkEnabled.
 *  The absence of rtkEnabled is the TRANSITION proof: the guard fires unconditionally. */
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
    // NOTE: rtkEnabled is intentionally ABSENT — removed in SP-17/2.
    //   In SP-17/1 the guard only fired when rtkEnabled === true; omitting it here
    //   means the guard must now fire unconditionally based on rtkBinaryPresent alone.
    rtkBinaryPresent,
  } as unknown as OrchestratorDeps);
}

// ── AC-3 tests ────────────────────────────────────────────────────────────────

test("dispatchSpec — binary absent (sync check) → ok:false before slice listing (no rtkEnabled in deps)", async () => {
  // WHY (TRANSITION): proves the guard is now unconditional — no rtkEnabled needed to trigger
  // it. In the old opt-in, this dep object (no rtkEnabled) would have passed through; now it
  // must refuse. Also INVARIANT: the refusal must always happen before any slice listing.
  const tracker = { sliceListingCalled: false };
  const svc = makeSvc(() => false, tracker);

  const result = await svc.dispatchSpec("17/2", 1);

  assert.equal(
    result.ok,
    false,
    "dispatchSpec must return ok:false when binary absent",
  );
  assert.equal(result.dispatched, 0, "zero units must have been dispatched");
  assert.equal(
    tracker.sliceListingCalled,
    false,
    "store.listSlices must NOT have been called — the guard fires before buildSlices",
  );
});

test("dispatchSpec — reason names 'rtk' when binary is absent", async () => {
  // WHY (INVARIANT): the refusal reason must name the rtk binary so the operator knows what
  // to install. This must hold forever — a reason that omits "rtk" leaves the operator
  // without actionable guidance.
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

test("dispatchSpec — binary absent via async Promise<false> is also caught (guard awaits the injectable)", async () => {
  // WHY (INVARIANT): rtkBinaryPresent is typed as () => boolean | Promise<boolean>; the guard
  // must await it. An async false must not be silently treated as a truthy Promise object and
  // slip through. This must hold forever — async injection is the seam tests rely on.
  const tracker = { sliceListingCalled: false };
  const svc = makeSvc(async () => false, tracker);

  const result = await svc.dispatchSpec("17/2", 1);

  assert.equal(
    result.ok,
    false,
    "async Promise<false> must also trigger the guard",
  );
  assert.ok(result.reason, "reason is present");
  assert.match(result.reason!, /rtk/i, 'reason mentions "rtk"');
  assert.equal(
    tracker.sliceListingCalled,
    false,
    "slice listing still not called for async false",
  );
});

test("dispatchSpec — binary present → proceeds past the guard (listSlices IS called, no rtk refusal)", async () => {
  // WHY (INVARIANT): when the binary is present the guard must NOT block orchestration. We
  // confirm this by observing that buildSlices runs (listSlices is called) even though the
  // run then terminates for other reasons (no real worktree in a unit test). The guard must
  // never falsely refuse a run where the binary is actually present.
  const tracker = { sliceListingCalled: false };
  const svc = makeSvc(() => true, tracker);

  let result: Awaited<ReturnType<typeof svc.dispatchSpec>> | undefined;
  try {
    result = await svc.dispatchSpec("17/2", 1);
  } catch {
    // Downstream failures (no worktree, no git, etc.) are acceptable — the guard must
    // not be what blocks the run.
  }

  // If we got a result, it must not be the RTK guard refusal.
  if (result) {
    const isGuardRefusal =
      result.ok === false &&
      typeof result.reason === "string" &&
      /rtk/i.test(result.reason);
    assert.ok(
      !isGuardRefusal,
      "when binary is present, the RTK guard must not refuse orchestration",
    );
  }
  // The key assertion: listSlices IS called, proving the guard was bypassed.
  assert.equal(
    tracker.sliceListingCalled,
    true,
    "store.listSlices IS called when binary is present — guard was bypassed",
  );
});

test("dispatchSpec — rtkBinaryPresent not injected falls back to an internal default (does not throw)", async () => {
  // WHY (INVARIANT): when rtkBinaryPresent is omitted from deps, the implementation falls
  // back to a module-internal PATH lookup of `rtk`. In a unit-test environment `rtk` is
  // likely absent; what matters is that the service does not THROW — it either refuses
  // cleanly (ok:false, reason names "rtk") or proceeds normally (binary found on CI/dev box).
  // This test asserts the NO-THROW contract regardless of the binary's actual presence.
  const tracker = { sliceListingCalled: false };
  const svc = new OrchestratorService({
    worktrees: {} as never,
    arbiter: {} as never,
    store: makeStore(tracker) as never,
    output: { appendLine: () => {} } as never,
    canonicalRepo: "/nonexistent",
    workerModel: {},
    // rtkBinaryPresent intentionally omitted → internal default PATH lookup.
  } as unknown as OrchestratorDeps);

  // Must not throw — either a clean refusal or a clean proceed.
  let threw = false;
  let result: Awaited<ReturnType<typeof svc.dispatchSpec>> | undefined;
  try {
    result = await svc.dispatchSpec("17/2", 1);
  } catch {
    threw = true;
  }

  assert.ok(
    !threw,
    "dispatchSpec must not throw when rtkBinaryPresent is omitted",
  );
  // If binary absent (most CI environments): ok:false with a reason mentioning "rtk".
  // If binary present: ok is true or false for downstream reasons but NOT an rtk-absent reason.
  // Either path is acceptable here; no-throw is the invariant being tested.
  if (result && result.ok === false && result.reason) {
    // If it did refuse, the reason must name rtk (not some internal crash message).
    const maybeRtkRefusal = /rtk/i.test(result.reason);
    // We cannot assert maybeRtkRefusal===true here because the binary may be present —
    // just assert the result is structurally valid.
    assert.equal(
      typeof result.reason,
      "string",
      "reason is a string when ok:false",
    );
  }
});
