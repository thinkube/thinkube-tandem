/**
 * Unit tests for the per-Spec dispatch guard (TEP-11 / SP-2, SL-2).
 * node:test + node:assert.
 *
 * `withSpecLock(lock, specId, body, onBusy)` compare-and-set-acquires `spec:<specId>` on the
 * shared `ConcurrencyLock` and either runs `body` (releasing in `finally`) or refuses.
 *
 * Coverage:
 *   1. Refuse-while-held: a second call for the SAME Spec while the first is parked in flight
 *      invokes `onBusy()`, never invokes `body`, and resolves `undefined`.
 *   2. Different-Spec concurrency: a parked in-flight Spec never blocks a call for another Spec.
 *   3. Release-on-resolve: after a body resolves the Spec is free again (a later call runs).
 *   4. Release-on-throw: a rejecting body propagates its error AND still frees the Spec.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { ConcurrencyLock } from "./concurrencyLock";
import { withSpecLock } from "./dispatchGuard";

/** A controlled promise: resolve/reject on demand to park a body precisely mid-flight. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Flush pending microtasks so parked-vs-progressed assertions are deterministic. */
const flush = () => new Promise<void>((r) => setImmediate(r));

test("refuse while held: second same-Spec call fires onBusy, never runs body, resolves undefined", async () => {
  const lock = new ConcurrencyLock();
  const gate = deferred<string>();

  let firstBodyRuns = 0;
  let secondBodyRuns = 0;
  let onBusyCalls = 0;

  const first = withSpecLock(
    lock,
    "SP-1",
    () => {
      firstBodyRuns++;
      return gate.promise;
    },
    () => assert.fail("first call must acquire, not report busy"),
  );

  // Let `first` acquire and enter its (parked) body.
  await flush();
  assert.equal(firstBodyRuns, 1);

  const second = await withSpecLock(
    lock,
    "SP-1",
    () => {
      secondBodyRuns++;
      return Promise.resolve("nope");
    },
    () => {
      onBusyCalls++;
    },
  );

  assert.equal(second, undefined, "refused call resolves undefined");
  assert.equal(onBusyCalls, 1, "onBusy called exactly once");
  assert.equal(secondBodyRuns, 0, "refused body is never invoked");

  gate.resolve("done");
  assert.equal(await first, "done");
});

test("onBusy is invoked synchronously while the Spec is held", async () => {
  const lock = new ConcurrencyLock();
  const gate = deferred<void>();

  const first = withSpecLock(
    lock,
    "SP-sync",
    () => gate.promise,
    () => {},
  );
  await flush();

  let onBusyCalls = 0;
  // No await between the call and the assertion: onBusy must have fired synchronously.
  void withSpecLock(
    lock,
    "SP-sync",
    () => assert.fail("body must not run while held"),
    () => {
      onBusyCalls++;
    },
  );
  assert.equal(
    onBusyCalls,
    1,
    "onBusy fires synchronously on the refused path",
  );

  gate.resolve();
  await first;
});

test("different Specs run concurrently: a parked Spec never blocks another", async () => {
  const lock = new ConcurrencyLock();
  const gate = deferred<string>();

  const a = withSpecLock(
    lock,
    "SP-A",
    () => gate.promise,
    () => assert.fail("SP-A must not be busy"),
  );
  await flush();

  // SP-B runs to completion even though SP-A is parked in flight.
  const b = await withSpecLock(
    lock,
    "SP-B",
    () => Promise.resolve("b-ran"),
    () => assert.fail("SP-B must not be refused while SP-A holds its own lock"),
  );
  assert.equal(b, "b-ran");

  gate.resolve("a-ran");
  assert.equal(await a, "a-ran");
});

test("release on resolve: the Spec is free again after its body resolves", async () => {
  const lock = new ConcurrencyLock();

  const first = await withSpecLock(
    lock,
    "SP-seq",
    () => Promise.resolve(1),
    () => assert.fail("first must acquire"),
  );
  assert.equal(first, 1);
  assert.equal(
    lock.isLocked("spec:SP-seq"),
    false,
    "lock released after resolve",
  );

  // A subsequent call for the same Spec acquires (not refused).
  let secondRan = false;
  const second = await withSpecLock(
    lock,
    "SP-seq",
    () => {
      secondRan = true;
      return Promise.resolve(2);
    },
    () => assert.fail("second call must acquire after first released"),
  );
  assert.equal(secondRan, true);
  assert.equal(second, 2);
});

test("release on throw: a rejecting body propagates AND frees the Spec", async () => {
  const lock = new ConcurrencyLock();
  const boom = new Error("body blew up");

  await assert.rejects(
    withSpecLock(
      lock,
      "SP-throw",
      () => Promise.reject(boom),
      () => assert.fail("first call must acquire"),
    ),
    (err) => err === boom,
  );

  assert.equal(
    lock.isLocked("spec:SP-throw"),
    false,
    "lock released even on throw",
  );

  // The Spec is not wedged: a later call still runs.
  let recovered = false;
  await withSpecLock(
    lock,
    "SP-throw",
    () => {
      recovered = true;
      return Promise.resolve();
    },
    () => assert.fail("must acquire after the throwing body released"),
  );
  assert.equal(recovered, true);
});
