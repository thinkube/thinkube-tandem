// Per-Spec dispatch guard (TEP-11 / SP-2, SL-2).
//
// The orchestrate/accept command bodies must not double-dispatch: a second invocation for the
// SAME Spec while the first is still in flight has to be refused outright (never queued, never
// run twice), while invocations for *different* Specs run unimpeded. This is exactly the
// "rejected-or-refused" side of the existing `ConcurrencyLock`, keyed by Spec id.
//
// `withSpecLock` wraps a body with a compare-and-set on `spec:<specId>`:
//   - held  → the caller is refused: `onBusy()` fires synchronously, `body` is never invoked,
//             and the promise resolves `undefined` (the caller distinguishes "ran" from
//             "refused" by the `undefined` result).
//   - free  → the lock is acquired, `body()` runs, and the lock is released in `finally` — on
//             both resolve and throw, so a rejecting body can never leave the Spec wedged. A
//             thrown/rejected body propagates to the caller unchanged.
//
// Reuses the shared `ConcurrencyLock` primitive rather than inventing a parallel mechanism.

import type { ConcurrencyLock } from "./concurrencyLock";

/** Namespaced lock handle for a Spec's dispatch slot. */
function specHandle(specId: string): string {
  return `spec:${specId}`;
}

/**
 * Runs `body` under a per-Spec dispatch lock so a Spec can only have one orchestrate/accept in
 * flight at a time.
 *
 * If the Spec's lock is already held, the call is refused: `onBusy()` is invoked synchronously,
 * `body` is NOT called, and the returned promise resolves to `undefined`. Otherwise the lock is
 * acquired, `body()` runs, and the lock is released in a `finally` — on both fulfilment and
 * rejection. A rejection from `body` propagates to the caller; the lock is still released.
 */
export async function withSpecLock<T>(
  lock: ConcurrencyLock,
  specId: string,
  body: () => Promise<T>,
  onBusy: () => void,
): Promise<T | undefined> {
  const release = lock.tryAcquire(specHandle(specId));
  if (release === null) {
    onBusy();
    return undefined;
  }
  try {
    return await body();
  } finally {
    release();
  }
}
