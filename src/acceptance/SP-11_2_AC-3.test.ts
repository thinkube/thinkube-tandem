/**
 * SP-11/2 AC3 — Idempotent dispatch (the per-Spec dispatch guard).
 *
 * "The per-Spec dispatch guard (`withSpecLock`) refuses a second call for a Spec whose dispatch
 *  is still in flight: the refused call's body is never invoked and its `onBusy` is reported
 *  instead, a call for a different Spec proceeds concurrently, and the guard releases on
 *  completion AND on a body that throws (a later dispatch for the same Spec then proceeds)."
 *
 * Double-dispatch becomes impossible: `withSpecLock(lock, specId, body, onBusy)` does
 * `tryAcquire("spec:" + specId)` on the shared `ConcurrencyLock`. Held → `onBusy()` fires
 * synchronously, `body` is NEVER invoked, and the call resolves `undefined`. Acquired → `body()`
 * runs and the slot is released in `finally` — on resolve AND on throw (the throw propagates to
 * the caller). Distinct Spec ids key distinct handles, so a parked dispatch for one Spec never
 * blocks another.
 *
 * Proven purely against the SP-11/2 SPEC CONTRACT, driving a precise interleave with the real
 * `ConcurrencyLock` primitive the guard is required to reuse: the first body is *parked* on a
 * controlled promise (`gate`) so it is provably in-flight while we exercise the refusal and the
 * concurrent other-Spec path, then released on demand — no timers, no racing live writers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { withSpecLock } from "../services/dispatchGuard";
import { ConcurrencyLock } from "../services/concurrencyLock";

/** A resolvable-on-demand promise so a body can be "parked" mid-flight to drive an exact interleave. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** An `onBusy` that must never fire; used for calls the contract says should acquire, not be refused. */
function neverBusy(): () => void {
  return () =>
    assert.fail("onBusy must not fire for a call that acquires the lock");
}

test("SP-11/2 AC3 — a second same-Spec call while the first is in flight is refused (undefined, no body, onBusy); a different Spec runs concurrently; the released Spec re-acquires", async () => {
  const lock = new ConcurrencyLock();
  const gate = deferred<string>();

  // ── First dispatch for spec 11/2: acquires and PARKS on `gate` (in-flight, not yet released).
  let firstBodyRuns = 0;
  const first = withSpecLock(
    lock,
    "11/2",
    async () => {
      firstBodyRuns += 1;
      return gate.promise; // stays pending until we resolve the gate below
    },
    neverBusy(),
  );

  // Let the acquired body start. (tryAcquire is synchronous, so the lock is held immediately;
  // one microtask ensures the body function itself has been invoked.)
  await Promise.resolve();
  assert.equal(firstBodyRuns, 1, "the first (acquiring) call invokes its body");

  // ── Second dispatch for the SAME Spec while the first is parked: must be refused.
  let secondBodyRuns = 0;
  let busyCalls = 0;
  const secondPromise = withSpecLock(
    lock,
    "11/2",
    async () => {
      secondBodyRuns += 1;
      return "second";
    },
    () => {
      busyCalls += 1;
    },
  );

  // onBusy is reported SYNCHRONOUSLY — observable before the returned promise even settles.
  assert.equal(busyCalls, 1, "the refused call reports onBusy synchronously");
  assert.equal(secondBodyRuns, 0, "the refused call's body is NEVER invoked");

  const second = await secondPromise;
  assert.equal(second, undefined, "the refused call resolves undefined");
  assert.equal(busyCalls, 1, "onBusy fires exactly once for the refused call");
  assert.equal(secondBodyRuns, 0, "still: the refused body never ran");

  // ── A dispatch for a DIFFERENT Spec proceeds concurrently while 11/2 is still parked.
  let otherBodyRuns = 0;
  const other = await withSpecLock(
    lock,
    "11/3",
    async () => {
      otherBodyRuns += 1;
      return "other";
    },
    neverBusy(),
  );
  assert.equal(
    otherBodyRuns,
    1,
    "a different Spec's body runs while 11/2 is in flight",
  );
  assert.equal(
    other,
    "other",
    "the concurrent other-Spec dispatch returns its body's value",
  );

  // The first Spec is STILL in flight (we never released the gate) — sanity check the interleave.
  assert.equal(
    firstBodyRuns,
    1,
    "the first 11/2 dispatch is still the only one that ran for that Spec",
  );

  // ── Release the first body; it resolves and the guard frees the 11/2 slot in `finally`.
  gate.resolve("first-done");
  assert.equal(
    await first,
    "first-done",
    "the first body's resolved value propagates to its caller",
  );

  // ── After completion, a LATER dispatch for the same Spec acquires and runs.
  let laterBodyRuns = 0;
  let laterBusy = 0;
  const later = await withSpecLock(
    lock,
    "11/2",
    async () => {
      laterBodyRuns += 1;
      return "later";
    },
    () => {
      laterBusy += 1;
    },
  );
  assert.equal(
    laterBusy,
    0,
    "the lock was released on completion — the later call is not refused",
  );
  assert.equal(
    laterBodyRuns,
    1,
    "the later same-Spec dispatch acquires and runs its body",
  );
  assert.equal(later, "later", "the later dispatch returns its body's value");
});

test("SP-11/2 AC3 — the guard releases on a body that THROWS (throw propagates), and a later same-Spec dispatch then proceeds", async () => {
  const lock = new ConcurrencyLock();
  const boom = new Error("dispatch body blew up");

  // A dispatch whose body throws: the throw must propagate to the caller...
  await assert.rejects(
    withSpecLock(
      lock,
      "11/2",
      async () => {
        throw boom;
      },
      neverBusy(),
    ),
    (err) => err === boom,
    "the body's throw propagates to the caller unchanged",
  );

  // ...and the slot must have been released in `finally` despite the throw, so a later
  // dispatch for the SAME Spec acquires (is not refused) and runs.
  let laterBodyRuns = 0;
  let laterBusy = 0;
  const later = await withSpecLock(
    lock,
    "11/2",
    async () => {
      laterBodyRuns += 1;
      return "recovered";
    },
    () => {
      laterBusy += 1;
    },
  );
  assert.equal(
    laterBusy,
    0,
    "the lock was released even though the prior body threw",
  );
  assert.equal(
    laterBodyRuns,
    1,
    "a later same-Spec dispatch acquires and runs after a throw",
  );
  assert.equal(
    later,
    "recovered",
    "the later dispatch returns its body's value",
  );
});
