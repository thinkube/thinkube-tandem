/**
 * The merge → stamp → retire ordering of an accept-land, extracted into one pure,
 * injectable place (, #10-residual).
 *
 * Before this, `thinkingSpaces.ts` (`onAcceptSpec`) and `orchestrate.ts` (`thinkube.accept`)
 * each inlined the same three-step dance — merge the Spec's PR, stamp `accepted:`
 * on the doc, then retire the worktree — and each had to re-derive the subtle
 * ordering/idempotence rules:
 *
 *   1. **Merge first.** A *real* merge failure (gh missing, a PR that won't merge,
 *      a rejected push) throws out of `merge()` and aborts the whole accept — we
 *      must never stamp a Spec `accepted` while its branch is still open.
 *   2. **Stamp second.** Only reached once `merge()` resolved — whether it actually
 *      merged a PR, found the branch already merged / gone, or was a benign no-PR
 *      straight-to-main Spec. Stamping after the merge call returns is what
 *      guarantees stamped ⇒ landed.
 *   3. **Retire last, and only when something landed.** A no-PR straight-to-main
 *      Spec produced no merge-side worktree to retire, so retire is skipped. When a
 *      merge *did* land, retire runs **best-effort**: a retire failure — most often
 *      an already-merged / branch-gone Spec whose worktree was already cleaned up —
 *      must never turn a landed, stamped accept into an error (no zombie-worktree
 *      failure). The error is captured and reported, not thrown.
 *
 * The function is intentionally pure and transport-free: it takes the three steps
 * as injected callbacks and returns a plain result. The callers wire in the real
 * `mergeSpecPr`, `store.writeFile`, and `retireWorktreeNote`; the tests wire in
 * call-recording fakes. `acceptOrder` itself touches no `gh`, `git`, filesystem,
 * or VS Code API.
 */

/**
 * The minimal shape `acceptOrder` needs from a merge step to drive its ordering
 * and idempotence. `merged` is the only field it reads — `true` means the Spec
 * landed (a PR was merged, or the branch was already merged / is gone), so the
 * worktree should be retired; `false` means nothing landed here (a genuine no-PR
 * straight-to-main Spec) and there is nothing to retire. Any extra fields a real
 * merge result carries (branch, opened, reason, output, alreadyMerged, …) are
 * passed through untouched to `stamp` and `retire`.
 */
export interface AcceptMergeResult {
  /** Whether the Spec's branch landed — gates whether `retire` runs. */
  merged: boolean;
}

/** The three injectable steps of an accept-land, in the order they run. */
export interface AcceptOrderSteps<M extends AcceptMergeResult, R> {
  /**
   * Land the Spec's branch. Resolves with the merge outcome (merged / already-merged
   * / branch-gone / benign no-PR). Throws **only** on a real failure, which aborts
   * the accept before any stamp or retire.
   */
  merge: () => Promise<M>;
  /** Mark the Spec `accepted:`. Runs after `merge` resolves; its failure aborts. */
  stamp: (merge: M) => Promise<void>;
  /**
   * Retire the Spec's worktree. Runs last and only when `merge.merged` is `true`.
   * Best-effort — its rejection is captured, never propagated.
   */
  retire: (merge: M) => Promise<R>;
}

/**
 * The outcome of an `acceptOrder` run. `ok` is `true` whenever `merge` and `stamp`
 * both resolved — a landed accept is a success even if retire was skipped or failed.
 */
export interface AcceptOrderResult<M extends AcceptMergeResult, R> {
  /** Always `true` when this resolves; a `merge`/`stamp` failure rejects instead. */
  ok: true;
  /** The resolved merge outcome (also handed to `stamp`/`retire`). */
  merge: M;
  /** The retire step's value — present only when retire ran and succeeded. */
  retire?: R;
  /** A best-effort retire failure that was swallowed — present iff retire threw. */
  retireError?: Error;
}

/**
 * Run an accept-land in the canonical merge → stamp → retire order with idempotent,
 * best-effort retire. See the module doc for the full contract. In short:
 *
 *   - `merge` throwing aborts (no stamp, no retire) — surfaced to the caller.
 *   - `stamp` always runs after a resolved merge; its throwing aborts.
 *   - `retire` runs **iff** `merge.merged` is `true`, and its throwing is captured
 *     in `retireError` rather than failing the accept (already-merged / branch-gone
 *     Specs whose worktree is already gone still resolve as success).
 */
export async function acceptOrder<M extends AcceptMergeResult, R>(
  steps: AcceptOrderSteps<M, R>,
): Promise<AcceptOrderResult<M, R>> {
  // 1. Merge first. A real failure throws straight out — the accept aborts before
  //    anything is stamped, so we never strand a Spec marked accepted on an open
  //    branch.
  const merge = await steps.merge();

  // 2. Stamp second, only after the merge call returned. stamped ⇒ landed.
  await steps.stamp(merge);

  // 3. Nothing landed (benign no-PR straight-to-main) ⇒ no worktree to retire.
  if (!merge.merged) {
    return { ok: true, merge };
  }

  // 4. Retire last, best-effort. A retire failure (e.g. the worktree was already
  //    cleaned up on an already-merged / branch-gone Spec) is captured, not thrown:
  //    the Spec is already merged and stamped, so cleanup must not fail the accept.
  try {
    const retire = await steps.retire(merge);
    return { ok: true, merge, retire };
  } catch (e) {
    return {
      ok: true,
      merge,
      retireError: e instanceof Error ? e : new Error(String(e)),
    };
  }
}
