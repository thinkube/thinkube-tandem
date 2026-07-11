/**
 * TEP-lifecycle gate (SP-G of ) — the pure decision layer
 * that closes the ungated TEP→Spec boundary:
 *
 *   - `tepApprovalGate` — **approval before build**:
 *     a Spec may be *drafted* while its `implements:` TEP is still `proposed`,
 *     but it can't reach **Ready** until that TEP is `accepted` (=
 *     approved-to-build). The refusal names the TEP and its current status so
 *     the author knows exactly what to accept.
 *
 * - `tepComplete` (this slice, issue #26) — **completeness
 *     from specs**: a TEP is *complete* (delivered) only when **every**
 *     implementing Spec is `accepted`. The result names the still-open Specs so
 *     `get_project` can show what's left, and `writeTep` can refuse a premature
 *     `implemented` status.
 *
 * Pure (no fs / no vscode), so it's unit-testable vscode-free. The actual
 * cross-thinking space resolution of a Spec's `implements:` ref → its TEP's status is the
 * caller's job (`create_slice`'s →Ready path resolves it via thinking space context, like
 * `promoteTep`, then hands the resolved status here). This module only decides
 * **given a ref and the status it resolved to**, may the slice go Ready?
 *
 * The signature here is the contract the `create_slice` wiring and the
 * handler-driven `tepLifecycleDispatch.test.ts` ('approval') both agree on.
 */

import { parseImplements, formatImplements } from "../store/implementsRef";

/**
 * The thinking space column / lifecycle status a TEP can be in. Mirrors the TEP arm of
 * `Frontmatter.status` (`src/store/frontmatter.ts`): `proposed` → `accepted`
 * (approved-to-build) → `implemented` (terminal, delivered). `superseded` is a
 * dead-end. Anything else (or an unresolved ref) is treated as *not accepted*.
 */
export type TepStatus = "proposed" | "accepted" | "superseded" | "implemented";

/** The only TEP status from which an implementing Spec may reach **Ready**. */
export const APPROVED_TO_BUILD: TepStatus = "accepted";

/** Structured detail of an approval refusal — both fields are named in
 *  {@link TepApprovalResult.message} so the guidance is self-contained. */
export interface TepApprovalRefusal {
  /** The TEP named on the Spec's `implements:`, canonicalized to `TEP-<id>`
   *  (qualified refs keep their `<namespace>:` prefix). */
  tep: string;
  /** The TEP's resolved status — the reason it isn't buildable. `undefined`
   *  when the ref could not be resolved to a TEP at all. */
  status?: string;
}

/** Result of {@link tepApprovalGate}: accept, or refuse with a message that
 *  names the blocking TEP and its status. Mirrors `implementsPromoteCheck`'s
 *  `{ ok } | { ok; refuse; message }` shape. */
export type TepApprovalResult =
  { ok: true } | { ok: false; refuse: TepApprovalRefusal; message: string };

/**
 * Decide whether a Spec may move to **Ready**, given its `implements:` ref and
 * the lifecycle status that ref resolved to.
 *
 * - **No `implements:`** (absent / empty) → **ok**: a Spec without a TEP has
 *   nothing to gate on.
 * - **TEP is `accepted`** → **ok**: approved-to-build.
 * - **Unresolved ref** (`tepStatus === undefined` — the ref names no TEP we can
 *   find) → **ok**: we can't classify it, so we accept rather than block on a
 *   ref we can't reason about (mirrors `makeThinkingSpacePromoteLocator`'s "can't
 *   classify → accept"). A dangling `implements:` is a separate concern
 *   (`write_spec`'s promote check), not the approval gate's.
 * - **Any other RESOLVED status** (`proposed`, `superseded`, `implemented`) →
 *   **refuse**, with a message naming the TEP and its status. A Spec may be
 *   drafted against a `proposed` TEP; it just can't reach Ready until accepted.
 *
 * @param implementsRef the Spec's raw `implements:` value (or undefined).
 * @param tepStatus     the status that `implementsRef` resolved to (or
 *                      undefined when it resolved to no TEP). The caller does
 *                      the cross-thinking space resolution.
 */
export function tepApprovalGate(
  implementsRef: string | undefined,
  tepStatus: TepStatus | string | undefined,
): TepApprovalResult {
  const ref = parseImplements(implementsRef);
  // No TEP linked → nothing to approve; the slice may go Ready freely.
  if (!ref) return { ok: true };

  // `accepted` (approved-to-build) passes; so does an unresolved ref (undefined
  // status) — only a RESOLVED, non-accepted status blocks.
  if (tepStatus === undefined || tepStatus === APPROVED_TO_BUILD)
    return { ok: true };

  // Canonical display name: keep a qualified namespace, force the `TEP-` prefix.
  const tep = formatImplements(ref.namespace, ref.id);
  const status = tepStatus;
  const shownStatus = `"${status}"`;
  return {
    ok: false,
    refuse: { tep, status },
    message:
      `Cannot move this Spec to Ready: its implements: TEP ${tep} is ` +
      `${shownStatus}, not "${APPROVED_TO_BUILD}". A TEP must be accepted ` +
      `(approved-to-build) before a Spec implementing it can reach Ready. ` +
      `Accept ${tep} first, then retry.`,
  };
}

