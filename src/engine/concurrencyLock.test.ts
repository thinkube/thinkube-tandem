/**
 * Unit tests for the per-handle thinking space-write lock.
 * node:test + node:assert; run via `npm test`.
 *
 * Background. The kanban MCP server's mutating tools (`move_slice`, `accept_spec`) each do a
 * read-modify-write of a thinking space's JSON: read the current state, apply a mutation, write it back.
 * Two such ops interleaving on the SAME thinking space (handle) race that RMW — the second reads the
 * same stale snapshot the first did and its write clobbers the first's ("last write wins"),
 * silently dropping a move or an accept. `ConcurrencyLock` (owned by the implementation unit)
 * serializes writes *per handle* so concurrent callers either queue behind the in-flight write
 * (`runExclusive` — the "queued" path) or are refused outright (`tryAcquire` — the "rejected"
 * path of AC#2's "rejected-or-queued").
 *
 * AC#2 mandates a **controlled interleave**, not two racing live writers (which would be flaky).
 * So every test here drives ordering deterministically: the first write `await`s a *controlled*
 * promise (`deferred()`) that the test resolves on demand, parking it precisely mid-RMW. A
 * `flush()` of the event loop proves the second op makes no progress while the first is parked;
 * releasing the first then proves the second read the *post-write* state — no clobber. No timers,
 * no `Math.random`, no scheduler races.
 *
 * Coverage:
 *   1. `runExclusive` (queued path): a parked first write blocks a second op on the same handle;
 *      after release, the second observes the first's write and both ops survive in arrival order.
 *   2. Contrast (NO lock): the identical interleave run unguarded loses one op to last-write-wins,
 *      proving the clobber the lock exists to prevent is real and that the lock is what stops it.
 *   3. `tryAcquire` (rejected path): a second compare-and-set on a held handle returns `null`
 *      without queuing; it succeeds again only after the holder releases.
 *   4. Per-handle independence: a parked write on handle A never blocks handle B.
 *   5. Release-on-throw: a rejecting `fn` still frees the handle (no deadlock) and order is kept.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { ConcurrencyLock, LockRelease } from "./concurrencyLock";

/** A controlled promise: the test resolves `resolve()` on demand to release a parked write. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * Yield to the event loop so every *runnable* microtask settles. Because parked writes await an
 * unresolved `deferred()`, they stay parked across a flush — so "state unchanged after flush"
 * deterministically means "the parked write has not progressed", with no reliance on timing.
 */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * A thinking space-write modelled as a read-modify-write over `cell`. It snapshots the current op list
 * (the "read"), optionally `await`s `park` (suspended mid-write, exactly where the real clobber
 * window is), then writes `snapshot + op` back. Run two of these concurrently on one cell and,
 * unserialized, the late writer clobbers the early one.
 */
function rmwWrite(
  cell: { ops: string[] },
  op: string,
  park?: Promise<void>,
): () => Promise<void> {
  return async () => {
    const snapshot = cell.ops.slice(); // READ
    if (park) {
      await park; // parked mid-write
    }
    cell.ops = [...snapshot, op]; // WRITE (clobbers if it read a stale snapshot)
  };
}

test("runExclusive: a parked write on a handle queues a second op on the same handle (no clobber)", async () => {
  const lock = new ConcurrencyLock();
  const handle = "thinking space-A";
  const cell = { ops: [] as string[] };
  const gate = deferred();

  // First op acquires the handle, reads the (empty) snapshot, then parks mid-write on the gate.
  const first = lock.runExclusive(handle, rmwWrite(cell, "move", gate.promise));
  // Let the first op reach its parked await so it is the in-flight holder.
  await flush();
  assert.equal(lock.isLocked(handle), true, "first op holds the handle");

  // Second op on the SAME handle. It must queue behind the parked first, not run concurrently.
  const second = lock.runExclusive(handle, rmwWrite(cell, "accept"));

  // While the first is parked, the second cannot read or write: state is untouched by either.
  await flush();
  assert.deepEqual(
    cell.ops,
    [],
    "neither op has written while the first is parked — the second is queued, not racing",
  );

  // Release the parked first write. It completes, THEN the queued second runs — reading the
  // post-write snapshot, so it appends rather than clobbers.
  gate.resolve();
  await Promise.all([first, second]);

  assert.deepEqual(
    cell.ops,
    ["move", "accept"],
    "both ops survive in arrival order — the serialized second read after the first wrote",
  );
  assert.equal(
    lock.isLocked(handle),
    false,
    "handle freed after both released",
  );
});

