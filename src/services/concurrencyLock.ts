// Per-handle concurrency lock for thinking space writes.
//
// The kanban MCP server's mutating tools (`move_slice`, `accept_spec`) read a thinking space's JSON,
// mutate it, and write it back. Two such operations interleaving on the SAME thinking space (handle)
// race read-modify-write: the second write clobbers the first ("last write wins"), silently
// dropping a move or an accept. This primitive serializes writes *per handle* so concurrent
// callers either queue behind the in-flight write (mutex) or are refused outright
// (compare-and-set), instead of both reading the same stale state and overwriting each other.
//
// Two acquisition styles, one underlying per-handle slot:
//   - `runExclusive(handle, fn)` — MUTEX/queue: `fn` runs only once any prior holder of the
//     same handle has released; concurrent callers serialize in arrival order. This is the
//     "queued" side of AC#2's "rejected-or-queued" — a second op cannot read state until the
//     first has finished writing, so it cannot clobber.
//   - `tryAcquire(handle)` — COMPARE-AND-SET: returns a release token if the handle was free,
//     or `null` if it is already held. This is the "rejected" side — a caller that won't queue
//     can detect the conflict and bail.
//
// Different handles are fully independent: a parked write on thinking space A never blocks thinking space B.
//
// The primitive is deterministic and scheduler-free: ordering is driven entirely by when the
// holder's promise settles, so a test can "park" the first write on a controlled promise and
// release it on demand to drive a precise interleave (AC#2) — no racing live writers, no timers.

/**
 * Releases a held lock slot. Idempotent: calling it more than once is a no-op, so a
 * `try/finally` release plus a defensive second call cannot corrupt the queue.
 */
export type LockRelease = () => void;

/**
 * A per-handle mutex. Each distinct `handle` string has its own independent lock slot; the
 * empty map means nothing is held. Construct one instance per shared resource domain (e.g. one
 * lock guarding all thinking space writes) and key it by the thinking space handle.
 */
export class ConcurrencyLock {
  /**
   * Per-handle tail of the wait chain: a promise that resolves when the current holder (and all
   * callers queued ahead) have released. Absent (deleted) when the handle is free. `runExclusive`
   * chains onto this; `tryAcquire` treats its presence as "held".
   */
  private readonly tails = new Map<string, Promise<void>>();

  /** True iff `handle` currently has a holder (or queued waiters). */
  isLocked(handle: string): boolean {
    return this.tails.has(handle);
  }

  /**
   * Compare-and-set acquire. If `handle` is free, atomically marks it held and returns a release
   * token; if it is already held, returns `null` without queuing. Use this for the "refuse on
   * conflict" path. The returned release frees the handle (idempotent).
   */
  tryAcquire(handle: string): LockRelease | null {
    if (this.tails.has(handle)) {
      return null;
    }
    let resolveHeld: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      resolveHeld = resolve;
    });
    this.tails.set(handle, held);
    return this.makeRelease(handle, held, resolveHeld);
  }

  /**
   * Mutex acquire. Runs `fn` with exclusive ownership of `handle`: if the handle is free, `fn`
   * starts immediately; otherwise this call queues and `fn` runs only after every earlier holder
   * of the same handle has released, in arrival order. The handle is released (even if `fn`
   * throws or rejects) once `fn` settles, then the result/error is propagated to the caller.
   */
  async runExclusive<T>(handle: string, fn: () => T | Promise<T>): Promise<T> {
    const previous = this.tails.get(handle) ?? Promise.resolve();

    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Chain this acquisition after whatever currently holds/queues on the handle. The tail is
    // the new `held` promise so the *next* caller queues behind us, not behind the prior holder.
    this.tails.set(handle, held);

    // Wait for our turn (the prior tail). A rejected prior holder must not poison the queue, so
    // we swallow its outcome — each holder's error is surfaced only to its own caller.
    await previous.catch(() => {});

    try {
      return await fn();
    } finally {
      // Free the slot. Only delete the map entry if we are still the tail; if a later caller has
      // already chained on, deleting would orphan them — instead we just resolve so they proceed.
      if (this.tails.get(handle) === held) {
        this.tails.delete(handle);
      }
      release();
    }
  }

  /**
   * Builds the idempotent release for `tryAcquire`. Resolves the holder promise and clears the
   * map entry only if this exact promise is still the tail (a queued `runExclusive` may have
   * chained on, in which case it owns teardown).
   */
  private makeRelease(
    handle: string,
    held: Promise<void>,
    resolve: () => void,
  ): LockRelease {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      if (this.tails.get(handle) === held) {
        this.tails.delete(handle);
      }
      resolve();
    };
  }
}
