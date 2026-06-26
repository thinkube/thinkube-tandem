/**
 * Spec-id resolution for `write_spec` (SP-th4wqd_SL-2, TEP-th3i18 #6).
 *
 * `write_spec` historically *required* the caller to hand a Spec id, which
 * forced manual board surgery (hand-minting an `SP-{id}` before every spec).
 * This brings it to parity with `write_tep`, where omitting the id mints a
 * conflict-free base36-epoch id via the store's allocator.
 *
 * The decision is a one-liner, but it's the **contract** the dispatch handler
 * and its test both depend on, so it lives in a pure, dependency-free helper:
 * the allocator is *injected* (a thunk), so the helper itself touches no store,
 * no `vscode`, and no clock — fixtures in, id out. The handler wires it to
 * `() => store.nextSpecNumber()`; the test wires it to a deterministic stub to
 * assert monotonicity without a real clock.
 */

/**
 * An injected Spec-id allocator: mints a fresh base36-epoch id (no `SP-`
 * prefix), monotonic across calls. In production this is
 * `() => store.nextSpecNumber()`.
 */
export type SpecIdAllocator = () => Promise<string>;

/**
 * Resolve the bare Spec id (no `SP-` prefix) for a `write_spec` call.
 *
 * - When `provided` is a non-empty string, use it verbatim (tolerating a
 *   leading `SP-`/`sp-` prefix, which is stripped so callers may pass either
 *   the handle or the bare id).
 * - Otherwise mint a fresh id via the injected `mint` allocator.
 *
 * Returns the bare id; the caller prefixes `SP-` to build the handle and the
 * `specs/SP-{id}/spec.md` path. Pure apart from awaiting the injected thunk.
 */
export async function resolveSpecId(
  provided: string | undefined,
  mint: SpecIdAllocator,
): Promise<string> {
  const trimmed = provided?.trim().replace(/^SP-/i, "");
  return trimmed && trimmed.length ? trimmed : await mint();
}