test("contrast: the SAME interleave without the lock loses an op to last-write-wins", async () => {
  // Same parked-first / second-on-same-handle interleave, run UNGUARDED, to prove the clobber is
  // real — this is the bug `runExclusive` prevents in the test above.
  const cell = { ops: [] as string[] };
  const gate = deferred();

  const first = rmwWrite(cell, "move", gate.promise)(); // reads [], parks
  await flush();
  const second = rmwWrite(cell, "accept")(); // reads [] (stale!), writes ["accept"]
  await flush();
  assert.deepEqual(
    cell.ops,
    ["accept"],
    "unguarded second op wrote off the stale empty snapshot",
  );

  gate.resolve();
  await Promise.all([first, second]);

  // The first op resumes and writes its OWN stale snapshot (empty) + "move" → "accept" is gone.
  assert.deepEqual(
    cell.ops,
    ["move"],
    "last-write-wins clobber: the late-resuming first op overwrote the second — 'accept' lost",
  );
});

test("tryAcquire: compare-and-set refuses a second op on a held handle, then succeeds once freed", async () => {
  const lock = new ConcurrencyLock();
  const handle = "thinking space-A";

  const r1: LockRelease | null = lock.tryAcquire(handle);
  assert.ok(r1, "first acquire on a free handle succeeds");
  assert.equal(lock.isLocked(handle), true);

  // Second op on the same handle is rejected outright (no queuing) — the "rejected" path of AC#2.
  const r2 = lock.tryAcquire(handle);
  assert.equal(r2, null, "second compare-and-set on a held handle is refused");

  r1!();
  assert.equal(lock.isLocked(handle), false, "release frees the handle");

  const r3 = lock.tryAcquire(handle);
  assert.ok(r3, "the handle is acquirable again once released");
  // Release is idempotent — a defensive double-call must not corrupt the slot.
  r3!();
  r3!();
  assert.equal(lock.isLocked(handle), false);
});

test("per-handle independence: a parked write on handle A does not block handle B", async () => {
  const lock = new ConcurrencyLock();
  const gateA = deferred();
  let bRan = false;

  const a = lock.runExclusive("A", async () => {
    await gateA.promise; // parks handle A indefinitely
  });
  await flush();
  assert.equal(lock.isLocked("A"), true);

  // Handle B must run to completion even while A is parked — different handles are independent.
  await lock.runExclusive("B", async () => {
    bRan = true;
  });
  assert.equal(
    bRan,
    true,
    "handle B completed while handle A was still parked",
  );

  gateA.resolve();
  await a;
  assert.equal(lock.isLocked("A"), false);
});

test("runExclusive: a rejecting fn still frees the handle (no deadlock) and propagates the error", async () => {
  const lock = new ConcurrencyLock();
  const handle = "thinking space-A";

  await assert.rejects(
    lock.runExclusive(handle, async () => {
      throw new Error("write blew up");
    }),
    /write blew up/,
    "the caller's error is propagated, not swallowed",
  );
  assert.equal(
    lock.isLocked(handle),
    false,
    "handle is freed even though fn threw",
  );

  // The next op on the same handle must run — a thrown write must not wedge the queue.
  const result = await lock.runExclusive(handle, async () => "recovered");
  assert.equal(
    result,
    "recovered",
    "the handle is usable after a failed holder",
  );
});
