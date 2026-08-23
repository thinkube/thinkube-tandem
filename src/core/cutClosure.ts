/**
 * The cut is closed under `needs` (the v1 rule, human-restored): what a
 * change depends on ships with it. Adding pulls the dependency closure
 * in; removing drops everything that depended on the removed change —
 * the cut can never hold a dangling dependency.
 */
import { Change } from "./schema";

/** Promises already inside a SIGNED cut are records — never re-cut. */
export function signedIds(cuts: readonly { changeIds: string[]; signature?: unknown; withdrawnAt?: string }[]): Set<string> {
  const out = new Set<string>();
  for (const c of cuts) if (c.signature && !c.withdrawnAt) for (const id of c.changeIds) out.add(id);
  return out;
}

/** Add ids and their transitive needs. Returns what came along uninvited.
 *  Signed promises refuse — the note says so instead of adding them. */
export function addWithNeeds(
  cut: Set<string>,
  ids: readonly string[],
  nodes: readonly Change[],
  signed: ReadonlySet<string> = new Set(),
): { note?: string } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const asked = new Set(ids);
  const queue = [...ids];
  let pulled = 0;
  let refusedSigned = 0;
  while (queue.length) {
    const id = queue.pop()!;
    if (!byId.has(id) || cut.has(id)) continue;
    if (signed.has(id)) {
      refusedSigned++;
      continue;
    }
    cut.add(id);
    if (!asked.has(id)) pulled++;
    for (const dep of byId.get(id)!.needs) queue.push(dep);
  }
  const notes: string[] = [];
  if (pulled) notes.push(`Also added ${pulled} promise(s) this depends on — they ship together.`);
  if (refusedSigned)
    notes.push(`${refusedSigned} promise(s) are already in a signed work order and were not added.`);
  return notes.length ? { note: notes.join(" ") } : {};
}

/** Remove ids and everything in the cut that needs them (transitively). */
export function removeWithDependents(
  cut: Set<string>,
  ids: readonly string[],
  nodes: readonly Change[],
): { note?: string } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const removing = new Set(ids.filter((id) => cut.has(id)));
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of cut) {
      if (removing.has(id)) continue;
      if ((byId.get(id)?.needs ?? []).some((d) => removing.has(d))) {
        removing.add(id);
        grew = true;
      }
    }
  }
  const asked = new Set(ids);
  let dropped = 0;
  for (const id of removing) {
    cut.delete(id);
    if (!asked.has(id)) dropped++;
  }
  return dropped
    ? { note: `Also removed ${dropped} promise(s) that needed what you removed.` }
    : {};
}

/** Sign-gate backstop: members whose needs point outside the cut. */
export function danglingNeeds(
  cutIds: readonly string[],
  nodes: readonly Change[],
): { id: string; sentence: string; missing: string[] }[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const inCut = new Set(cutIds);
  const out: { id: string; sentence: string; missing: string[] }[] = [];
  for (const id of cutIds) {
    const n = byId.get(id);
    if (!n) continue;
    const missing = n.needs.filter((d) => byId.has(d) && !inCut.has(d));
    if (missing.length)
      out.push({
        id,
        sentence: n.sentence,
        missing: missing.map((d) => byId.get(d)!.sentence),
      });
  }
  return out;
}

/**
 * Promises whose work is IN THE PROJECT: their cut was signed, delivered,
 * and the delivery accepted, which merged it.
 *
 * This — not the signature — is what freezes a sentence. Signing is
 * approval: it mints a number and pushes a branch, both of which outlive
 * the space and neither of which anyone has agreed to keep. Accepting is
 * the act that puts the work into the project, and only then is changing
 * the sentence changing something built.
 */
export function mergedIds(space: {
  cuts: readonly { id: string; changeIds: readonly string[]; signature?: unknown }[];
  deliveries: readonly { cutId: string; acceptedAt?: string }[];
}): Set<string> {
  const merged = new Set(space.deliveries.filter((d) => d.acceptedAt).map((d) => d.cutId));
  return new Set(
    space.cuts.filter((c) => c.signature && merged.has(c.id)).flatMap((c) => [...c.changeIds]),
  );
}