/**
 * A single Spec that implements a TEP, reduced to just what completeness needs:
 * an identifier (named in {@link TepCompleteResult.openSpecs}) and whether the
 * human has accepted it. A Spec counts as accepted iff its `accepted:` stamp
 * (the ISO timestamp `accept_spec` writes, `Frontmatter.accepted`) is present
 * and non-empty — mere existence of the Spec, or any other status, is *not*
 * acceptance.
 *
 * The caller (`get_project` / `writeTep`) does the cross-thinking space resolution of a
 * TEP's implementing Specs (via `implementsRef` / `projectTeps`) and projects
 * each resolved Spec down to this shape before calling {@link tepComplete}.
 */
export interface ImplementingSpec {
 /** Stable Spec handle, e.g. `SP-4` — what `openSpecs` lists when a Spec
   *  is still unaccepted. The caller may qualify it (`<namespace>:SP-…`) for a
   *  cross-thinking space Spec; `tepComplete` treats it as an opaque label. */
  id: string;
  /** The Spec's `accepted:` stamp (ISO timestamp from `accept_spec`), or
   *  undefined/empty when the human hasn't accepted it yet. */
  accepted?: string;
  /** The Spec's `superseded:` stamp (ISO timestamp from `supersede_spec`, SP-6/14),
   *  or undefined/empty when it hasn't been superseded. Presence removes the Spec
   *  from `openSpecs`/completeness exactly as `accepted:` does — a superseded Spec
   *  is deliberately not being built, so it no longer blocks its TEP. */
  superseded?: string;
}

/**
 * Result of {@link tepComplete}: is the TEP delivered, and if not, which Specs
 * are still open. `complete` is true iff `openSpecs` is empty.
 */
export interface TepCompleteResult {
  /** The TEP these specs implement, canonicalized to `TEP-<id>` (qualified refs
   *  keep their `<namespace>:` prefix) — echoed for self-contained messaging. */
  tep: string;
  /** True iff **every** implementing Spec is resolved — `accepted` OR
   *  `superseded` (SP-6/14). A TEP with no implementing Specs is **not**
   *  complete — there is nothing delivered. An all-superseded (zero-accepted)
   *  TEP therefore reports `complete: true`. */
  complete: boolean;
  /** The `id`s of implementing Specs that are still open — neither `accepted`
   *  nor `superseded` — in input order. Empty exactly when `complete` is true. */
  openSpecs: string[];
}

/** Has the human accepted this Spec? True iff its `accepted:` stamp is a
 *  non-empty string. */
function isAccepted(spec: ImplementingSpec): boolean {
  return typeof spec.accepted === "string" && spec.accepted.trim().length > 0;
}

/** Has this Spec been superseded? True iff its `superseded:` stamp is a
 *  non-empty trimmed string (the exact mirror of {@link isAccepted}). A
 *  superseded Spec is deliberately not being built, so it is excluded from
 *  `openSpecs`/completeness (SP-6/14). */
export function isSuperseded(spec: ImplementingSpec): boolean {
  return (
    typeof spec.superseded === "string" && spec.superseded.trim().length > 0
  );
}

/**
 * Derive a TEP's completeness from its implementing Specs' `accepted:` stamps —
 * the pure core of the completeness surface (`get_project`) and the
 * `implemented`-status gate (`writeTep`).
 *
 * A TEP is **complete** only when every implementing Spec is `accepted`
 * (delivered). Any unaccepted Spec — or **no** implementing Specs at all (a TEP
 * delivers nothing until at least one accepted Spec carries it) — leaves it
 * **not complete**, and `openSpecs` names the blockers.
 *
 * Pure (no fs / no vscode): the caller resolves the TEP's implementing Specs
 * across thinkingSpaces and hands them in already projected to {@link ImplementingSpec}.
 *
 * @param tepId             the TEP's id (with or without a `TEP-` prefix), or a
 *                          qualified `<namespace>:TEP-id` ref; echoed canonical
 *                          on the result's `tep`.
 * @param implementingSpecs the Specs that implement this TEP (caller-resolved).
 */
export function tepComplete(
  tepId: string,
  implementingSpecs: readonly ImplementingSpec[],
): TepCompleteResult {
  const ref = parseImplements(tepId);
  const tep = ref ? formatImplements(ref.namespace, ref.id) : `TEP-${tepId}`;

  const openSpecs = implementingSpecs
    .filter((s) => !isAccepted(s) && !isSuperseded(s))
    .map((s) => s.id);
  // No implementing specs ⇒ nothing delivered ⇒ not complete. Otherwise complete
  // exactly when no spec is left open.
  const complete = implementingSpecs.length > 0 && openSpecs.length === 0;

  return { tep, complete, openSpecs };
}
