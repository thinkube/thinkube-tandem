/**
 * What no longer holds, and what that makes unbuilt.
 *
 * A delivery's proofs are claims about the world; the world can answer
 * back. The answer lands on a criterion, and the newest evidence about a
 * criterion is what counts: a contradiction newer than the proof that
 * settled it means the criterion does not hold, and a later delivery
 * proving it green again is newer still. Nothing is edited or removed —
 * this reads the record and says what it means.
 *
 * A promise with a criterion that does not hold is not kept, and a
 * promise that is not kept is not built, however signed its cut. That is
 * the whole mechanism by which delivered work returns to the page as
 * work: no state to reopen, no delivery to un-accept.
 */
import { signedIds } from "./cutClosure";
import type { Contradiction, Space } from "./schema";

/** When a criterion was last proved to hold, by any delivery. */
function provedAt(space: Space): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of space.deliveries)
    for (const p of d.proofs) {
      if (!p.criterionId || p.verdict !== "green") continue;
      const at = d.producedAt ?? d.acceptedAt ?? "";
      if (!at) continue;
      const had = out.get(p.criterionId);
      if (!had || had < at) out.set(p.criterionId, at);
    }
  return out;
}

/**
 * Every criterion that does not hold, with the newest word against it.
 *
 * Newer than the last proof of it: a contradiction of work that was
 * delivered again since, and proved, has been answered by that proof.
 */
export function contradicted(space: Space): Map<string, Contradiction> {
  const proved = provedAt(space);
  const out = new Map<string, Contradiction>();
  for (const c of space.contradictions ?? []) {
    const green = proved.get(c.criterionId);
    if (green && green >= c.at) continue;
    const had = out.get(c.criterionId);
    if (!had || had.at < c.at) out.set(c.criterionId, c);
  }
  return out;
}

/** The promises a contradiction makes unkept, with the word against each. */
export function unkeptPromises(space: Space): Map<string, Contradiction> {
  const against = contradicted(space);
  const out = new Map<string, Contradiction>();
  if (!against.size) return out;
  for (const n of space.nodes)
    for (const a of n.acceptance) {
      const c = against.get(a.id);
      if (!c) continue;
      const had = out.get(n.id);
      if (!had || had.at < c.at) out.set(n.id, c);
    }
  return out;
}

/**
 * The promises that are BUILT: signed, and not since contradicted.
 *
 * Every reading of "this is done" goes through here, so a promise the
 * world refused is offered to build again by the ordinary press instead
 * of sitting on the page as finished.
 */
export function builtIds(space: Space): Set<string> {
  const signed = signedIds(space.cuts);
  for (const id of unkeptPromises(space).keys()) signed.delete(id);
  return signed;
}
